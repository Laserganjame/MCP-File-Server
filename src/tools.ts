
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { link, lstat, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE = await realpath(path.resolve("workspace"));

function isInsideWorkspace(target: string): boolean {
  const relative = path.relative(WORKSPACE, target);

  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function resolveWorkspacePath(
  relativePath: string,
  allowWorkspaceRoot = false
): Promise<string> {
  // Tool paths are intentionally relative. Reject Windows drive-relative paths
  // too (for example, C:notes.txt), because their meaning depends on process state.
  if (path.isAbsolute(relativePath) || path.win32.parse(relativePath).root !== "") {
    throw new Error("Path must be relative to the workspace.");
  }

  const target = path.resolve(WORKSPACE, relativePath);

  if (!isInsideWorkspace(target)) {
    throw new Error("Path is outside the workspace.");
  }

  if (target === WORKSPACE && !allowWorkspaceRoot) {
    throw new Error("The workspace root cannot be used for this operation.");
  }

  let current = target;

  while (true) {
    try {
      const actual = await realpath(current);

      if (!isInsideWorkspace(actual)) {
        throw new Error("Path resolves outside the workspace.");
      }

      return path.join(actual, path.relative(current, target));
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("outside the workspace")) {
        throw error;
      }

      // Only a missing path lets us continue upward to find an existing parent.
      // Permission errors, symlink loops, and I/O failures must not be mistaken
      // for a safe, nonexistent destination.
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }

      const parent = path.dirname(current);

      if (parent === current) {
        throw new Error("Could not resolve a safe workspace path.");
      }

      current = parent;
    }
  }
}

