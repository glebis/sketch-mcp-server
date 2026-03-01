import { Canvas as FabricCanvas, Rect, Ellipse, Triangle, Line, Polygon, Group, PencilBrush, IText, Textbox, FabricText, FabricObject, FabricImage, Point, loadSVGFromString } from "fabric";
import type { ToolType } from "./toolbar.ts";
import { initToolbar } from "./toolbar.ts";
import { initClipboardHandler } from "./clipboard.ts";

// Expose FabricImage for clipboard handler
(window as any).__fabric = { FabricImage };

// Register 'locked' so it survives JSON serialization
FabricObject.customProperties = [...(FabricObject.customProperties || []), "locked"];

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
  preserveObjectStacking: true,
});

// Resize handling
window.addEventListener("resize", () => {
  canvas.setDimensions({
    width: container.clientWidth,
    height: container.clientHeight,
  });
  canvas.requestRenderAll();
});

// --- Zoom & Pan ---
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Zoom indicator (auto-hides after 2s, visible on hover + click to cycle)
const zoomIndicator = document.createElement("div");
zoomIndicator.className = "zoom-indicator";
zoomIndicator.textContent = "100%";
document.body.appendChild(zoomIndicator);

let zoomHideTimer: ReturnType<typeof setTimeout> | null = null;
let lastCustomZoom = 1; // tracks the last non-100%/non-fit zoom level

function showZoomIndicator() {
  zoomIndicator.classList.add("visible");
  if (zoomHideTimer) clearTimeout(zoomHideTimer);
  zoomHideTimer = setTimeout(() => zoomIndicator.classList.remove("visible"), 2000);
}

function updateZoomIndicator() {
  const pct = Math.round(canvas.getZoom() * 100);
  zoomIndicator.textContent = `${pct}%`;
  showZoomIndicator();
}

// Click to cycle: current -> 100% -> fit all -> back to saved
zoomIndicator.addEventListener("click", () => {
  const currentZoom = canvas.getZoom();
  const is100 = Math.abs(currentZoom - 1) < 0.01;

  if (!is100) {
    // Save current as "custom", then go to 100%
    lastCustomZoom = currentZoom;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    updateZoomIndicator();
  } else {
    // At 100% -> fit all
    // Store viewport so next click can restore custom
    zoomToFit();
    const fitZoom = canvas.getZoom();
    // If fit == 100% (content fits naturally), restore custom instead
    if (Math.abs(fitZoom - 1) < 0.01 && Math.abs(lastCustomZoom - 1) > 0.01) {
      canvas.setZoom(lastCustomZoom);
      canvas.requestRenderAll();
    }
    updateZoomIndicator();
  }
});

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

// Scroll wheel zoom (also handles trackpad pinch via ctrlKey)
canvas.on("mouse:wheel", (opt) => {
  const e = opt.e as WheelEvent;
  e.preventDefault();
  e.stopPropagation();

  const delta = e.deltaY;
  let zoom = canvas.getZoom();
  zoom *= 0.999 ** delta;
  zoom = clampZoom(zoom);

  const point = canvas.getScenePoint(e);
  canvas.zoomToPoint(point, zoom);
  updateZoomIndicator();
});

// Middle-click drag pan
canvas.on("mouse:down", (opt) => {
  const e = opt.e as MouseEvent;
  if (e.button === 1) {
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    canvas.defaultCursor = "grabbing";
    canvas.selection = false;
    e.preventDefault();
  }
});

canvas.on("mouse:move", (opt) => {
  if (!isPanning) return;
  const e = opt.e as MouseEvent;
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  canvas.relativePan(new Point(dx, dy));
  panStart = { x: e.clientX, y: e.clientY };
});

canvas.on("mouse:up", (opt) => {
  if (isPanning) {
    isPanning = false;
    applyToolMode(); // restore cursor + selection
  }
});

