import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import QRCode from "qrcode";
import type { CanvasSession, ClientMessage, ServerMessage, TextboxOptions } from "./types.js";

// When running from source (*.ts), dist is at ./dist/
// When running compiled (dist/index.js), dist is the current dir
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "..", "dist")
  : import.meta.dirname;

const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"></svg>`;
const MAX_SVG_RESPONSE = 25_000;

export interface CanvasManagerOptions {
  host?: string;
}

export class CanvasManager {
  private sessions = new Map<string, CanvasSession>();
  private port = 0;
  private host: string;
  private wss: WebSocketServer | null = null;
  private jsonCallbacks = new Map<string, (json: string) => void>();
  private screenshotCallbacks = new Map<string, (dataUrl: string) => void>();

  constructor(options?: CanvasManagerOptions) {
    this.host = options?.host ?? "0.0.0.0";
  }

  getHost(): string {
    return this.host;
  }

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

    // Serve mobile input page
    app.get("/mobile/:canvasName", (_req, res) => {
      const htmlPath = path.join(DIST_DIR, "src", "mobile", "index.html");
      if (!fs.existsSync(htmlPath)) {
        // Serve a minimal inline HTML page as fallback
        res.type("html").send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sketch Mobile</title></head>
<body><div id="mobile-app">Loading mobile input...</div>
<script>window.__CANVAS_NAME__=${JSON.stringify(_req.params.canvasName)};</script>
</body></html>`);
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
        // Remove from any session's client set
        for (const session of this.sessions.values()) {
          session.clients.delete(ws);
        }
      });
    });

    // Keepalive pings every 30s
    setInterval(() => {
      for (const session of this.sessions.values()) {
        this.broadcast(session, { type: "ping" });
      }
    }, 30_000);

    return new Promise((resolve) => {
      server.listen(0, this.host, () => {
        const addr = server.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(this.port);
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  getLanIp(): string | null {
    const interfaces = os.networkInterfaces();
    for (const nets of Object.values(interfaces)) {
      if (!nets) continue;
      for (const net of nets) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
    return null;
  }

  getMobileUrl(canvasName: string): string | null {
    const ip = this.getLanIp();
    if (!ip) return null;
    return `http://${ip}:${this.port}/mobile/${encodeURIComponent(canvasName)}`;
  }

  getSession(name: string): CanvasSession | undefined {
    return this.sessions.get(name);
  }

  private handleClientMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "ready": {
        const session = this.sessions.get(msg.canvas_name);
        if (session) {
          session.clients.add(ws);
          // Send current state to newly connected client (prefer JSON for template fidelity)
          if (session.json) {
            this.send(ws, { type: "load_json", json: session.json });
          } else {
            this.send(ws, { type: "set_svg", svg: session.svg });
          }

          // If mobile client, send textbox info
          if (msg.client_type === "mobile") {
            this.sendTextboxInfo(session, ws);
          } else {
            // Send mobile URL + QR to editor clients
            this.sendMobileInfo(msg.canvas_name, ws);
          }
        }
        break;
      }
      case "canvas_update": {
        // Find session by ws reference, update SVG, broadcast to others
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            session.svg = msg.svg;
            this.broadcast(session, { type: "set_svg", svg: msg.svg }, ws);
            break;
          }
        }
        break;
      }
      case "canvas_json_update": {
        // Keep session JSON in sync for reconnect fidelity
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            session.json = msg.json;
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
      case "canvas_screenshot": {
        const cb = this.screenshotCallbacks.get(msg.request_id);
        if (cb) {
          this.screenshotCallbacks.delete(msg.request_id);
          cb(msg.data_url);
        }
        break;
      }
      case "update_textbox": {
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            this.broadcast(session, {
              type: "update_textbox",
              object_index: msg.object_index,
              text: msg.text,
            }, ws);
            break;
          }
        }
        break;
      }
      case "draw_points": {
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            const scale = msg.scale_factor;
            const scaledPoints = msg.points.map((p) => ({
              x: p.x * scale,
              y: p.y * scale,
            }));
            this.broadcast(session, {
              type: "draw_points",
              points: scaledPoints,
              color: msg.color,
              width: msg.width,
              scale_factor: 1,
            }, ws);
            break;
          }
        }
        break;
      }
      case "draw_complete": {
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            this.broadcast(session, {
              type: "draw_complete",
              path_data: msg.path_data,
              color: msg.color,
              width: msg.width,
            }, ws);
            break;
          }
        }
        break;
      }
      case "photo_upload": {
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            this.broadcast(session, {
              type: "add_image",
              photo_id: photoId,
              data_base64: msg.data_base64,
              x: 100,
              y: 100,
              width: msg.width,
              height: msg.height,
            }, ws);
            // Acknowledge to sender with the assigned ID
            this.send(ws, { type: "photo_ack", photo_id: photoId });
            break;
          }
        }
        break;
      }
      case "photo_delete": {
        for (const session of this.sessions.values()) {
          if (session.clients.has(ws)) {
            this.broadcast(session, {
              type: "remove_image",
              photo_id: msg.photo_id,
            }, ws);
            break;
          }
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

  private broadcast(session: CanvasSession, msg: ServerMessage, exclude?: WebSocket): void {
    for (const client of session.clients) {
      if (client !== exclude) {
        this.send(client, msg);
      }
    }
  }

  private async sendTextboxInfo(session: CanvasSession, mobileWs: WebSocket): Promise<void> {
    try {
      const json = await this.requestCanvasJson(session);
      const canvasData = JSON.parse(json);
      const objects: any[] = canvasData.objects ?? [];

      const textboxes = objects
        .map((obj, index) => ({ obj, index }))
        .filter(({ obj }) => obj.type === "Textbox" && !obj.locked)
        .map(({ obj, index }) => ({
          index,
          text: obj.text ?? "",
          label: obj.label || (obj.text ?? "").slice(0, 30) || `Textbox ${index}`,
        }));

      this.send(mobileWs, { type: "canvas_textboxes", textboxes });
      this.send(mobileWs, {
        type: "canvas_dimensions",
        width: canvasData.width ?? 1200,
        height: canvasData.height ?? 800,
      });
    } catch {
      // No editor connected or timeout -- send empty list
      this.send(mobileWs, { type: "canvas_textboxes", textboxes: [] });
    }
  }

  private async sendMobileInfo(canvasName: string, editorWs: WebSocket): Promise<void> {
    const url = this.getMobileUrl(canvasName);
    if (!url) return;
    try {
      const qrDataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2 });
      this.send(editorWs, { type: "mobile_info", url, qr_data_url: qrDataUrl });
    } catch {
      // QR generation failed, skip
    }
  }

  // --- Canvas operations ---

  openCanvas(name: string): { url: string; isNew: boolean } {
    const isNew = !this.sessions.has(name);
    if (isNew) {
      this.sessions.set(name, {
        name,
        svg: DEFAULT_SVG,
        clients: new Set(),
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
    this.broadcast(session, { type: "set_svg", svg });
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
    this.broadcast(session, { type: "add_element", svg_fragment: svgFragment });
    return true;
  }

  listCanvases(): Array<{ name: string; hasEditor: boolean; createdAt: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      name: s.name,
      hasEditor: [...s.clients].some((c) => c.readyState === WebSocket.OPEN),
      createdAt: s.createdAt,
    }));
  }

  updateTextbox(name: string, objectIndex: number, text: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "update_textbox", object_index: objectIndex, text });
    return true;
  }

  clearCanvas(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    session.svg = DEFAULT_SVG;
    session.json = undefined;
    this.broadcast(session, { type: "clear" });
    return true;
  }

  focusCanvas(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "focus" });
    return true;
  }

  closeCanvas(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "close" });
    for (const client of session.clients) {
      client.close();
    }
    this.sessions.delete(name);
    return true;
  }

  // --- Textbox ---

  addTextbox(name: string, options: TextboxOptions): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "add_textbox", options });
    return true;
  }

  // --- Lock/Unlock ---

  lockObjects(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "lock_all" });
    return true;
  }

  unlockObjects(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "unlock_all" });
    return true;
  }

  // --- Zoom & Pan ---

  setZoom(name: string, value: number, cx?: number, cy?: number): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "set_zoom", value, cx, cy });
    return true;
  }

  panTo(name: string, x: number, y: number): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "pan_to", x, y });
    return true;
  }

  zoomToFit(name: string): boolean {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.broadcast(session, { type: "zoom_to_fit" });
    return true;
  }

  // --- Canvas JSON (for templates) ---

  private getFirstOpenClient(session: CanvasSession): WebSocket | null {
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) return client;
    }
    return null;
  }

  requestCanvasJson(session: CanvasSession): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = this.getFirstOpenClient(session);
      if (!client) {
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

      this.send(client, { type: "request_json", request_id: requestId });
    });
  }

  requestCanvasScreenshot(session: CanvasSession): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = this.getFirstOpenClient(session);
      if (!client) {
        reject(new Error("No connected editor"));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.screenshotCallbacks.delete(requestId);
        reject(new Error("Timeout waiting for canvas screenshot"));
      }, 5000);

      this.screenshotCallbacks.set(requestId, (dataUrl) => {
        clearTimeout(timeout);
        resolve(dataUrl);
      });

      this.send(client, { type: "request_screenshot", request_id: requestId });
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
    session.json = json;
    this.broadcast(session, { type: "load_json", json });
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
