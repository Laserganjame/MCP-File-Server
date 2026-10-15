# MCP File Server

A TypeScript MCP server that lets an authenticated MCP client manage text files inside the project's `workspace/` directory. It uses the MCP TypeScript SDK, Express, Zod, and Streamable HTTP.

## Requirements

- Node.js 18 or later
- npm
- `MCP_AUTH_TOKEN` set in the process environment

Install dependencies with `npm install`, then start the local HTTP server in PowerShell:

```powershell
$env:MCP_AUTH_TOKEN = "use-a-long-random-token"
npm run start:http
```

The server listens only on `http://127.0.0.1:3000`. The health endpoint is `/health`; the authenticated MCP endpoint is `/mcp` and expects `Authorization: Bearer <token>`.

`src/index.ts` provides the separate stdio MCP entry point. The HTTP endpoint is started with `npm run start:http`.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_files` | List a workspace folder. |
| `read_file` | Read a text file. |
| `create_file` | Create a new file without overwriting an existing one. |
| `delete_file` | Delete a regular file. |
| `search_files` | Search text files up to 1 MiB. |
| `get_file_info` | Show file or directory metadata. |
| `create_directory` | Create a directory. |
| `move_file` | Move or rename a file without replacing an existing destination. |
| `str_replace` | Replace exactly one occurrence of text. |

## Security model

All tool paths are relative to `workspace/`. Absolute, Windows drive-relative, traversal, and resolved paths outside that workspace are rejected. Existing path components are resolved with `realpath`, so symlinks that escape the workspace are rejected. `delete_file` additionally refuses to delete a symlink itself. Creation uses exclusive writes, and moves use a no-clobber link-then-unlink operation.

The HTTP server requires `MCP_AUTH_TOKEN` for `/mcp`, uses a timing-safe token comparison, and binds to loopback. Browser requests with a non-local `Origin` must be explicitly listed in `MCP_ALLOWED_ORIGINS` as a comma-separated list. MCP clients without an `Origin` header still require the Bearer token.

Do not put a real token in this repository. `.env.example` is a reference only; the application does not load `.env` automatically. Set the variable in the shell, PM2 environment, or a deployment secret store.

## Checks

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd audit --omit=dev --audit-level=high
```

The automated test uses an in-memory MCP client. It verifies all nine registrations, normal file operations, traversal and absolute-path rejection, an outside-workspace symlink case, and no-overwrite move behavior.

## Deployment notes

Keep the service bound to `127.0.0.1`; expose it only through the intended HTTPS tunnel. Add that tunnel's exact browser Origin to `MCP_ALLOWED_ORIGINS` only when a browser client is needed. A browser Inspector OAuth registration request is not supported by this bearer-token server; use a token-capable MCP client instead.

Local and public authenticated MCP initialization plus `create_file` transport probes have been verified. A two-session public HTTPS demonstration also verified that Session 2 can read a file created by Session 1; see [the sanitized evidence](workspace/reports/two-session-demo-evidence.md). Before submission, capture real evidence for the remaining remote tool calls. See [DOCUMENTATION.md](DOCUMENTATION.md) and the files in `workspace/` for the current verified status.
