import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { CanvasManager } from "../src/canvas-manager.ts";
import WebSocket from "ws";

/**
 * Multi-client WebSocket tests.
 *
 * Verifies that CanvasSession tracks multiple WebSocket clients,
 * broadcasts updates to all OTHER clients (not back to sender),
 * and handles disconnection gracefully.
 */

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendJson(ws: WebSocket, data: unknown): void {
  ws.send(JSON.stringify(data));
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for message")),
      timeoutMs
    );
    const handler = (raw: WebSocket.Data) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function collectMessages(ws: WebSocket): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  ws.on("message", (raw: WebSocket.Data) => {
    msgs.push(JSON.parse(raw.toString()));
  });
  return msgs;
}

/** Small delay to let async WS messages propagate */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("LAN binding", () => {
  it("should accept the host option and pass it through", () => {
    const cm = new CanvasManager({ host: "0.0.0.0" });
    // getHost() should return what was configured
    expect(cm.getHost()).toBe("0.0.0.0");
  });

  it("should default host to 0.0.0.0", () => {
    const cm = new CanvasManager();
    expect(cm.getHost()).toBe("0.0.0.0");
  });

  it("should allow overriding host to 127.0.0.1", () => {
    const cm = new CanvasManager({ host: "127.0.0.1" });
    expect(cm.getHost()).toBe("127.0.0.1");
  });
});

describe("Mobile route", () => {
  let cm: CanvasManager;

  beforeEach(async () => {
    cm = new CanvasManager({ host: "127.0.0.1" });
    await cm.start();
  });

  afterEach(() => {
    cm.closeCanvas("test-mobile");
  });

  it("should serve HTML at /mobile/:canvasName", async () => {
    const port = cm.getPort();
    const res = await fetch(`http://127.0.0.1:${port}/mobile/test-mobile`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  it("should return HTML that contains mobile-specific markers", async () => {
    const port = cm.getPort();
    const res = await fetch(`http://127.0.0.1:${port}/mobile/test-mobile`);
    const html = await res.text();
    // The mobile page should identify itself (not be the editor page)
    expect(html).toContain("mobile");
  });
});

describe("Canvas textbox discovery", () => {
  let cm: CanvasManager;
  const wsClients: WebSocket[] = [];
  const canvasName = "test-textbox-discovery";

  // Fake canvas JSON with 2 Textboxes (one locked, one not) and a Rect
  const fakeCanvasJson = JSON.stringify({
    version: "6.6.3",
    objects: [
      { type: "Rect", left: 10, top: 10, width: 100, height: 50 },
      { type: "Textbox", left: 20, top: 60, width: 200, text: "Title", locked: false },
      { type: "Textbox", left: 20, top: 120, width: 200, text: "Locked field", locked: true },
      { type: "Textbox", left: 20, top: 180, width: 200, text: "Description" },
    ],
  });

  beforeEach(async () => {
    cm = new CanvasManager({ host: "127.0.0.1" });
    await cm.start();
  });

  afterEach(async () => {
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    wsClients.length = 0;
    cm.closeCanvas(canvasName);
  });

  it("should send canvas_textboxes to mobile client on connect", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    // Connect an "editor" client that responds to request_json
    const editor = await connectWs(port);
    wsClients.push(editor);
    sendJson(editor, { type: "ready", canvas_name: canvasName, client_type: "editor" });
    await delay(100);

    // Editor auto-responds to request_json with fake canvas data
    editor.on("message", (raw: WebSocket.Data) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "request_json") {
        sendJson(editor, {
          type: "canvas_json",
          request_id: msg.request_id,
          json: fakeCanvasJson,
        });
      }
    });

    // Connect a "mobile" client
    const mobile = await connectWs(port);
    wsClients.push(mobile);

    // Collect messages before sending ready
    const mobileMsgs = collectMessages(mobile);
    sendJson(mobile, { type: "ready", canvas_name: canvasName, client_type: "mobile" });

    await delay(500);

    // Mobile should receive canvas_textboxes with only non-locked Textbox objects
    const tbMsg = mobileMsgs.find((m) => m.type === "canvas_textboxes") as any;
    expect(tbMsg).toBeDefined();
    expect(tbMsg.textboxes).toBeInstanceOf(Array);
    // Should have 2 textboxes: "Title" (not locked) and "Description" (no locked field = not locked)
    // "Locked field" (locked: true) should be excluded
    expect(tbMsg.textboxes.length).toBe(2);
    expect(tbMsg.textboxes[0].text).toBe("Title");
    expect(tbMsg.textboxes[1].text).toBe("Description");
    expect(typeof tbMsg.textboxes[0].index).toBe("number");
  });
});

