import { Canvas as FabricCanvas, Rect, Ellipse, Triangle, Line, PencilBrush, IText, FabricObject, FabricImage, loadSVGFromString } from "fabric";
import type { ToolType } from "./toolbar.ts";
import { initToolbar } from "./toolbar.ts";
import { initClipboardHandler } from "./clipboard.ts";

// Expose FabricImage for clipboard handler
(window as any).__fabric = { FabricImage };

// --- State ---
const canvasName = decodeURIComponent(window.location.pathname.split("/").pop() || "default");
let ws: WebSocket | null = null;
let connected = false;
let currentTool: ToolType = "select";
let isDrawingShape = false;
let shapeOrigin = { x: 0, y: 0 };
let activeShape: FabricObject | null = null;

// Undo/Redo
const undoStack: string[] = [];
const redoStack: string[] = [];
const MAX_UNDO = 50;
let skipSave = false;

// --- Canvas Setup ---
const container = document.getElementById("canvas-container")!;
const canvasEl = document.createElement("canvas");
canvasEl.id = "fabric-canvas";
container.appendChild(canvasEl);

const canvas = new FabricCanvas(canvasEl, {
  width: container.clientWidth,
  height: container.clientHeight,
  backgroundColor: "#ffffff",
  selection: true,
});

// Resize handling
window.addEventListener("resize", () => {
  canvas.setDimensions({
    width: container.clientWidth,
    height: container.clientHeight,
  });
});

// --- Toolbar ---
const toolbarState = initToolbar({
  onToolChange: (tool) => {
    currentTool = tool;
    applyToolMode();
  },
  onFillChange: (color) => {
    toolbarState.fillColor = color;
    updateSelectedObjects("fill", color);
  },
  onStrokeChange: (color) => {
    toolbarState.strokeColor = color;
    updateSelectedObjects("stroke", color);
  },
  onStrokeWidthChange: (width) => {
    toolbarState.strokeWidth = width;
    updateSelectedObjects("strokeWidth", width);
  },
  onUndo: undo,
  onRedo: redo,
});

function updateSelectedObjects(prop: string, value: any) {
  const active = canvas.getActiveObjects();
  for (const obj of active) {
    (obj as any).set(prop, value);
  }
  if (active.length) canvas.requestRenderAll();
}

function applyToolMode() {
  canvas.isDrawingMode = currentTool === "draw";
  canvas.selection = currentTool === "select";

  if (currentTool === "draw") {
    const brush = new PencilBrush(canvas);
    brush.color = toolbarState.strokeColor;
    brush.width = toolbarState.strokeWidth;
    canvas.freeDrawingBrush = brush;
  }

  // Set cursor
  if (currentTool === "select") {
    canvas.defaultCursor = "default";
  } else if (currentTool === "text") {
    canvas.defaultCursor = "text";
  } else if (currentTool !== "draw") {
    canvas.defaultCursor = "crosshair";
  }
}

// --- Shape Drawing ---
canvas.on("mouse:down", (opt) => {
  if (currentTool === "select" || currentTool === "draw") return;

  if (currentTool === "text") {
    const pointer = canvas.getScenePoint(opt.e);
    const text = new IText("Text", {
      left: pointer.x,
      top: pointer.y,
      fontSize: 20,
      fill: toolbarState.fillColor,
      fontFamily: "sans-serif",
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    saveState();
    currentTool = "select";
    applyToolMode();
    return;
  }

  const pointer = canvas.getScenePoint(opt.e);
  isDrawingShape = true;
  shapeOrigin = { x: pointer.x, y: pointer.y };

  const commonProps = {
    left: pointer.x,
    top: pointer.y,
    fill: toolbarState.fillColor,
    stroke: toolbarState.strokeColor,
    strokeWidth: toolbarState.strokeWidth,
    selectable: false,
    evented: false,
  };

  switch (currentTool) {
    case "rect":
      activeShape = new Rect({ ...commonProps, width: 0, height: 0 });
      break;
    case "ellipse":
      activeShape = new Ellipse({ ...commonProps, rx: 0, ry: 0 });
      break;
    case "triangle":
      activeShape = new Triangle({ ...commonProps, width: 0, height: 0 });
      break;
    case "line":
      activeShape = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: toolbarState.strokeColor,
        strokeWidth: toolbarState.strokeWidth,
        selectable: false,
        evented: false,
      });
      break;
  }

  if (activeShape) {
    canvas.add(activeShape);
  }
});

