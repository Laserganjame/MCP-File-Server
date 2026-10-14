import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/tools.js";

const workspace = path.resolve("workspace");
const testDirectory = `.audit-test-${process.pid}-${Date.now()}`;

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  assert.equal(first?.type, "text");
  return first.text ?? "";
}

test("all tools work inside the workspace and reject unsafe paths", async (t) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "audit-test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["create_directory", "create_file", "delete_file", "get_file_info", "list_files", "move_file", "read_file", "search_files", "str_replace"]
    );

    assert.match(text(await client.callTool({ name: "create_directory", arguments: { path: testDirectory } })), /created successfully/i);
    assert.match(text(await client.callTool({ name: "create_file", arguments: { path: `${testDirectory}/source.txt`, content: "first value" } })), /created successfully/i);
    assert.equal(text(await client.callTool({ name: "read_file", arguments: { path: `${testDirectory}/source.txt` } })), "first value");
    assert.match(text(await client.callTool({ name: "get_file_info", arguments: { path: `${testDirectory}/source.txt` } })), /Type: File/);
    assert.match(text(await client.callTool({ name: "search_files", arguments: { query: "first", path: testDirectory } })), /source\.txt:1: first value/);
    assert.match(text(await client.callTool({ name: "str_replace", arguments: { path: `${testDirectory}/source.txt`, old_text: "first", new_text: "updated" } })), /replaced successfully/i);
    assert.match(text(await client.callTool({ name: "create_file", arguments: { path: `${testDirectory}/destination.txt`, content: "keep this" } })), /created successfully/i);
    const duplicateMove = await client.callTool({ name: "move_file", arguments: { source: `${testDirectory}/source.txt`, destination: `${testDirectory}/destination.txt` } });
    assert.equal(duplicateMove.isError, true);
    assert.match(text(duplicateMove), /already exists/i);
    assert.equal(text(await client.callTool({ name: "read_file", arguments: { path: `${testDirectory}/destination.txt` } })), "keep this");
    assert.match(text(await client.callTool({ name: "delete_file", arguments: { path: `${testDirectory}/destination.txt` } })), /deleted successfully/i);
    assert.match(text(await client.callTool({ name: "move_file", arguments: { source: `${testDirectory}/source.txt`, destination: `${testDirectory}/moved.txt` } })), /moved successfully/i);
    assert.match(text(await client.callTool({ name: "list_files", arguments: { path: testDirectory } })), /moved\.txt/);
    assert.match(text(await client.callTool({ name: "delete_file", arguments: { path: `${testDirectory}/moved.txt` } })), /deleted successfully/i);

    const traversal = await client.callTool({ name: "create_file", arguments: { path: "../must-not-exist.txt", content: "blocked" } });
    assert.equal(traversal.isError, true);
    assert.match(text(traversal), /outside the workspace/i);

    const absolute = await client.callTool({ name: "read_file", arguments: { path: path.join(workspace, "reports", "notes.txt") } });
    assert.equal(absolute.isError, true);
    assert.match(text(absolute), /must be relative/i);

    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "mcp-file-server-audit-"));
    const linkPath = path.join(workspace, testDirectory, "outside-link");
    try {
      await writeFile(path.join(outsideDirectory, "secret.txt"), "outside", "utf8");
      try {
        await symlink(outsideDirectory, linkPath, "junction");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) {
          t.diagnostic("Symlink checks skipped because this Windows account cannot create symlinks.");
          return;
        }
        throw error;
      }

      const linkedRead = await client.callTool({ name: "read_file", arguments: { path: `${testDirectory}/outside-link/secret.txt` } });
      assert.equal(linkedRead.isError, true);
      assert.match(text(linkedRead), /resolves outside the workspace/i);

      const linkedDelete = await client.callTool({ name: "delete_file", arguments: { path: `${testDirectory}/outside-link` } });
      assert.equal(linkedDelete.isError, true);
      assert.match(text(linkedDelete), /symbolic links cannot be deleted/i);
    } finally {
      await rm(linkPath, { recursive: true, force: true });
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  } finally {
    await client.close();
    await server.close();
    await rm(path.join(workspace, testDirectory), { recursive: true, force: true });
  }
});
