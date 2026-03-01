export type ToolType = "select" | "rect" | "ellipse" | "triangle" | "line" | "arrow" | "draw" | "text";

export interface ToolbarState {
  tool: ToolType;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

interface ToolbarCallbacks {
  onToolChange: (tool: ToolType) => void;
  onFillChange: (color: string) => void;
  onStrokeChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFormToggle?: () => void;
}

const TOOL_ICONS: Record<ToolType, { label: string; svg: string }> = {
  select: {
    label: "Select (V)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 10-6 1-3 7z"/></svg>`,
  },
  rect: {
    label: "Rectangle (R)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>`,
  },
  ellipse: {
    label: "Ellipse (E)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`,
  },
  triangle: {
    label: "Triangle (T)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 4L22 20H2z"/></svg>`,
  },
  line: {
    label: "Line (L)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>`,
  },
  arrow: {
    label: "Arrow (A)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="10 5 19 5 19 14"/></svg>`,
  },
  draw: {
    label: "Draw (D)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20H4v-4L17 3z"/></svg>`,
  },
  text: {
    label: "Text (X)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="5" x2="18" y2="5"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="8" y1="19" x2="16" y2="19"/></svg>`,
  },
};

export interface ToolbarHandle {
  state: ToolbarState;
  setActiveTool: (tool: ToolType) => void;
  formBtn: HTMLButtonElement;
}

export function initToolbar(callbacks: ToolbarCallbacks): ToolbarHandle {
  const toolbar = document.getElementById("toolbar")!;
  const state: ToolbarState = {
    tool: "select",
    fillColor: "#4dabf7",
    strokeColor: "#1c7ed6",
    strokeWidth: 2,
  };

  // Identity separator (after canvas-name + status-dot in HTML)
  const identitySep = document.createElement("div");
  identitySep.className = "separator";
  toolbar.appendChild(identitySep);

  // Tool buttons
  const toolOrder: ToolType[] = ["select", "rect", "ellipse", "triangle", "line", "arrow", "draw", "text"];
  const buttons = new Map<ToolType, HTMLButtonElement>();

  for (const tool of toolOrder) {
    const btn = document.createElement("button");
    btn.title = TOOL_ICONS[tool].label;
    btn.setAttribute("aria-label", TOOL_ICONS[tool].label);
    btn.innerHTML = TOOL_ICONS[tool].svg;
    btn.addEventListener("click", () => setActiveTool(tool));
    toolbar.appendChild(btn);
    buttons.set(tool, btn);
  }

  function setActiveTool(tool: ToolType) {
    state.tool = tool;
    for (const [t, b] of buttons) {
      b.classList.toggle("active", t === tool);
    }
    callbacks.onToolChange(tool);
  }

  // Separator
  const sep1 = document.createElement("div");
  sep1.className = "separator";
  toolbar.appendChild(sep1);

  // Undo/Redo
  const undoBtn = document.createElement("button");
  undoBtn.title = "Undo (Ctrl+Z)";
  undoBtn.setAttribute("aria-label", "Undo");
  undoBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h13a4 4 0 010 8H9"/><polyline points="7 6 3 10 7 14"/></svg>`;
  undoBtn.addEventListener("click", callbacks.onUndo);
  toolbar.appendChild(undoBtn);

  const redoBtn = document.createElement("button");
  redoBtn.title = "Redo (Ctrl+Shift+Z)";
  redoBtn.setAttribute("aria-label", "Redo");
  redoBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10H8a4 4 0 000 8h7"/><polyline points="17 6 21 10 17 14"/></svg>`;
  redoBtn.addEventListener("click", callbacks.onRedo);
  toolbar.appendChild(redoBtn);

  // Separator
  const sep2 = document.createElement("div");
  sep2.className = "separator";
  toolbar.appendChild(sep2);

  // Fill color (compact: icon + swatch + toggle, no text label)
  let fillEnabled = true;
  let lastFillColor = state.fillColor;
  const fillGroup = document.createElement("div");
  fillGroup.className = "style-control";
  fillGroup.title = "Fill color";

  const fillIcon = document.createElement("span");
  fillIcon.className = "style-icon";
  fillIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="currentColor" rx="1.5"/></svg>`;
  fillGroup.appendChild(fillIcon);

  const fillInput = document.createElement("input");
  fillInput.type = "color";
  fillInput.value = state.fillColor;
  fillInput.setAttribute("aria-label", "Fill color");
  fillInput.addEventListener("input", () => {
    lastFillColor = fillInput.value;
    if (fillEnabled) {
      state.fillColor = fillInput.value;
      callbacks.onFillChange(fillInput.value);
    }
  });
  fillGroup.appendChild(fillInput);

  const fillToggle = document.createElement("button");
  fillToggle.className = "color-toggle active";
  fillToggle.title = "Toggle fill";
  fillToggle.setAttribute("aria-label", "Toggle fill");
  fillToggle.textContent = "\u2715";
  fillToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    fillEnabled = !fillEnabled;
    fillToggle.classList.toggle("active", fillEnabled);
    fillInput.disabled = !fillEnabled;
    fillIcon.classList.toggle("disabled", !fillEnabled);
    if (fillEnabled) {
      state.fillColor = lastFillColor;
      callbacks.onFillChange(lastFillColor);
    } else {
      state.fillColor = "transparent";
      callbacks.onFillChange("transparent");
    }
  });
  fillGroup.appendChild(fillToggle);
  toolbar.appendChild(fillGroup);

  // Stroke color (compact: icon + swatch + toggle, no text label)
  let strokeEnabled = true;
  let lastStrokeColor = state.strokeColor;
  const strokeGroup = document.createElement("div");
  strokeGroup.className = "style-control";
  strokeGroup.title = "Stroke color";

  const strokeIcon = document.createElement("span");
  strokeIcon.className = "style-icon";
  strokeIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.5" rx="1.5"/></svg>`;
  strokeGroup.appendChild(strokeIcon);

  const strokeInput = document.createElement("input");
  strokeInput.type = "color";
  strokeInput.value = state.strokeColor;
  strokeInput.setAttribute("aria-label", "Stroke color");
  strokeInput.addEventListener("input", () => {
    lastStrokeColor = strokeInput.value;
    if (strokeEnabled) {
      state.strokeColor = strokeInput.value;
      callbacks.onStrokeChange(strokeInput.value);
    }
  });
  strokeGroup.appendChild(strokeInput);

  const strokeToggle = document.createElement("button");
  strokeToggle.className = "color-toggle active";
  strokeToggle.title = "Toggle stroke";
  strokeToggle.setAttribute("aria-label", "Toggle stroke");
  strokeToggle.textContent = "\u2715";
  strokeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    strokeEnabled = !strokeEnabled;
    strokeToggle.classList.toggle("active", strokeEnabled);
    strokeInput.disabled = !strokeEnabled;
    strokeIcon.classList.toggle("disabled", !strokeEnabled);
    if (strokeEnabled) {
      state.strokeColor = lastStrokeColor;
      callbacks.onStrokeChange(lastStrokeColor);
    } else {
      state.strokeColor = "transparent";
      callbacks.onStrokeChange("transparent");
    }
  });
  strokeGroup.appendChild(strokeToggle);
  toolbar.appendChild(strokeGroup);

  // Stroke width (compact: just input with tooltip)
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "0";
  widthInput.max = "20";
  widthInput.value = String(state.strokeWidth);
  widthInput.title = "Stroke width";
  widthInput.setAttribute("aria-label", "Stroke width");
  widthInput.addEventListener("input", () => {
    state.strokeWidth = Number(widthInput.value);
    callbacks.onStrokeWidthChange(state.strokeWidth);
  });
  toolbar.appendChild(widthInput);

  // Form panel toggle button
  const sep3 = document.createElement("div");
  sep3.className = "separator";
  toolbar.appendChild(sep3);

  const formBtn = document.createElement("button");
  formBtn.title = "Template Fields (F)";
  formBtn.setAttribute("aria-label", "Template Fields");
  formBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>`;
  formBtn.style.display = "none";
  formBtn.addEventListener("click", () => callbacks.onFormToggle?.());
  toolbar.appendChild(formBtn);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Don't intercept when typing in inputs
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;

    const key = e.key.toLowerCase();
    const shortcutMap: Record<string, ToolType> = {
      v: "select", r: "rect", e: "ellipse", t: "triangle",
      l: "line", a: "arrow", d: "draw", x: "text",
    };

    if (shortcutMap[key] && !e.metaKey && !e.ctrlKey) {
      setActiveTool(shortcutMap[key]);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        callbacks.onRedo();
      } else {
        callbacks.onUndo();
      }
    }
  });

  // Set initial active
  setActiveTool("select");

  return { state, setActiveTool, formBtn };
}
