import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { CanvasSession, ClientMessage, ServerMessage, TextboxOptions } from "./types.js";

// When running from source (*.ts), dist is at ./dist/
// When running compiled (dist/index.js), dist is the current dir
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "..", "dist")
  : import.meta.dirname;

const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"></svg>`;
const MAX_SVG_RESPONSE = 25_000;

export class CanvasManager {
  private sessions = new Map<string, CanvasSession>();
  private port = 0;
  private wss: WebSocketServer | null = null;
  private jsonCallbacks = new Map<string, (json: string) => void>();

  async start(): Promise<number> {
    const app = express();
    const server = createServer(app);

    // Serve editor HTML
    app.get("/editor/:canvasName", (_req, res) => {
      const htmlPath = path.join(DIST_DIR, "src", "editor", "index.html");
      if (!fs.existsSync(htmlPath)) {
        res.status(404).send("Editor not built. Run: npm run build");
        return;
      }
      res.sendFile(htmlPath);
    });

    // WebSocket server
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        try {
          const msg: ClientMessage = JSON.parse(data.toString());
          this.handleClientMessage(ws, msg);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        // Detach from any session using this ws
        for (const session of this.sessions.values()) {
          if (session.ws === ws) {
            session.ws = null;
          }
        }
      });
    });

    // Keepalive pings every 30s
    setInterval(() => {
      for (const session of this.sessions.values()) {
        if (session.ws?.readyState === WebSocket.OPEN) {
          this.send(session.ws, { type: "ping" });
        }
      }
    }, 30_000);

    return new Promise((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(this.port);
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  private handleClientMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "ready": {
        const session = this.sessions.get(msg.canvas_name);
        if (session) {
          session.ws = ws;
          // Send current SVG to newly connected editor
          this.send(ws, { type: "set_svg", svg: session.svg });
        }
        break;
      }
      case "canvas_update": {
        // Find session by ws reference
        for (const session of this.sessions.values()) {
          if (session.ws === ws) {
            session.svg = msg.svg;
            break;
          }
        }
        break;
      }
      case "canvas_json": {
        const cb = this.jsonCallbacks.get(msg.request_id);
        if (cb) {
          this.jsonCallbacks.delete(msg.request_id);
          cb(msg.json);
        }
        break;
      }
      case "pong":
        break;
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // --- Canvas operations ---

  openCanvas(name: string): { url: string; isNew: boolean } {
    const isNew = !this.sessions.has(name);
    if (isNew) {
      this.sessions.set(name, {
        name,
        svg: DEFAULT_SVG,
        ws: null,
        createdAt: Date.now(),
      });
    }
    const url = `http://localhost:${this.port}/editor/${encodeURIComponent(name)}`;
    return { url, isNew };
  }

  getSvg(name: string): string | null {
    const session = this.sessions.get(name);
    if (!session) return null;

    let svg = session.svg;
    if (svg.length > MAX_SVG_RESPONSE) {
      // Replace base64 image data with placeholders
      svg = svg.replace(
        /<image[^>]*href="data:[^"]*"[^>]*\/?>(?:<\/image>)?/g,
        (match) => {
          const widthMatch = match.match(/width="([^"]*)"/);
          const heightMatch = match.match(/height="([^"]*)"/);
          const w = widthMatch?.[1] ?? "?";
          const h = heightMatch?.[1] ?? "?";
          return `<!-- [raster image ${w}x${h}, base64 omitted] -->`;
        }
      );
      if (svg.length > MAX_SVG_RESPONSE) {
        svg = svg.slice(0, MAX_SVG_RESPONSE) + "\n<!-- SVG truncated at 25KB -->";
      }
    }
    return svg;
  }

  setSvg(name: string, svg: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    session.svg = svg;
    if (session.ws) {
      this.send(session.ws, { type: "set_svg", svg });
    }
    return true;
  }

  addElement(name: string, svgFragment: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;

    // Insert fragment before closing </svg> tag
    session.svg = session.svg.replace(
      /<\/svg>\s*$/,
      svgFragment + "\n</svg>"
    );
    if (session.ws) {
      this.send(session.ws, { type: "add_element", svg_fragment: svgFragment });
    }
    return true;
  }

  listCanvases(): Array<{ name: string; hasEditor: boolean; createdAt: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      name: s.name,
      hasEditor: s.ws?.readyState === WebSocket.OPEN,
      createdAt: s.createdAt,
    }));
  }

  clearCanvas(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    session.svg = DEFAULT_SVG;
    if (session.ws) {
      this.send(session.ws, { type: "clear" });
    }
    return true;
  }

  focusCanvas(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    if (session.ws) {
      this.send(session.ws, { type: "focus" });
    }
    return true;
  }

  closeCanvas(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    if (session.ws) {
      this.send(session.ws, { type: "close" });
      session.ws.close();
    }
    this.sessions.delete(name);
    return true;
  }

  // --- Textbox ---

  addTextbox(name: string, options: TextboxOptions): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    if (session.ws) {
      this.send(session.ws, { type: "add_textbox", options });
    }
    return true;
  }

  // --- Lock/Unlock ---

  lockObjects(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    if (session.ws) {
      this.send(session.ws, { type: "lock_all" });
    }
    return true;
  }

  unlockObjects(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    if (session.ws) {
      this.send(session.ws, { type: "unlock_all" });
    }
    return true;
  }

  // --- Canvas JSON (for templates) ---

  requestCanvasJson(session: CanvasSession): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("No connected editor"));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.jsonCallbacks.delete(requestId);
        reject(new Error("Timeout waiting for canvas JSON"));
      }, 5000);

      this.jsonCallbacks.set(requestId, (json) => {
        clearTimeout(timeout);
        resolve(json);
      });

      this.send(session.ws, { type: "request_json", request_id: requestId });
    });
  }

  // --- Templates ---

  private get templatesDir(): string {
    return path.join(import.meta.dirname, "..", "templates");
  }

  async saveTemplate(canvasName: string, templateName: string): Promise<string> {
    const session = this.sessions.get(canvasName);
    if (!session) throw new Error(`Canvas "${canvasName}" not found`);

    const json = await this.requestCanvasJson(session);
    const dir = this.templatesDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${templateName}.json`);
    fs.writeFileSync(filePath, json, "utf-8");
    return filePath;
  }

  loadTemplate(canvasName: string, templateName: string): boolean {
    const session = this.sessions.get(canvasName);
    if (!session) return false;

    const filePath = path.join(this.templatesDir, `${templateName}.json`);
    if (!fs.existsSync(filePath)) return false;

    const json = fs.readFileSync(filePath, "utf-8");
    if (session.ws) {
      this.send(session.ws, { type: "load_json", json });
    }
    return true;
  }

  listTemplates(): string[] {
    const dir = this.templatesDir;
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }
}
