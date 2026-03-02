import { Canvas as FabricCanvas, PencilBrush } from "fabric";

// --- State ---
const canvasName = decodeURIComponent(window.location.pathname.split("/").pop() || "default");
let ws: WebSocket | null = null;
let connected = false;
let desktopWidth = 1200;
let desktopHeight = 800;
let scaleFactor = 1;

// --- Status indicator ---
const statusDot = document.createElement("div");
statusDot.className = "status-indicator";
document.body.appendChild(statusDot);

// --- Draw canvas setup ---
const canvasArea = document.getElementById("canvas-area")!;
const canvasEl = document.getElementById("draw-canvas") as HTMLCanvasElement;

const fabricCanvas = new FabricCanvas(canvasEl, {
  width: canvasArea.clientWidth,
  height: canvasArea.clientHeight,
  backgroundColor: "#ffffff",
  isDrawingMode: true,
  selection: false,
});

const brush = new PencilBrush(fabricCanvas);
brush.color = "#000000";
brush.width = 3;
fabricCanvas.freeDrawingBrush = brush;

// --- Draw toolbar ---
const toolbar = document.createElement("div");
toolbar.id = "draw-toolbar";
toolbar.innerHTML = `
  <input type="color" id="brush-color" value="#000000" title="Brush color">
  <input type="range" id="brush-size" min="1" max="20" value="3">
  <span class="brush-size-label">3</span>
  <button id="undo-btn">Undo</button>
  <button id="clear-draw-btn">Clear</button>
`;
canvasArea.parentElement!.insertBefore(toolbar, canvasArea);

const colorInput = document.getElementById("brush-color") as HTMLInputElement;
const sizeInput = document.getElementById("brush-size") as HTMLInputElement;
const sizeLabel = toolbar.querySelector(".brush-size-label")!;

colorInput.addEventListener("input", () => {
  brush.color = colorInput.value;
});

sizeInput.addEventListener("input", () => {
  brush.width = parseInt(sizeInput.value, 10);
  sizeLabel.textContent = sizeInput.value;
});

document.getElementById("undo-btn")!.addEventListener("click", () => {
  const objects = fabricCanvas.getObjects();
  if (objects.length > 0) {
    fabricCanvas.remove(objects[objects.length - 1]);
    fabricCanvas.requestRenderAll();
  }
});

document.getElementById("clear-draw-btn")!.addEventListener("click", () => {
  fabricCanvas.clear();
  fabricCanvas.backgroundColor = "#ffffff";
  fabricCanvas.requestRenderAll();
});

// --- Resize canvas to fill available space ---
function resizeCanvas() {
  const canvasWidth = canvasArea.clientWidth;
  const canvasHeight = canvasArea.clientHeight;

  fabricCanvas.setDimensions({ width: canvasWidth, height: canvasHeight });
  scaleFactor = desktopWidth / canvasWidth;
  fabricCanvas.requestRenderAll();
}

// --- Live stroke streaming ---
let currentPoints: Array<{ x: number; y: number }> = [];
let streamInterval: ReturnType<typeof setInterval> | null = null;

fabricCanvas.on("mouse:down", () => {
  currentPoints = [];
  streamInterval = setInterval(flushPoints, 50);
});

fabricCanvas.on("mouse:move", (opt) => {
  if (!fabricCanvas.isDrawingMode || !opt.pointer) return;
  // Only collect while brush is active (mouse is down)
  if (currentPoints !== null && streamInterval !== null) {
    currentPoints.push({ x: opt.pointer.x, y: opt.pointer.y });
  }
});

fabricCanvas.on("mouse:up", () => {
  flushPoints();
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
  currentPoints = [];
});

function flushPoints() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (currentPoints.length === 0) return;

  const points = currentPoints.splice(0);
  ws.send(JSON.stringify({
    type: "draw_points",
    points,
    color: brush.color,
    width: brush.width,
    scale_factor: scaleFactor,
  }));
}

// Send completed path after stroke finishes
fabricCanvas.on("path:created", (opt: any) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const pathObj = opt.path;
  if (!pathObj) return;

  // Serialize path data
  const pathData = pathObj.toJSON();
  ws.send(JSON.stringify({
    type: "draw_complete",
    path_data: JSON.stringify(pathData),
    color: brush.color,
    width: brush.width,
  }));
});

