import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CanvasManager } from "./canvas-manager.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const canvasManager = new CanvasManager();
  const port = await canvasManager.start();

  // Log to stderr so it doesn't interfere with stdio MCP transport
  console.error(`[sketch] HTTP+WS server listening on port ${port}`);

  const mcpServer = createMcpServer(canvasManager);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("[sketch] MCP stdio transport connected");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
