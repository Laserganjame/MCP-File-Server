
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./tools.js";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "1mb" }));

app.use("/mcp", (req, res, next) => {
  const expectedToken = process.env.MCP_AUTH_TOKEN;
  const authorization = req.headers.authorization;

  if (!expectedToken) {
    res.status(500).json({
      error: "Server authentication is not configured."
    });
    return;
  }

  if (authorization !== `Bearer ${expectedToken}`) {
    res.status(401).json({
      error: "Unauthorized"
    });
    return;
  }

  next();
});

app.use("/mcp", (req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) {
    next();
    return;
  }

  try {
    const parsedOrigin = new URL(origin);

    const isLocalOrigin =
      parsedOrigin.protocol === "http:" &&
      (
        parsedOrigin.hostname === "localhost" ||
        parsedOrigin.hostname === "127.0.0.1" ||
        parsedOrigin.hostname === "[::1]"
      );

    if (!isLocalOrigin) {
      res.status(403).json({
        error: "Forbidden: Origin not allowed."
      });
      return;
    }

    next();
  } catch {
    res.status(403).json({
      error: "Forbidden: Invalid Origin header."
    });
  }
});

const transports = new Map<string, StreamableHTTPServerTransport>();

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mcp-file-server"
  });
});

app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport = sessionId
    ? transports.get(sessionId)
    : undefined;

  try {
    if (!transport && !sessionId && isInitializeRequest(req.body)) {
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, newTransport);
        }
      });

      newTransport.onclose = () => {
        if (newTransport.sessionId) {
          transports.delete(newTransport.sessionId);
        }
      };

      transport = newTransport;

      const server = createMcpServer();
      await server.connect(transport);
    } else if (!transport) {
      res.status(sessionId ? 404 : 400).json({
        jsonrpc: "2.0",
        error: {
          code: sessionId ? -32001 : -32000,
          message: sessionId
            ? "Session not found. Please reconnect."
            : "A valid initialization request or session ID is required."
        },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error"
      });
    }
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`MCP HTTP server listening at http://127.0.0.1:${PORT}/mcp`);
  console.log(`Health check: http://127.0.0.1:${PORT}/health`);
});