// --- Tab navigation ---
const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
const canvasAreaEl = document.getElementById("canvas-area")!;
const drawToolbar = document.getElementById("draw-toolbar")!;
const textPanel = document.getElementById("text-panel")!;
const photoPanel = document.getElementById("photo-panel")!;
const tabBar = document.getElementById("tab-bar")!;
const collapseBtn = document.getElementById("collapse-btn")!;

let activeTab = "draw";

function switchTab(tab: string) {
  activeTab = tab;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));

  canvasAreaEl.classList.toggle("hidden", tab !== "draw");
  drawToolbar.classList.toggle("hidden", tab !== "draw");
  textPanel.classList.toggle("hidden", tab !== "text");
  photoPanel.classList.toggle("hidden", tab !== "photo");

  if (tab === "draw") {
    resizeCanvas();
  }
}

tabs.forEach((t) => {
  t.addEventListener("click", () => switchTab(t.dataset.tab!));
});

collapseBtn.addEventListener("click", () => {
  tabBar.classList.toggle("collapsed");
});

// --- Text fields ---
interface TextboxInfo {
  index: number;
  text: string;
  label: string;
}

function renderTextFields(textboxes: TextboxInfo[]) {
  const container = document.getElementById("text-fields")!;
  const emptyState = textPanel.querySelector(".empty-state")!;
  container.innerHTML = "";

  if (textboxes.length === 0) {
    (emptyState as HTMLElement).style.display = "block";
    return;
  }
  (emptyState as HTMLElement).style.display = "none";

  for (const tb of textboxes) {
    const group = document.createElement("div");
    group.className = "text-field-group";

    const label = document.createElement("label");
    label.textContent = tb.label;
    label.setAttribute("for", `textbox-${tb.index}`);

    const textarea = document.createElement("textarea");
    textarea.id = `textbox-${tb.index}`;
    textarea.value = tb.text;
    textarea.dataset.objectIndex = String(tb.index);

    let debounceTimer: ReturnType<typeof setTimeout>;
    textarea.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "update_textbox",
          object_index: tb.index,
          text: textarea.value,
        }));
      }, 200);
    });

    group.appendChild(label);
    group.appendChild(textarea);
    container.appendChild(group);
  }
}

// --- Photo capture (multi-photo with preview grid) ---
const photoInput = document.getElementById("photo-input") as HTMLInputElement;
const galleryInput = document.getElementById("gallery-input") as HTMLInputElement;
const photoGrid = document.getElementById("photo-grid")!;
const photoEmptyState = document.querySelector(".photo-empty-state") as HTMLElement;

interface PhotoEntry {
  localId: string;       // local tracking before server ack
  photoId: string | null; // server-assigned ID (null until ack)
  thumbSrc: string;       // data URL for preview
}

const photos: PhotoEntry[] = [];
// Map local upload IDs to pending entries (for matching photo_ack)
const pendingUploads: Map<string, PhotoEntry> = new Map();
let uploadCounter = 0;

function processFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
        else { w = Math.round(w * (MAX / h)); h = MAX; }
      }

      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);

      const dataBase64 = cvs.toDataURL("image/jpeg", 0.8).split(",")[1];
      const thumbSrc = `data:image/jpeg;base64,${dataBase64}`;

      const localId = `local_${++uploadCounter}`;
      const entry: PhotoEntry = { localId, photoId: null, thumbSrc };
      photos.push(entry);
      pendingUploads.set(localId, entry);
      renderPhotoGrid();

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "photo_upload",
          data_base64: dataBase64,
          width: w,
          height: h,
          _local_id: localId,
        }));
      }
    };
    img.src = reader.result as string;
  };
  reader.readAsDataURL(file);
}

function handleFiles(files: FileList | null) {
  if (!files) return;
  for (let i = 0; i < files.length; i++) {
    processFile(files[i]);
  }
}