canvas.on("mouse:move", (opt) => {
  if (!isDrawingShape || !activeShape) return;

  const pointer = canvas.getScenePoint(opt.e);
  const dx = pointer.x - shapeOrigin.x;
  const dy = pointer.y - shapeOrigin.y;

  if (activeShape instanceof Rect || activeShape instanceof Triangle) {
    activeShape.set({
      left: dx >= 0 ? shapeOrigin.x : pointer.x,
      top: dy >= 0 ? shapeOrigin.y : pointer.y,
      width: Math.abs(dx),
      height: Math.abs(dy),
    });
  } else if (activeShape instanceof Ellipse) {
    activeShape.set({
      left: Math.min(shapeOrigin.x, pointer.x),
      top: Math.min(shapeOrigin.y, pointer.y),
      rx: Math.abs(dx) / 2,
      ry: Math.abs(dy) / 2,
    });
  } else if (activeShape instanceof Line) {
    activeShape.set({ x2: pointer.x, y2: pointer.y });
  }

  canvas.requestRenderAll();
});

canvas.on("mouse:up", () => {
  if (!isDrawingShape || !activeShape) return;

  activeShape.set({ selectable: true, evented: true });
  activeShape.setCoords();
  canvas.setActiveObject(activeShape);

  isDrawingShape = false;
  activeShape = null;
  saveState();
});

// --- Object Modification ---
canvas.on("object:modified", () => saveState());
canvas.on("path:created", () => saveState());

// --- Undo/Redo ---
function saveState() {
  if (skipSave) return;
  const json = JSON.stringify(canvas.toJSON());
  undoStack.push(json);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  scheduleAutoSave();
}

function undo() {
  if (undoStack.length <= 1) return;
  const current = undoStack.pop()!;
  redoStack.push(current);
  const prev = undoStack[undoStack.length - 1];
  restoreState(prev);
}

function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop()!;
  undoStack.push(next);
  restoreState(next);
}

async function restoreState(json: string) {
  skipSave = true;
  await canvas.loadFromJSON(json);
  canvas.requestRenderAll();
  skipSave = false;
  scheduleAutoSave();
}

// Save initial state
undoStack.push(JSON.stringify(canvas.toJSON()));

// --- Auto-save to server ---
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => sendCanvasUpdate(), 500);
}

function sendCanvasUpdate() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const svg = canvas.toSVG();
  ws.send(JSON.stringify({ type: "canvas_update", svg }));
}

// --- SVG Import from server ---
async function loadSvgToCanvas(svgString: string) {
  skipSave = true;
  canvas.clear();

  // Parse SVG dimensions for background
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = svgDoc.querySelector("svg");

  if (svgEl) {
    const bgColor = svgEl.getAttribute("style")?.match(/background:\s*([^;]+)/)?.[1]
      || svgEl.getAttribute("background")
      || "#ffffff";
    canvas.backgroundColor = bgColor;
  }

  try {
    const { objects } = await loadSVGFromString(svgString);
    const validObjects = objects.filter((o): o is FabricObject => o !== null);
    for (const obj of validObjects) {
      canvas.add(obj);
    }
  } catch (e) {
    console.error("SVG parse error:", e);
  }

  canvas.requestRenderAll();
  skipSave = false;

  // Reset undo stack with new state
  undoStack.length = 0;
  redoStack.length = 0;
  undoStack.push(JSON.stringify(canvas.toJSON()));
}

async function addSvgFragment(fragment: string) {
  // Wrap fragment in an SVG root for parsing
  const wrappedSvg = `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`;
  try {
    const { objects } = await loadSVGFromString(wrappedSvg);
    const validObjects = objects.filter((o): o is FabricObject => o !== null);
    for (const obj of validObjects) {
      canvas.add(obj);
    }
    canvas.requestRenderAll();
    saveState();
  } catch (e) {
    console.error("SVG fragment parse error:", e);
  }
}

// --- WebSocket Connection ---
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  const statusDot = document.querySelector(".status-dot");

  ws.onopen = () => {
    connected = true;
    if (statusDot) statusDot.classList.add("connected");
    ws!.send(JSON.stringify({ type: "ready", canvas_name: canvasName }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "set_svg":
          loadSvgToCanvas(msg.svg);
          break;
        case "add_element":
          addSvgFragment(msg.svg_fragment);
          break;
        case "ping":
          ws!.send(JSON.stringify({ type: "pong" }));
          break;
        case "close":
          window.close();
          break;
      }
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    connected = false;
    if (statusDot) statusDot.classList.remove("connected");
    // Reconnect after 2s
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

// --- Clipboard ---
initClipboardHandler(canvas, () => saveState());

// --- Canvas Name Display ---
const nameEl = document.querySelector(".canvas-name");
if (nameEl) nameEl.textContent = canvasName;

// --- Start ---
connectWebSocket();

// Set document title
document.title = `Sketch: ${canvasName}`;
