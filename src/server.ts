import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { exec } from "node:child_process";
import type { CanvasManager } from "./canvas-manager.js";

export function createMcpServer(canvasManager: CanvasManager): McpServer {
  const server = new McpServer({
    name: "sketch",
    version: "0.1.0",
  });

  server.tool(
    "sketch_open_canvas",
    "Create or open a named SVG canvas and launch the browser editor. Returns the editor URL.",
    { name: z.string().optional().describe("Canvas name (default: 'default')") },
    async ({ name }) => {
      const canvasName = name || "default";
      const { url, isNew } = canvasManager.openCanvas(canvasName);
      exec(`open "${url}"`);
      return {
        content: [{
          type: "text",
          text: `${isNew ? "Created" : "Opened"} canvas "${canvasName}". Editor: ${url}`,
        }],
      };
    }
  );

  server.tool(
    "sketch_get_svg",
    "Read the current SVG content of a canvas. Base64 raster images may be replaced with placeholders if the SVG exceeds 25KB.",
    { canvas_name: z.string().describe("Name of the canvas") },
    async ({ canvas_name }) => {
      const svg = canvasManager.getSvg(canvas_name);
      if (!svg) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: svg }] };
    }
  );

  server.tool(
    "sketch_set_svg",
    "Replace the entire SVG content of a canvas. The browser editor updates in real-time.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
      svg: z.string().describe("Complete SVG markup to set"),
    },
    async ({ canvas_name, svg }) => {
      if (!canvasManager.setSvg(canvas_name, svg)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Canvas "${canvas_name}" updated.` }] };
    }
  );

  server.tool(
    "sketch_add_element",
    "Add SVG element(s) to a canvas without clearing existing content. Inserts before the closing </svg> tag.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
      svg_fragment: z.string().describe("SVG element(s) to add"),
    },
    async ({ canvas_name, svg_fragment }) => {
      if (!canvasManager.addElement(canvas_name, svg_fragment)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Element(s) added to "${canvas_name}".` }] };
    }
  );

  server.tool(
    "sketch_list_canvases",
    "List all active canvas sessions with their connection status.",
    {},
    async () => {
      const canvases = canvasManager.listCanvases();
      if (canvases.length === 0) {
        return { content: [{ type: "text", text: "No active canvases." }] };
      }
      const lines = canvases.map(
        (c) => `- ${c.name} (editor ${c.hasEditor ? "connected" : "disconnected"})`
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "sketch_close_canvas",
    "Close a canvas session and its browser editor.",
    { canvas_name: z.string().describe("Name of the canvas to close") },
    async ({ canvas_name }) => {
      if (!canvasManager.closeCanvas(canvas_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Canvas "${canvas_name}" closed.` }] };
    }
  );

  return server;
}