export function createMcpServer() {

  const server = new McpServer({
    name: "mcp-file-server",
    version: "1.0.0"
  });

server.registerTool(
  "list_files",
  {
    description: "List the names of files in the MCP workspace root folder.",
    inputSchema: {
      path: z.string().optional().describe(
        "Relative folder path inside the workspace. Defaults to the workspace root."
      )
    }
  },
  async ({ path: relativePath }) => {
    let target: string;

    try {
      target = await resolveWorkspacePath(relativePath ?? ".", true);
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: Folder does not exist or cannot be accessed."
        }],
        isError: true
      };
    }

    try {
      const entries = await readdir(target);

      return {
        content: [{
          type: "text",
          text: entries.length > 0
            ? entries.join("\n")
            : "The folder is empty."
        }]
      };
    } catch {
      return {
        content: [{ type: "text", text: "Error: Could not read that folder." }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "read_file",
  {
    description: "Read the text contents of a file inside the MCP workspace.",
    inputSchema: {
      path: z.string().describe(
        "Relative file path inside the workspace, such as notes.txt."
      )
    }
  },
  async ({ path: relativePath }) => {
    try {
      const target = await resolveWorkspacePath(relativePath);
      const contents = await readFile(target, "utf8");

      return {
        content: [{ type: "text", text: contents }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: File does not exist or cannot be read."
        }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "create_file",
  {
    description: "Create a new text file inside the MCP workspace without overwriting existing files.",
    inputSchema: {
      path: z.string().describe(
        "Relative file path inside the workspace, such as new_note.txt."
      ),
      content: z.string().describe(
        "Text content to write into the new file."
      )
    }
  },
  async ({ path: relativePath, content }) => {
    try {
      const target = await resolveWorkspacePath(relativePath);

      await writeFile(target, content, {
        encoding: "utf8",
        flag: "wx"
      });

      return {
        content: [{
          type: "text",
          text: `File created successfully: ${relativePath}`
        }]
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "";

      return {
        content: [{
          type: "text",
          text: message.includes("EEXIST")
            ? "Error: File already exists. Existing files will not be overwritten."
            : `Error: ${message || "Could not create the file. Check the path and parent folder."}`
        }],
        isError: true
      };
    }
  }
);


server.registerTool(
  "delete_file",
  {
    description: "Delete a file inside the MCP workspace. Directories cannot be deleted.",
    inputSchema: {
      path: z.string().describe(
        "Relative path of the file to delete, such as hello.txt."
      )
    }
  },
  async ({ path: relativePath }) => {
    try {
      const requestedPath = path.resolve(WORKSPACE, relativePath);

      if (!isInsideWorkspace(requestedPath) || requestedPath === WORKSPACE) {
        throw new Error("Path is outside the workspace or is not a file path.");
      }

      const requestedDetails = await lstat(requestedPath);

      if (requestedDetails.isSymbolicLink()) {
        throw new Error("Symbolic links cannot be deleted.");
      }

      const target = await resolveWorkspacePath(relativePath);
      const details = await stat(target);

      if (!details.isFile()) {
        throw new Error("Only files can be deleted.");
      }

      await unlink(target);

      return {
        content: [{
          type: "text",
          text: `File deleted successfully: ${relativePath}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: File does not exist or cannot be deleted."
        }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "search_files",
  {
    description: "Search for text inside files in the MCP workspace.",
    inputSchema: {
      query: z.string().min(1).describe("The word or phrase to search for."),
      path: z.string().optional().describe(
        "Optional relative folder path. Defaults to the workspace root."
      )
    }
  },
  async ({ query, path: relativePath }) => {
    let target: string;

    try {
      target = await resolveWorkspacePath(relativePath ?? ".", true);
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: Could not search that path."
        }],
        isError: true
      };
    }

    const results: string[] = [];

    async function searchFolder(folder: string): Promise<void> {
      const actualFolder = await realpath(folder);

      if (!isInsideWorkspace(actualFolder)) {
        throw new Error("Path resolves outside workspace.");
      }

      const entries = await readdir(actualFolder, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(actualFolder, entry.name);

        if (entry.isDirectory()) {
          await searchFolder(fullPath);
        } else if (entry.isFile()) {
          const details = await stat(fullPath);

          if (details.size > 1024 * 1024) {
            continue;
          }

          try {
            const contents = await readFile(fullPath, "utf8");
            const lines = contents.split(/\r?\n/);

            lines.forEach((line, index) => {
              if (line.toLowerCase().includes(query.toLowerCase())) {
                const relativeFile = path.relative(WORKSPACE, fullPath);
                results.push(`${relativeFile}:${index + 1}: ${line}`);
              }
            });
          } catch {
            // Skip files that cannot be read as text.
          }
        }
      }
    }

    try {
      const details = await stat(target);

      if (details.isDirectory()) {
        await searchFolder(target);
      } else {
        const actualTarget = await realpath(target);

        if (!isInsideWorkspace(actualTarget)) {
          return {
            content: [{ type: "text", text: "Error: Path resolves outside the workspace." }],
            isError: true
          };
        }

        const contents = await readFile(actualTarget, "utf8");

        contents.split(/\r?\n/).forEach((line, index) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            results.push(`${path.relative(WORKSPACE, actualTarget)}:${index + 1}: ${line}`);
          }
        });
      }

      return {
        content: [{
          type: "text",
          text: results.length > 0
            ? results.join("\n")
            : `No matches found for "${query}".`
        }]
      };
    } catch {
      return {
        content: [{ type: "text", text: "Error: Could not search that path." }],
        isError: true
      };
    }
  }
);


server.registerTool(
  "get_file_info",
  {
    description: "Get basic information about a file inside the MCP workspace.",
    inputSchema: {
      path: z.string().describe(
        "Relative file path inside the workspace, such as notes.txt."
      )
    }
  },
  async ({ path: relativePath }) => {
    try {
      const actualTarget = await resolveWorkspacePath(relativePath);
      const details = await stat(actualTarget);

      return {
        content: [{
          type: "text",
          text: [
            `Name: ${path.basename(actualTarget)}`,
            `Type: ${details.isFile() ? "File" : details.isDirectory() ? "Directory" : "Other"}`,
            `Size: ${details.size} bytes`,
            `Last modified: ${details.mtime.toISOString()}`,
            `Created: ${details.birthtime.toISOString()}`
          ].join("\n")
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: File or folder does not exist or cannot be accessed."
        }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "create_directory",
  {
    description: "Create a new directory inside the MCP workspace.",
    inputSchema: {
      path: z.string().describe(
        "Relative directory path inside the workspace, such as reports."
      )
    }
  },
  async ({ path: relativePath }) => {
    try {
      const target = await resolveWorkspacePath(relativePath);

      await mkdir(target);

      return {
        content: [{
          type: "text",
          text: `Directory created successfully: ${relativePath}`
        }]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      return {
        content: [{
          type: "text",
          text: message.includes("EEXIST")
            ? "Error: Directory or file already exists at that path."
            : `Error: ${message || "Could not create the directory. Check the parent folder and path."}`
        }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "move_file",
  {
    description: "Move or rename a file within the MCP workspace.",
    inputSchema: {
      source: z.string().describe(
        "Current relative file path, such as notes.txt."
      ),
      destination: z.string().describe(
        "New relative file path, such as reports/notes.txt."
      )
    }
  },
  async ({ source, destination }) => {
    try {
      const actualSource = await resolveWorkspacePath(source);
      const finalDestination = await resolveWorkspacePath(destination);
      const sourceDetails = await stat(actualSource);

      if (!sourceDetails.isFile()) {
        return {
          content: [{
            type: "text",
            text: "Error: Only files can be moved."
          }],
          isError: true
        };
      }

      if (actualSource === finalDestination) {
        return {
          content: [{
            type: "text",
            text: "Error: Source and destination are the same file."
          }],
          isError: true
        };
      }

      // link() creates the destination only when it does not already exist.
      // Unlike a separate existence check followed by rename(), it cannot
      // overwrite a file created by another request in between those steps.
      try {
        await link(actualSource, finalDestination);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          return {
            content: [{
              type: "text",
              text: "Error: A file or folder already exists at the destination."
            }],
            isError: true
          };
        }

        throw error;
      }

      await unlink(actualSource);

      return {
        content: [{
          type: "text",
          text: `File moved successfully: ${source} -> ${destination}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: Could not move the file."
        }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "str_replace",
  {
    description: "Replace one exact occurrence of text in a workspace file.",
    inputSchema: {
      path: z.string().describe(
        "Relative file path inside the workspace."
      ),
      old_text: z.string().min(1).describe(
        "The exact, non-empty text to find."
      ),
      new_text: z.string().describe(
        "The replacement text."
      )
    }
  },
  async ({ path: relativePath, old_text, new_text }) => {
    try {
      const target = await resolveWorkspacePath(relativePath);
      const fileInfo = await stat(target);

      if (!fileInfo.isFile()) {
        return {
          content: [{
            type: "text",
            text: "Error: Target must be a regular file."
          }],
          isError: true
        };
      }

      const contents = await readFile(target, "utf8");
      const firstIndex = contents.indexOf(old_text);

      if (firstIndex === -1) {
        return {
          content: [{
            type: "text",
            text: "Error: The target text was not found. File unchanged."
          }],
          isError: true
        };
      }

      if (contents.indexOf(old_text, firstIndex + old_text.length) !== -1) {
        return {
          content: [{
            type: "text",
            text: "Error: The target text appears more than once. File unchanged."
          }],
          isError: true
        };
      }

      const updatedContents =
        contents.slice(0, firstIndex) +
        new_text +
        contents.slice(firstIndex + old_text.length);

      await writeFile(target, updatedContents, "utf8");

      return {
        content: [{
          type: "text",
          text: "Text replaced successfully."
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `Error: ${error.message}`
            : "Error: Could not safely read or update the file."
        }],
        isError: true
      };
    }
  }
);

  return server;
}