describe("Text field updates", () => {
  let cm: CanvasManager;
  const wsClients: WebSocket[] = [];
  const canvasName = "test-textbox-update";

  beforeEach(async () => {
    cm = new CanvasManager({ host: "127.0.0.1" });
    await cm.start();
  });

  afterEach(async () => {
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    wsClients.length = 0;
    cm.closeCanvas(canvasName);
  });

  it("should forward update_textbox from mobile to editor", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    // Connect editor
    const editor = await connectWs(port);
    wsClients.push(editor);
    sendJson(editor, { type: "ready", canvas_name: canvasName, client_type: "editor" });
    await delay(100);

    // Collect editor messages
    const editorMsgs = collectMessages(editor);

    // Connect mobile
    const mobile = await connectWs(port);
    wsClients.push(mobile);
    sendJson(mobile, { type: "ready", canvas_name: canvasName, client_type: "mobile" });
    await delay(100);

    // Mobile sends update_textbox
    sendJson(mobile, { type: "update_textbox", object_index: 1, text: "Updated Title" });
    await delay(300);

    // Editor should receive update_textbox
    const updateMsg = editorMsgs.find(
      (m) => m.type === "update_textbox"
    ) as any;
    expect(updateMsg).toBeDefined();
    expect(updateMsg.object_index).toBe(1);
    expect(updateMsg.text).toBe("Updated Title");
  });
});

describe("Drawing path sync", () => {
  let cm: CanvasManager;
  const wsClients: WebSocket[] = [];
  const canvasName = "test-draw-sync";

  beforeEach(async () => {
    cm = new CanvasManager({ host: "127.0.0.1" });
    await cm.start();
  });

  afterEach(async () => {
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    wsClients.length = 0;
    cm.closeCanvas(canvasName);
  });

  it("should forward draw_points from mobile to editor with scaled coordinates", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    const editor = await connectWs(port);
    wsClients.push(editor);
    sendJson(editor, { type: "ready", canvas_name: canvasName, client_type: "editor" });
    await delay(100);

    const editorMsgs = collectMessages(editor);

    const mobile = await connectWs(port);
    wsClients.push(mobile);
    sendJson(mobile, { type: "ready", canvas_name: canvasName, client_type: "mobile" });
    await delay(100);

    // Mobile sends draw_points with a scale factor of 2 (mobile canvas is half desktop size)
    sendJson(mobile, {
      type: "draw_points",
      points: [{ x: 10, y: 20 }, { x: 15, y: 25 }],
      color: "#ff0000",
      width: 3,
      scale_factor: 2,
    });
    await delay(300);

    const drawMsg = editorMsgs.find((m) => m.type === "draw_points") as any;
    expect(drawMsg).toBeDefined();
    // Points should be scaled by scale_factor
    expect(drawMsg.points[0].x).toBe(20);
    expect(drawMsg.points[0].y).toBe(40);
    expect(drawMsg.points[1].x).toBe(30);
    expect(drawMsg.points[1].y).toBe(50);
    expect(drawMsg.color).toBe("#ff0000");
    expect(drawMsg.width).toBe(3);
  });

  it("should forward draw_complete from mobile to editor", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    const editor = await connectWs(port);
    wsClients.push(editor);
    sendJson(editor, { type: "ready", canvas_name: canvasName, client_type: "editor" });
    await delay(100);

    const editorMsgs = collectMessages(editor);

    const mobile = await connectWs(port);
    wsClients.push(mobile);
    sendJson(mobile, { type: "ready", canvas_name: canvasName, client_type: "mobile" });
    await delay(100);

    sendJson(mobile, {
      type: "draw_complete",
      path_data: "M 10 20 L 30 40",
      color: "#0000ff",
      width: 2,
    });
    await delay(300);

    const completeMsg = editorMsgs.find((m) => m.type === "draw_complete") as any;
    expect(completeMsg).toBeDefined();
    expect(completeMsg.path_data).toBe("M 10 20 L 30 40");
    expect(completeMsg.color).toBe("#0000ff");
  });
});

