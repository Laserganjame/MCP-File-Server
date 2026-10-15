# Two-Session Public HTTPS MCP Demonstration

Date verified: 2026-10-15

Public MCP endpoint: `https://trapping-overboard-gliding.ngrok-free.dev/mcp`

1. Session 1 initialized independently over HTTPS with HTTP 200 and received an MCP session ID.
2. Session 1 called `create_file` with HTTP 200.
   - Path: `reports/two-session-demo.txt`
   - Content: `Created in MCP Session 1; read in MCP Session 2. Cross-session persistence verified.`
3. Session 2 initialized independently over HTTPS with HTTP 200 and received a different MCP session ID.
4. Session 2 called `read_file` for `reports/two-session-demo.txt` with HTTP 200 and received the exact content created in Session 1.

Result: cross-session file persistence through the public HTTPS MCP transport is verified.

Sanitization: this record intentionally omits authentication tokens, Authorization headers, and actual MCP session IDs.