// Zoom to fit all content
function zoomToFit() {
  const objects = canvas.getObjects();
  if (objects.length === 0) {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    updateZoomIndicator();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objects) {
    const bound = obj.getBoundingRect();
    minX = Math.min(minX, bound.left);
    minY = Math.min(minY, bound.top);
    maxX = Math.max(maxX, bound.left + bound.width);
    maxY = Math.max(maxY, bound.top + bound.height);
  }

  const padding = 40;
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  if (contentW <= 0 || contentH <= 0) return;

  const canvasW = canvas.getWidth();
  const canvasH = canvas.getHeight();
  let scale = Math.min(
    (canvasW - padding * 2) / contentW,
    (canvasH - padding * 2) / contentH,
  );
  scale = Math.min(scale, 1); // don't zoom in past 100%

  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); // reset first
  canvas.setZoom(scale);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  canvas.absolutePan(new Point(
    centerX * scale - canvasW / 2,
    centerY * scale - canvasH / 2,
  ));
  updateZoomIndicator();
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Prevent if typing in input/textarea
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const active = canvas.getActiveObject();
  if (active instanceof IText && active.isEditing) return;

  // Shift+. (">") -- toggle toolbar
  if (e.shiftKey && e.key === ">" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const toolbar = document.getElementById("toolbar")!;
    const hidden = toolbar.style.display === "none";
    toolbar.style.display = hidden ? "" : "none";
    // Resize canvas to fill freed/lost space
    canvas.setDimensions({ width: container.clientWidth, height: container.clientHeight });
    canvas.requestRenderAll();
    return;
  }

  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  switch (e.key) {
    case "0": // Reset to 100%, reset pan
      e.preventDefault();
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      updateZoomIndicator();
      break;
    case "1": // Zoom to fit
      e.preventDefault();
      zoomToFit();
      break;
    case "=":
    case "+": // Zoom in
      e.preventDefault();
      {
        const z = clampZoom(canvas.getZoom() * 1.25);
        const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
        canvas.zoomToPoint(center, z);
        updateZoomIndicator();
      }
      break;
    case "-": // Zoom out
      e.preventDefault();
      {
        const z = clampZoom(canvas.getZoom() / 1.25);
        const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
        canvas.zoomToPoint(center, z);
        updateZoomIndicator();
      }
      break;
    case "s": // Cmd+S -- download as PNG
      e.preventDefault();
      {
        const dataUrl = canvas.toDataURL({ format: "png" });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${canvasName}.png`;
        a.click();
      }
      break;
  }

  // Cmd+Shift+C -- copy image to clipboard
  if (e.key.toLowerCase() === "c" && e.shiftKey) {
    e.preventDefault();
    canvas.toCanvasElement()
      .toBlob((blob) => {
        if (blob) {
          navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        }
      }, "image/png");
  }
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
    isDrawingShape = true;
    shapeOrigin = { x: pointer.x, y: pointer.y };

    // Dashed preview rectangle while dragging
    activeShape = new Rect({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
      fill: "transparent",
      stroke: "#4dabf7",
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
    });
    canvas.add(activeShape);
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
    case "arrow":
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

  // Text tool: convert preview rect into IText or Textbox
  if (currentTool === "text") {
    const w = (activeShape as Rect).width || 0;
    const h = (activeShape as Rect).height || 0;
    const left = activeShape.left!;
    const top = activeShape.top!;
    canvas.remove(activeShape);

    let textObj: IText | Textbox;
    if (w < 10 && h < 10) {
      // Simple click -- free-width IText
      textObj = new IText("Text", {
        left: shapeOrigin.x,
        top: shapeOrigin.y,
        fontSize: 20,
        fill: toolbarState.fillColor,
        fontFamily: "sans-serif",
      });
    } else {
      // Dragged -- fixed-width Textbox with word wrap
      textObj = new Textbox("Text", {
        left,
        top,
        width: w,
        fontSize: 20,
        fill: toolbarState.fillColor,
        fontFamily: "sans-serif",
      });
    }

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    textObj.enterEditing();
    textObj.selectAll();

    isDrawingShape = false;
    activeShape = null;
    saveState();
    currentTool = "select";
    applyToolMode();
    return;
  }

  if (currentTool === "arrow" && activeShape instanceof Line) {
    const x1 = activeShape.x1!, y1 = activeShape.y1!;
    const x2 = activeShape.x2!, y2 = activeShape.y2!;
    canvas.remove(activeShape);

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(12, toolbarState.strokeWidth * 4);
    const headPoints = [
      { x: x2, y: y2 },
      { x: x2 - headLen * Math.cos(angle - Math.PI / 6), y: y2 - headLen * Math.sin(angle - Math.PI / 6) },
      { x: x2 - headLen * Math.cos(angle + Math.PI / 6), y: y2 - headLen * Math.sin(angle + Math.PI / 6) },
    ];

    const line = new Line([x1, y1, x2, y2], {
      stroke: toolbarState.strokeColor,
      strokeWidth: toolbarState.strokeWidth,
    });
    const head = new Polygon(headPoints, {
      fill: toolbarState.strokeColor,
      stroke: toolbarState.strokeColor,
      strokeWidth: 1,
    });

    const arrow = new Group([line, head], {
      selectable: true,
      evented: true,
    });
    canvas.add(arrow);
    canvas.setActiveObject(arrow);
  } else {
    activeShape.set({ selectable: true, evented: true });
    activeShape.setCoords();
    canvas.setActiveObject(activeShape);
  }

  isDrawingShape = false;
  activeShape = null;
  saveState();
});

// --- Object Modification ---
canvas.on("object:modified", () => saveState());
canvas.on("path:created", () => saveState());

// --- Delete selected objects ---
document.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  // Don't delete while editing text on canvas
  const active = canvas.getActiveObject();
  if (active instanceof IText && active.isEditing) return;

  const objects = canvas.getActiveObjects();
  if (objects.length === 0) return;

  e.preventDefault();
  canvas.discardActiveObject();
  for (const obj of objects) {
    canvas.remove(obj);
  }
  canvas.requestRenderAll();
  saveState();
});

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
  reapplyLockState();
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

// Convert FabricText to IText so double-click editing works
function toEditable(obj: FabricObject): FabricObject {
  if (obj instanceof FabricText && !(obj instanceof IText)) {
    const { text, ...props } = obj.toObject();
    const itext = new IText(text, props);
    itext.set({ left: obj.left, top: obj.top });
    return itext;
  }
  return obj;
}

// --- Manual SVG text extraction ---
// Fabric.js v6 loadSVGFromString often returns null for <text> elements.
// We extract them from the DOM and create IText objects directly.
function extractTextElements(svgString: string): { strippedSvg: string; textObjects: IText[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return { strippedSvg: svgString, textObjects: [] };

  const textEls = Array.from(svgEl.querySelectorAll("text"));
  const textObjects: IText[] = [];

  for (const t of textEls) {
    const x = parseFloat(t.getAttribute("x") || "0");
    const y = parseFloat(t.getAttribute("y") || "0");
    const fontSize = parseFloat(t.getAttribute("font-size") || "16");
    const fill = t.getAttribute("fill") || "#000000";
    const fontFamily = t.getAttribute("font-family") || "sans-serif";
    const fontWeight = t.getAttribute("font-weight") || "normal";
    const textContent = t.textContent || "";
    const textAnchor = t.getAttribute("text-anchor");
    const letterSpacing = t.getAttribute("letter-spacing");

    // SVG y = baseline; Fabric top = bounding box top. Offset ~80% of fontSize.
    let left = x;
    const top = y - fontSize * 0.82;

    const itext = new IText(textContent, {
      left,
      top,
      fontSize,
      fill,
      fontFamily,
      fontWeight: fontWeight === "bold" ? "bold" : "normal",
    });

    // text-anchor: adjust origin
    if (textAnchor === "middle") {
      itext.set("originX", "center");
    } else if (textAnchor === "end") {
      itext.set("originX", "right");
    }

    // letter-spacing (SVG px → Fabric charSpacing in 1/1000 em)
    if (letterSpacing) {
      const px = parseFloat(letterSpacing);
      itext.set("charSpacing", (px / fontSize) * 1000);
    }

    textObjects.push(itext);
    t.parentNode?.removeChild(t);
  }

  const strippedSvg = new XMLSerializer().serializeToString(svgEl);
  return { strippedSvg, textObjects };
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

  // Extract text manually (Fabric SVG parser drops <text> elements)
  const { strippedSvg, textObjects } = extractTextElements(svgString);

  try {
    const { objects } = await loadSVGFromString(strippedSvg);
    for (const obj of objects) {
      if (obj) canvas.add(toEditable(obj));
    }
  } catch (e) {
    console.error("SVG parse error:", e);
  }

  // Add manually-parsed text objects
  for (const t of textObjects) {
    canvas.add(t);
  }

  canvas.requestRenderAll();
  skipSave = false;

  // Reset undo stack with new state
  undoStack.length = 0;
  redoStack.length = 0;
  undoStack.push(JSON.stringify(canvas.toJSON()));
}

function clearCanvas() {
  skipSave = true;
  canvas.clear();
  canvas.backgroundColor = "#ffffff";
  canvas.requestRenderAll();
  skipSave = false;
  undoStack.length = 0;
  redoStack.length = 0;
  undoStack.push(JSON.stringify(canvas.toJSON()));
}

async function addSvgFragment(fragment: string) {
  const wrappedSvg = `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`;

  // Extract text manually (Fabric SVG parser drops <text> elements)
  const { strippedSvg, textObjects } = extractTextElements(wrappedSvg);

  try {
    const { objects } = await loadSVGFromString(strippedSvg);
    for (const obj of objects) {
      if (obj) canvas.add(toEditable(obj));
    }
  } catch (e) {
    console.error("SVG fragment parse error:", e);
  }

  // Add manually-parsed text objects
  for (const t of textObjects) {
    canvas.add(t);
  }

  canvas.requestRenderAll();
  saveState();
}

// --- Lock / Unlock ---
function lockAllObjects() {
  for (const obj of canvas.getObjects()) {
    (obj as any).locked = true;
    obj.set({
      selectable: false,
      evented: false,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
    });
  }
  canvas.discardActiveObject();
  canvas.requestRenderAll();
}

function unlockAllObjects() {
  for (const obj of canvas.getObjects()) {
    (obj as any).locked = false;
    obj.set({
      selectable: true,
      evented: true,
      hasControls: true,
      lockMovementX: false,
      lockMovementY: false,
    });
  }
  canvas.requestRenderAll();
}

function reapplyLockState() {
  for (const obj of canvas.getObjects()) {
    if ((obj as any).locked) {
      obj.set({
        selectable: false,
        evented: false,
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
      });
    }
  }
}

// --- Load Canvas JSON (for templates) ---
async function loadCanvasJson(jsonStr: string) {
  skipSave = true;
  await canvas.loadFromJSON(jsonStr);
  reapplyLockState();
  canvas.requestRenderAll();
  skipSave = false;
  undoStack.length = 0;
  redoStack.length = 0;
  undoStack.push(JSON.stringify(canvas.toJSON()));
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
        case "clear":
          clearCanvas();
          break;
        case "focus":
          window.focus();
          break;
        case "add_textbox": {
          const opts = msg.options;
          const tb = new Textbox(opts.text || "Text", {
            left: opts.x,
            top: opts.y,
            width: opts.width,
            fontSize: opts.fontSize || 20,
            fill: opts.fill || "#000000",
            fontFamily: opts.fontFamily || "sans-serif",
          });
          canvas.add(tb);
          canvas.requestRenderAll();
          saveState();
          break;
        }
        case "lock_all":
          lockAllObjects();
          break;
        case "unlock_all":
          unlockAllObjects();
          break;
        case "request_json":
          ws!.send(JSON.stringify({
            type: "canvas_json",
            request_id: msg.request_id,
            json: JSON.stringify(canvas.toJSON()),
          }));
          break;
        case "request_screenshot": {
          const dataUrl = canvas.toDataURL({ format: "png" });
          ws!.send(JSON.stringify({
            type: "canvas_screenshot",
            request_id: msg.request_id,
            data_url: dataUrl,
          }));
          break;
        }
        case "load_json":
          loadCanvasJson(msg.json);
          break;
        case "set_zoom": {
          const zoom = clampZoom(msg.value);
          if (msg.cx !== undefined && msg.cy !== undefined) {
            canvas.zoomToPoint(new Point(msg.cx, msg.cy), zoom);
          } else {
            canvas.setZoom(zoom);
          }
          canvas.requestRenderAll();
          updateZoomIndicator();
          break;
        }
        case "pan_to":
          canvas.absolutePan(new Point(msg.x, msg.y));
          canvas.requestRenderAll();
          break;
        case "zoom_to_fit":
          zoomToFit();
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