function handlePhotoAck(photoId: string) {
  // Match ack to the oldest pending upload
  for (const [localId, entry] of pendingUploads) {
    if (entry.photoId === null) {
      entry.photoId = photoId;
      pendingUploads.delete(localId);
      renderPhotoGrid();
      return;
    }
  }
}

function deletePhoto(index: number) {
  const entry = photos[index];
  if (!entry) return;

  // Tell server to remove from desktop canvas
  if (entry.photoId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "photo_delete", photo_id: entry.photoId }));
  }

  photos.splice(index, 1);
  renderPhotoGrid();
}

// --- Drag-to-reorder state ---
let dragIndex: number | null = null;

function renderPhotoGrid() {
  photoGrid.innerHTML = "";
  photoEmptyState.style.display = photos.length === 0 ? "block" : "none";

  for (let i = 0; i < photos.length; i++) {
    const entry = photos[i];
    const item = document.createElement("div");
    item.className = "photo-item";
    item.draggable = true;
    item.dataset.index = String(i);

    const img = document.createElement("img");
    img.src = entry.thumbSrc;
    img.alt = `Photo ${i + 1}`;
    item.appendChild(img);

    if (!entry.photoId) {
      const spinner = document.createElement("div");
      spinner.className = "photo-uploading";
      item.appendChild(spinner);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "photo-delete";
    deleteBtn.setAttribute("aria-label", `Delete photo ${i + 1}`);
    deleteBtn.textContent = "\u00d7";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePhoto(i);
    });
    item.appendChild(deleteBtn);

    // Drag events
    item.addEventListener("dragstart", (e) => {
      dragIndex = i;
      item.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      dragIndex = null;
      item.classList.remove("dragging");
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== i) {
        const moved = photos.splice(dragIndex, 1)[0];
        photos.splice(i, 0, moved);
        renderPhotoGrid();
      }
    });

    // Touch drag support
    item.addEventListener("touchstart", (e) => {
      dragIndex = i;
      item.classList.add("dragging");
      e.preventDefault();
    }, { passive: false });

    item.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetItem = el?.closest(".photo-item") as HTMLElement | null;
      // Highlight drop target
      photoGrid.querySelectorAll(".photo-item").forEach(
        (pi) => pi.classList.remove("drag-over")
      );
      if (targetItem && targetItem !== item) {
        targetItem.classList.add("drag-over");
      }
    }, { passive: false });

    item.addEventListener("touchend", (e) => {
      item.classList.remove("dragging");
      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetItem = el?.closest(".photo-item") as HTMLElement | null;
      photoGrid.querySelectorAll(".photo-item").forEach(
        (pi) => pi.classList.remove("drag-over")
      );
      if (targetItem && dragIndex !== null) {
        const targetIndex = Number(targetItem.dataset.index);
        if (targetIndex !== dragIndex) {
          const moved = photos.splice(dragIndex, 1)[0];
          photos.splice(targetIndex, 0, moved);
          renderPhotoGrid();
        }
      }
      dragIndex = null;
    });

    photoGrid.appendChild(item);
  }
}

photoInput.addEventListener("change", () => {
  handleFiles(photoInput.files);
  photoInput.value = "";
});

galleryInput.addEventListener("change", () => {
  handleFiles(galleryInput.files);
  galleryInput.value = "";
});

// --- WebSocket connection ---
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected = true;
    statusDot.classList.add("connected");
    ws!.send(JSON.stringify({
      type: "ready",
      canvas_name: canvasName,
      client_type: "mobile",
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "canvas_textboxes":
          renderTextFields(msg.textboxes);
          break;
        case "canvas_dimensions":
          desktopWidth = msg.width;
          desktopHeight = msg.height;
          resizeCanvas();
          break;
        case "photo_ack":
          handlePhotoAck(msg.photo_id);
          break;
        case "set_svg":
          // Mobile doesn't render the full SVG, just stores dimensions
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
    statusDot.classList.remove("connected");
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

// --- Window resize ---
window.addEventListener("resize", () => {
  if (activeTab === "draw") {
    resizeCanvas();
  }
});

// --- Start ---
resizeCanvas();
connectWebSocket();
document.title = `Sketch: ${canvasName}`;
