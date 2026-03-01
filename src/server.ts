import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { exec, execSync } from "node:child_process";
import QRCode from "qrcode";
import type { CanvasManager } from "./canvas-manager.js";

function openAppWindow(url: string): void {
  // Try Chrome --app mode first (standalone window, no tabs/address bar)
  const chromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  for (const bin of chromePaths) {
    try {
      execSync(`test -f "${bin}"`, { stdio: "ignore" });
      exec(`"${bin}" --app="${url}" --new-window`);
      return;
    } catch {
      // not found, try next
    }
  }
  // Fallback: default browser
  exec(`open "${url}"`);
}

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
      openAppWindow(url);

      const mobileUrl = canvasManager.getMobileUrl(canvasName);
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }> = [
        {
          type: "text",
          text: `${isNew ? "Created" : "Opened"} canvas "${canvasName}". Editor: ${url}` +
            (mobileUrl ? `\nMobile: ${mobileUrl}` : ""),
        },
      ];

      if (mobileUrl) {
        try {
          const qrDataUrl = await QRCode.toDataURL(mobileUrl, { width: 256, margin: 2 });
          const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
          content.push({ type: "image", data: base64, mimeType: "image/png" });
          // Also log to stderr for terminal visibility
          const qrText = await QRCode.toString(mobileUrl, { type: "terminal", small: true });
          console.error(`\n[sketch] Mobile URL for "${canvasName}":\n${mobileUrl}\n${qrText}`);
        } catch {
          // QR generation failed, still return the URL
        }
      }

      return { content };
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
    "sketch_clear_canvas",
    "Clear all content from a canvas, resetting it to a blank state. Use before streaming new content with sketch_add_element.",
    { canvas_name: z.string().describe("Name of the canvas") },
    async ({ canvas_name }) => {
      if (!canvasManager.clearCanvas(canvas_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Canvas "${canvas_name}" cleared.` }] };
    }
  );

  server.tool(
    "sketch_focus_canvas",
    "Bring the canvas browser window to the foreground.",
    { canvas_name: z.string().describe("Name of the canvas") },
    async ({ canvas_name }) => {
      if (!canvasManager.focusCanvas(canvas_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      // Also try macOS-level window activation for reliability
      try {
        const { exec: execCb } = await import("node:child_process");
        execCb(`osascript -e 'tell application "System Events" to set frontmost of (first process whose name contains "Chrome") to true'`);
      } catch {}
      return { content: [{ type: "text", text: `Focused canvas "${canvas_name}".` }] };
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

  server.tool(
    "sketch_capture_screenshot",
    "Capture a PNG screenshot of the canvas as it currently appears in the browser. Returns the image directly.",
    { canvas_name: z.string().describe("Name of the canvas") },
    async ({ canvas_name }) => {
      try {
        const session = canvasManager.getSession(canvas_name);
        if (!session) {
          return {
            content: [{ type: "text" as const, text: `Canvas "${canvas_name}" not found.` }],
            isError: true,
          };
        }
        const dataUrl = await canvasManager.requestCanvasScreenshot(session);
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        return {
          content: [{ type: "image" as const, data: base64, mimeType: "image/png" as const }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "sketch_add_textbox",
    "Add a fixed-width text area (Textbox) to a canvas. Supports word wrapping. Use for editable text regions in templates.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
      width: z.number().describe("Width of the text area"),
      text: z.string().optional().describe("Initial text content (default: 'Text')"),
      font_size: z.number().optional().describe("Font size in px (default: 20)"),
      fill: z.string().optional().describe("Text color (default: '#000000')"),
      font_family: z.string().optional().describe("Font family (default: 'sans-serif')"),
    },
    async ({ canvas_name, x, y, width, text, font_size, fill, font_family }) => {
      if (!canvasManager.addTextbox(canvas_name, {
        x, y, width,
        text: text ?? undefined,
        fontSize: font_size ?? undefined,
        fill: fill ?? undefined,
        fontFamily: font_family ?? undefined,
      })) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Textbox added to "${canvas_name}" at (${x}, ${y}) width=${width}.` }] };
    }
  );

  server.tool(
    "sketch_update_textbox",
    "Update the text content of a Textbox object on the canvas by its object index. Use with templates to fill in editable fields.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
      object_index: z.number().describe("Index of the Textbox object in the canvas objects array"),
      text: z.string().describe("New text content"),
    },
    async ({ canvas_name, object_index, text }) => {
      if (!canvasManager.updateTextbox(canvas_name, object_index, text)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Textbox ${object_index} on "${canvas_name}" updated.` }] };
    }
  );

  server.tool(
    "sketch_lock_objects",
    "Lock all current objects on the canvas so they cannot be selected or moved. Objects added after locking remain editable.",
    { canvas_name: z.string().describe("Name of the canvas") },
    async ({ canvas_name }) => {
      if (!canvasManager.lockObjects(canvas_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `All objects on "${canvas_name}" locked.` }] };
    }
  );

  server.tool(
    "sketch_unlock_objects",
    "Unlock all objects on the canvas, restoring selectability and movement.",
    { canvas_name: z.string().describe("Name of the canvas") },
    async ({ canvas_name }) => {
      if (!canvasManager.unlockObjects(canvas_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `All objects on "${canvas_name}" unlocked.` }] };
    }
  );

  server.tool(
    "sketch_set_zoom",
    "Set the zoom level of a canvas. 1.0 = 100%. Optionally specify a center point to zoom toward.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
      zoom: z.number().describe("Zoom level (1.0 = 100%, 0.5 = 50%, 2.0 = 200%)"),
      center_x: z.number().optional().describe("X coordinate to zoom toward"),
      center_y: z.number().optional().describe("Y coordinate to zoom toward"),
    },
    async ({ canvas_name, zoom, center_x, center_y }) => {
      if (!canvasManager.setZoom(canvas_name, zoom, center_x ?? undefined, center_y ?? undefined)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Zoom set to ${Math.round(zoom * 100)}% on "${canvas_name}".` }] };
    }
  );

  server.tool(
    "sketch_pan_to",
    "Pan the canvas so that the given coordinates are at the top-left of the viewport.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
      x: z.number().describe("X coordinate for top-left of viewport"),
      y: z.number().describe("Y coordinate for top-left of viewport"),
    },
    async ({ canvas_name, x, y }) => {
      if (!canvasManager.panTo(canvas_name, x, y)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Panned "${canvas_name}" to (${x}, ${y}).` }] };
    }
  );

  server.tool(
    "sketch_zoom_to_fit",
    "Fit all canvas content in view with padding. Most useful after drawing to ensure everything is visible regardless of browser window size.",
    {
      canvas_name: z.string().describe("Name of the canvas"),
    },
    async ({ canvas_name }) => {
      if (!canvasManager.zoomToFit(canvas_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Zoomed to fit content on "${canvas_name}".` }] };
    }
  );

  server.tool(
    "sketch_save_template",
    "Save the current canvas state as a reusable JSON template. Preserves Textbox widths, lock states, and all object properties.",
    {
      canvas_name: z.string().describe("Name of the canvas to save from"),
      template_name: z.string().describe("Name for the template (no extension)"),
    },
    async ({ canvas_name, template_name }) => {
      try {
        const filePath = await canvasManager.saveTemplate(canvas_name, template_name);
        return { content: [{ type: "text", text: `Template "${template_name}" saved to ${filePath}` }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: e.message }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "sketch_load_template",
    "Load a previously saved JSON template into a canvas, replacing current content.",
    {
      canvas_name: z.string().describe("Name of the canvas to load into"),
      template_name: z.string().describe("Name of the template to load"),
    },
    async ({ canvas_name, template_name }) => {
      if (!canvasManager.loadTemplate(canvas_name, template_name)) {
        return {
          content: [{ type: "text", text: `Canvas "${canvas_name}" or template "${template_name}" not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `Template "${template_name}" loaded into "${canvas_name}".` }] };
    }
  );

  server.tool(
    "sketch_list_templates",
    "List all saved canvas templates.",
    {},
    async () => {
      const templates = canvasManager.listTemplates();
      if (templates.length === 0) {
        return { content: [{ type: "text", text: "No templates saved yet." }] };
      }
      return { content: [{ type: "text", text: templates.map((t) => `- ${t}`).join("\n") }] };
    }
  );

  return server;
}
