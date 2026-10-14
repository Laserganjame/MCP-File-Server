
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE = await realpath(path.resolve("workspace"));

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
    const target = path.resolve(WORKSPACE, relativePath ?? ".");

    if (
      target !== WORKSPACE &&
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Path is outside the workspace." }],
        isError: true
      };
    }

    try {
      const actualTarget = await realpath(target);

      if (
        actualTarget !== WORKSPACE &&
        !actualTarget.startsWith(WORKSPACE + path.sep)
      ) {
        return {
          content: [{ type: "text", text: "Error: Path resolves outside the workspace." }],
          isError: true
        };
      }
    } catch {
      return {
        content: [{ type: "text", text: "Error: Folder does not exist or cannot be accessed." }],
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
    const target = path.resolve(WORKSPACE, relativePath);

    if (
      target !== WORKSPACE &&
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Path is outside the workspace." }],
        isError: true
      };
    }

    try {
      const actualTarget = await realpath(target);

      if (
        actualTarget !== WORKSPACE &&
        !actualTarget.startsWith(WORKSPACE + path.sep)
      ) {
        return {
          content: [{ type: "text", text: "Error: Path resolves outside the workspace." }],
          isError: true
        };
      }

      const contents = await readFile(actualTarget, "utf8");

      return {
        content: [{ type: "text", text: contents }]
      };
    } catch {
      return {
        content: [{ type: "text", text: "Error: File does not exist or cannot be read." }],
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
    const target = path.resolve(WORKSPACE, relativePath);

    if (
      target === WORKSPACE ||
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Invalid path inside the workspace." }],
        isError: true
      };
    }

    try {
      const parent = await realpath(path.dirname(target));

      if (
        parent !== WORKSPACE &&
        !parent.startsWith(WORKSPACE + path.sep)
      ) {
        return {
          content: [{ type: "text", text: "Error: Parent folder is outside the workspace." }],
          isError: true
        };
      }

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
            : "Error: Could not create the file. Check the path and parent folder."
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
    const target = path.resolve(WORKSPACE, relativePath);

    if (
      target === WORKSPACE ||
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Invalid path inside the workspace." }],
        isError: true
      };
    }

    try {
      const actualTarget = await realpath(target);

      if (
        !actualTarget.startsWith(WORKSPACE + path.sep)
      ) {
        return {
          content: [{ type: "text", text: "Error: Path resolves outside the workspace." }],
          isError: true
        };
      }

      const { lstat } = await import("node:fs/promises");
      const details = await lstat(actualTarget);

      if (!details.isFile()) {
        return {
          content: [{ type: "text", text: "Error: Only files can be deleted." }],
          isError: true
        };
      }

      await unlink(actualTarget);

      return {
        content: [{
          type: "text",
          text: `File deleted successfully: ${relativePath}`
        }]
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: "Error: File does not exist or cannot be deleted."
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
    const target = path.resolve(WORKSPACE, relativePath ?? ".");

    if (
      target !== WORKSPACE &&
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Path is outside the workspace." }],
        isError: true
      };
    }

    const results: string[] = [];

    async function searchFolder(folder: string): Promise<void> {
      const actualFolder = await realpath(folder);

      if (
        actualFolder !== WORKSPACE &&
        !actualFolder.startsWith(WORKSPACE + path.sep)
      ) {
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

        if (!actualTarget.startsWith(WORKSPACE + path.sep)) {
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
    const target = path.resolve(WORKSPACE, relativePath);

    if (
      target === WORKSPACE ||
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Invalid path inside the workspace." }],
        isError: true
      };
    }

    try {
      const actualTarget = await realpath(target);

      if (!actualTarget.startsWith(WORKSPACE + path.sep)) {
        return {
          content: [{ type: "text", text: "Error: Path resolves outside the workspace." }],
          isError: true
        };
      }

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
    } catch {
      return {
        content: [{ type: "text", text: "Error: File or folder does not exist or cannot be accessed." }],
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
    const target = path.resolve(WORKSPACE, relativePath);

    if (
      target === WORKSPACE ||
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{ type: "text", text: "Error: Invalid directory path." }],
        isError: true
      };
    }

    try {
      const parent = await realpath(path.dirname(target));

      if (
        parent !== WORKSPACE &&
        !parent.startsWith(WORKSPACE + path.sep)
      ) {
        return {
          content: [{ type: "text", text: "Error: Parent folder is outside the workspace." }],
          isError: true
        };
      }

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
            : "Error: Could not create the directory. Check the parent folder and path."
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
    const sourcePath = path.resolve(WORKSPACE, source);
    const destinationPath = path.resolve(WORKSPACE, destination);

    const isInsideWorkspace = (target: string) =>
      target.startsWith(WORKSPACE + path.sep);

    if (
      !isInsideWorkspace(sourcePath) ||
      !isInsideWorkspace(destinationPath)
    ) {
      return {
        content: [{
          type: "text",
          text: "Error: Both paths must be inside the workspace."
        }],
        isError: true
      };
    }

    try {
      const actualSource = await realpath(sourcePath);
      const actualParent = await realpath(path.dirname(destinationPath));

      if (
        !isInsideWorkspace(actualSource) ||
        !isInsideWorkspace(actualParent)
      ) {
        return {
          content: [{
            type: "text",
            text: "Error: Source or destination resolves outside the workspace."
          }],
          isError: true
        };
      }

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

      const finalDestination = path.join(
        actualParent,
        path.basename(destinationPath)
      );

      if (
        finalDestination === actualSource
      ) {
        return {
          content: [{
            type: "text",
            text: "Error: Source and destination are the same file."
          }],
          isError: true
        };
      }

      try {
        await stat(finalDestination);

        return {
          content: [{
            type: "text",
            text: "Error: A file or folder already exists at the destination."
          }],
          isError: true
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }

      await rename(actualSource, finalDestination);

      return {
        content: [{
          type: "text",
          text: `File moved successfully: ${source} -> ${destination}`
        }]
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: "Error: Could not move the file. Check that the source exists and the destination folder already exists."
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
    const target = path.resolve(WORKSPACE, relativePath);

    if (
      target === WORKSPACE ||
      !target.startsWith(WORKSPACE + path.sep)
    ) {
      return {
        content: [{
          type: "text",
          text: "Error: Path is outside the workspace or is not a file path."
        }],
        isError: true
      };
    }

    try {
      const actualTarget = await realpath(target);

      if (
        !actualTarget.startsWith(WORKSPACE + path.sep)
      ) {
        return {
          content: [{
            type: "text",
            text: "Error: Path resolves outside the workspace."
          }],
          isError: true
        };
      }

      const fileInfo = await stat(actualTarget);

      if (!fileInfo.isFile()) {
        return {
          content: [{
            type: "text",
            text: "Error: Target must be a regular file."
          }],
          isError: true
        };
      }

      const contents = await readFile(actualTarget, "utf8");
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

      await writeFile(actualTarget, updatedContents, "utf8");

      return {
        content: [{
          type: "text",
          text: "Text replaced successfully."
        }]
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: "Error: Could not safely read or update the file."
        }],
        isError: true
      };
    }
  }
);

  return server;
}