# MCP File Server â€” Implementation Documentation

## Purpose and stack

This project is a Node.js and TypeScript MCP file server for a restricted project workspace. `@modelcontextprotocol/sdk` supplies the MCP server and Streamable HTTP transport, Express handles HTTP requests, and Zod defines tool inputs. The server has both a stdio entry point (`src/index.ts`) and a Streamable HTTP entry point (`src/http.ts`).

## Tool design

The server exposes nine tools: listing, reading, creating, deleting, searching, inspecting, directory creation, moving, and exact text replacement. File-creation uses `wx`, so an existing file is never overwritten. `str_replace` changes a file only when the requested old text occurs exactly once. Search skips files larger than 1 MiB and files that cannot be decoded as text.

## Workspace security

Every tool uses the shared path-resolution helper in `src/tools.ts`. It accepts only relative paths, rejects absolute and Windows drive-relative inputs, and checks lexical containment before following existing path components with `realpath`. If a symlink resolves outside `workspace/`, the operation is rejected. A missing destination is accepted only after its nearest existing parent has been resolved safely. `delete_file` uses `lstat` first and rejects symbolic links rather than removing them.

`move_file` does not use a separate destination-exists check followed by `rename`, because another request could create the destination in between. Instead it uses `link` to create the destination only if absent, then removes the source. This makes an existing destination fail rather than be overwritten.

There remains a filesystem race limitation: a local untrusted process that can change workspace paths concurrently may race a check and a later operation. The proportionate mitigation for this student project is to keep workspace write access restricted to the account running the server and trusted users.

## HTTP security and deployment

`/mcp` requires `Authorization: Bearer <MCP_AUTH_TOKEN>`; absent configuration returns HTTP 500 and a wrong token returns HTTP 401. The service binds to `127.0.0.1`, so it is not directly exposed on all interfaces. Non-local browser Origins are rejected unless explicitly configured through `MCP_ALLOWED_ORIGINS`. Requests without an Origin are permitted only after authentication, which supports non-browser MCP clients.

An HTTPS tunnel and PM2 are deployment concerns outside the source code. At the final audit, PM2 reported `mcp-file-server` online and both the local and supplied public `/health` endpoints returned HTTP 200. Authenticated direct local and public MCP probes each initialized successfully with HTTP 200 and an MCP session ID, then called `create_file` successfully with HTTP 200 and a successful tool result. These probes verify the transport and one tool only; they are not evidence that every tool was run remotely or that a two-session demonstration was completed.

The browser Inspector OAuth dynamic-registration failure is expected for this design: this server provides bearer-token authentication and no OAuth `/register` endpoint. It does not show that the MCP transport is broken.

## Verification and remaining evidence

The final local audit ran TypeScript compilation, the in-memory MCP integration test, and npm's production dependency audit successfully. The test registers all nine tools and covers normal operations, traversal rejection, absolute-path rejection, an outside-workspace symlink read/delete attempt, and move destination preservation.

The test does not directly exercise every tool with every malformed path, in-workspace symlinks, live HTTP token/Origin handling, tunnel behavior, or filesystem races. Direct probes separately verified authenticated local/public initialization and `create_file`. A later public HTTPS demonstration verified independent Session 1 `create_file` and Session 2 `read_file` persistence; its sanitized record is [two-session-demo-evidence.md](workspace/reports/two-session-demo-evidence.md). These results do not show that every tool was executed remotely.

The required two-session demonstration was completed over the public HTTPS endpoint on 2026-10-15. Session 1 created `reports/two-session-demo.txt`, and independently initialized Session 2 read its exact content. The evidence file omits authentication data and actual session IDs.

At audit time, no repository remote was configured, so public GitHub publication still requires user action. Before publishing, review `git status`, confirm no `.env` or logs are staged, add the remote, and push only after personally reviewing the commit.
