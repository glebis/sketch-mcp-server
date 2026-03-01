import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CanvasManager } from "./canvas-manager.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const host = process.env.SKETCH_HOST ?? "0.0.0.0";
  const canvasManager = new CanvasManager({ host });
  const port = await canvasManager.start();

  // Log to stderr so it doesn't interfere with stdio MCP transport
  console.error(`[sketch] HTTP+WS server listening on ${host}:${port}`);

  const mcpServer = createMcpServer(canvasManager);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("[sketch] MCP stdio transport connected");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
