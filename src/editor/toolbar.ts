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
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-6 2-4 6z"/></svg>`,
  },
  rect: {
    label: "Rectangle (R)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  },
  ellipse: {
    label: "Ellipse (E)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="8"/></svg>`,
  },
  triangle: {
    label: "Triangle (T)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,3 22,21 2,21"/></svg>`,
  },
  line: {
    label: "Line (L)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"/></svg>`,
  },
  arrow: {
    label: "Arrow (A)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="18" y2="6"/><polyline points="12,4 20,4 20,12"/></svg>`,
  },
  draw: {
    label: "Draw (D)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17c3-3 6-8 9-8s3 4 6 1"/></svg>`,
  },
  text: {
    label: "Text (X)",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="6" y="18" font-size="16" font-weight="bold">T</text></svg>`,
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

  // Fill color (with no-fill toggle)
  let fillEnabled = true;
  let lastFillColor = state.fillColor;
  const fillLabel = document.createElement("label");
  fillLabel.textContent = "Fill";
  const fillInput = document.createElement("input");
  fillInput.type = "color";
  fillInput.value = state.fillColor;
  fillInput.addEventListener("input", () => {
    lastFillColor = fillInput.value;
    if (fillEnabled) {
      state.fillColor = fillInput.value;
      callbacks.onFillChange(fillInput.value);
    }
  });
  fillLabel.appendChild(fillInput);

  const fillToggle = document.createElement("button");
  fillToggle.className = "color-toggle active";
  fillToggle.title = "Toggle fill (click to remove)";
  fillToggle.textContent = "\u2715";
  fillToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    fillEnabled = !fillEnabled;
    fillToggle.classList.toggle("active", fillEnabled);
    fillInput.disabled = !fillEnabled;
    if (fillEnabled) {
      state.fillColor = lastFillColor;
      callbacks.onFillChange(lastFillColor);
    } else {
      state.fillColor = "transparent";
      callbacks.onFillChange("transparent");
    }
  });
  fillLabel.appendChild(fillToggle);
  toolbar.appendChild(fillLabel);

  // Stroke color (with no-stroke toggle)
  let strokeEnabled = true;
  let lastStrokeColor = state.strokeColor;
  const strokeLabel = document.createElement("label");
  strokeLabel.textContent = "Stroke";
  const strokeInput = document.createElement("input");
  strokeInput.type = "color";
  strokeInput.value = state.strokeColor;
  strokeInput.addEventListener("input", () => {
    lastStrokeColor = strokeInput.value;
    if (strokeEnabled) {
      state.strokeColor = strokeInput.value;
      callbacks.onStrokeChange(strokeInput.value);
    }
  });
  strokeLabel.appendChild(strokeInput);

  const strokeToggle = document.createElement("button");
  strokeToggle.className = "color-toggle active";
  strokeToggle.title = "Toggle stroke (click to remove)";
  strokeToggle.textContent = "\u2715";
  strokeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    strokeEnabled = !strokeEnabled;
    strokeToggle.classList.toggle("active", strokeEnabled);
    strokeInput.disabled = !strokeEnabled;
    if (strokeEnabled) {
      state.strokeColor = lastStrokeColor;
      callbacks.onStrokeChange(lastStrokeColor);
    } else {
      state.strokeColor = "transparent";
      callbacks.onStrokeChange("transparent");
    }
  });
  strokeLabel.appendChild(strokeToggle);
  toolbar.appendChild(strokeLabel);

  // Stroke width
  const widthLabel = document.createElement("label");
  widthLabel.textContent = "Width";
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "0";
  widthInput.max = "20";
  widthInput.value = String(state.strokeWidth);
  widthInput.addEventListener("input", () => {
    state.strokeWidth = Number(widthInput.value);
    callbacks.onStrokeWidthChange(state.strokeWidth);
  });
  widthLabel.appendChild(widthInput);
  toolbar.appendChild(widthLabel);

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