describe("Photo upload", () => {
  let cm: CanvasManager;
  const wsClients: WebSocket[] = [];
  const canvasName = "test-photo";

  beforeEach(async () => {
    cm = new CanvasManager({ host: "127.0.0.1" });
    await cm.start();
  });

  afterEach(async () => {
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    wsClients.length = 0;
    cm.closeCanvas(canvasName);
  });

  it("should forward photo_upload as add_image to editor", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    const editor = await connectWs(port);
    wsClients.push(editor);
    sendJson(editor, { type: "ready", canvas_name: canvasName, client_type: "editor" });
    await delay(100);

    const editorMsgs = collectMessages(editor);

    const mobile = await connectWs(port);
    wsClients.push(mobile);
    sendJson(mobile, { type: "ready", canvas_name: canvasName, client_type: "mobile" });
    await delay(100);

    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUg==";
    sendJson(mobile, {
      type: "photo_upload",
      data_base64: fakeBase64,
      width: 640,
      height: 480,
    });
    await delay(300);

    const imgMsg = editorMsgs.find((m) => m.type === "add_image") as any;
    expect(imgMsg).toBeDefined();
    expect(imgMsg.data_base64).toBe(fakeBase64);
    expect(imgMsg.width).toBe(640);
    expect(imgMsg.height).toBe(480);
    expect(typeof imgMsg.x).toBe("number");
    expect(typeof imgMsg.y).toBe("number");
  });
});

describe("Multi-client WebSocket", () => {
  let cm: CanvasManager;
  const wsClients: WebSocket[] = [];
  const canvasName = "test-multi-client";

  beforeEach(async () => {
    cm = new CanvasManager();
    await cm.start();
  });

  afterEach(async () => {
    // Close all WebSocket clients
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    wsClients.length = 0;

    // Close canvases
    cm.closeCanvas(canvasName);
  });

  it("should track both clients in the session when two connect", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    // Connect two clients
    const ws1 = await connectWs(port);
    wsClients.push(ws1);
    const ws2 = await connectWs(port);
    wsClients.push(ws2);

    // Both send "ready" for the same canvas
    sendJson(ws1, { type: "ready", canvas_name: canvasName });
    sendJson(ws2, { type: "ready", canvas_name: canvasName });

    // Allow messages to be processed
    await delay(200);

    const session = cm.getSession(canvasName);
    expect(session).toBeDefined();

    // The session should have a `clients` Set containing both WebSocket connections
    // (This replaces the old single `ws` property)
    expect(session!.clients).toBeDefined();
    expect(session!.clients).toBeInstanceOf(Set);
    expect(session!.clients.size).toBe(2);
  });

  it("should broadcast set_svg to the OTHER client but NOT back to the sender", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    const ws1 = await connectWs(port);
    wsClients.push(ws1);
    const ws2 = await connectWs(port);
    wsClients.push(ws2);

    sendJson(ws1, { type: "ready", canvas_name: canvasName });
    sendJson(ws2, { type: "ready", canvas_name: canvasName });
    await delay(200);

    // Collect messages on both clients from this point forward
    const msgs1 = collectMessages(ws1);
    const msgs2 = collectMessages(ws2);

    // ws1 sends a canvas_update -- the server should broadcast to ws2 but NOT ws1
    sendJson(ws1, {
      type: "canvas_update",
      svg: '<svg><circle r="10"/></svg>',
    });

    await delay(300);

    // ws2 should have received the update (as a set_svg broadcast)
    const updateToWs2 = msgs2.filter(
      (m) => m.type === "set_svg" || m.type === "canvas_update"
    );
    expect(updateToWs2.length).toBeGreaterThanOrEqual(1);

    // ws1 (the sender) should NOT have received it back
    const echoToWs1 = msgs1.filter(
      (m) => m.type === "set_svg" || m.type === "canvas_update"
    );
    expect(echoToWs1.length).toBe(0);
  });

  it("should keep the remaining client tracked after one disconnects", async () => {
    const port = cm.getPort();
    cm.openCanvas(canvasName);

    const ws1 = await connectWs(port);
    wsClients.push(ws1);
    const ws2 = await connectWs(port);
    wsClients.push(ws2);

    sendJson(ws1, { type: "ready", canvas_name: canvasName });
    sendJson(ws2, { type: "ready", canvas_name: canvasName });
    await delay(200);

    // Disconnect ws1
    ws1.close();
    await delay(200);

    const session = cm.getSession(canvasName);
    expect(session).toBeDefined();
    expect(session!.clients).toBeInstanceOf(Set);
    expect(session!.clients.size).toBe(1);

    // The remaining client (ws2) should still receive updates
    const msgs2 = collectMessages(ws2);

    cm.setSvg(canvasName, '<svg><rect width="50" height="50"/></svg>');
    await delay(300);

    const svgMsgs = msgs2.filter((m) => m.type === "set_svg");
    expect(svgMsgs.length).toBeGreaterThanOrEqual(1);
  });
});
