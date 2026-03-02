import { Canvas as FabricCanvas, Rect, FabricImage, FabricObject } from "fabric";
import { CropManager, constrainOverlay } from "./crop";

/**
 * Wire crop mode into the Fabric.js canvas.
 * Double-click on an image enters crop mode with a resizable overlay.
 */
export function initCropHandler(
  canvas: FabricCanvas,
  onModified: () => void,
): { manager: CropManager } {
  const manager = new CropManager();
  let cropOverlay: Rect | null = null;
  let dimOverlay: Rect | null = null;
  let cropBar: HTMLDivElement | null = null;

  // Image bounds in screen coords (for constraining)
  let imageBounds = { left: 0, top: 0, width: 0, height: 0 };

  canvas.on("mouse:dblclick", (opt) => {
    if (manager.isCropping) return;
    const target = opt.target;
    if (!target || !(target instanceof FabricImage)) return;
    enterCropMode(target);
  });

  function enterCropMode(image: FabricImage) {
    // Get full source dimensions from the image element
    const el = image.getElement() as HTMLImageElement;
    const sourceWidth = el.naturalWidth || el.width;
    const sourceHeight = el.naturalHeight || el.height;

    const { imageBounds: fullBounds, cropArea } = manager.enterCrop(
      image as any, sourceWidth, sourceHeight
    );

    imageBounds = fullBounds;

    // Dim overlay covers full uncropped image (semi-transparent)
    dimOverlay = new Rect({
      left: fullBounds.left,
      top: fullBounds.top,
      width: fullBounds.width,
      height: fullBounds.height,
      fill: "rgba(0, 0, 0, 0.5)",
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });

    // Crop selection rect -- positioned at current crop area
    cropOverlay = new Rect({
      left: cropArea.left,
      top: cropArea.top,
      width: cropArea.width,
      height: cropArea.height,
      fill: "rgba(255, 255, 255, 0.01)", // nearly transparent to see through
      stroke: "#ffffff",
      strokeWidth: 2,
      strokeDashArray: [6, 3],
      cornerColor: "#ffffff",
      cornerStrokeColor: "#333333",
      cornerSize: 10,
      transparentCorners: false,
      hasRotatingPoint: false,
      lockRotation: true,
      excludeFromExport: true,
    });

    // Remove rotate control
    cropOverlay.setControlVisible("mtr", false);

    canvas.add(dimOverlay);
    canvas.add(cropOverlay);
    canvas.setActiveObject(cropOverlay);
    canvas.requestRenderAll();

    // Disable selection of other objects
    for (const obj of canvas.getObjects()) {
      if (obj !== cropOverlay && obj !== dimOverlay) {
        obj.set({ evented: false });
      }
    }

    // Constrain on move/scale
    cropOverlay.on("moving", () => constrainCropRect());
    cropOverlay.on("scaling", () => constrainCropRect());
    // Clicking outside the crop overlay confirms the crop
    cropOverlay.on("deselected", () => {
      if (manager.isCropping) applyCrop();
    });

    showCropBar();
  }

  function constrainCropRect() {
    if (!cropOverlay) return;

    // After scaling, convert scale to actual width/height
    const w = (cropOverlay.width || 0) * (cropOverlay.scaleX || 1);
    const h = (cropOverlay.height || 0) * (cropOverlay.scaleY || 1);

    const proposed = {
      left: cropOverlay.left || 0,
      top: cropOverlay.top || 0,
      width: w,
      height: h,
    };

    const constrained = constrainOverlay(proposed, imageBounds);

    cropOverlay.set({
      left: constrained.left,
      top: constrained.top,
      width: constrained.width,
      height: constrained.height,
      scaleX: 1,
      scaleY: 1,
    });
    cropOverlay.setCoords();
    canvas.requestRenderAll();
  }

  function showCropBar() {
    if (cropBar) cropBar.remove();

    cropBar = document.createElement("div");
    cropBar.className = "crop-bar";
    cropBar.innerHTML = `
      <button class="crop-btn crop-confirm">Apply Crop</button>
      <button class="crop-btn crop-cancel">Cancel</button>
    `;

    cropBar.querySelector(".crop-confirm")!.addEventListener("click", applyCrop);
    cropBar.querySelector(".crop-cancel")!.addEventListener("click", cancelCrop);

    document.body.appendChild(cropBar);
  }

  function hideCropBar() {
    if (cropBar) {
      cropBar.remove();
      cropBar = null;
    }
  }

  function applyCrop() {
    if (!cropOverlay) return;

    const overlay = {
      left: cropOverlay.left || 0,
      top: cropOverlay.top || 0,
      width: (cropOverlay.width || 0) * (cropOverlay.scaleX || 1),
      height: (cropOverlay.height || 0) * (cropOverlay.scaleY || 1),
    };

    cleanupOverlays();
    manager.applyCrop(overlay);
    restoreObjectEvents();
    hideCropBar();
    canvas.requestRenderAll();
    onModified();
  }

  function cancelCrop() {
    cleanupOverlays();
    manager.cancelCrop();
    restoreObjectEvents();
    hideCropBar();
    canvas.requestRenderAll();
  }

  function cleanupOverlays() {
    if (cropOverlay) {
      canvas.remove(cropOverlay);
      cropOverlay = null;
    }
    if (dimOverlay) {
      canvas.remove(dimOverlay);
      dimOverlay = null;
    }
    canvas.discardActiveObject();
  }

  function restoreObjectEvents() {
    for (const obj of canvas.getObjects()) {
      if (!(obj as any).locked) {
        obj.set({ evented: true });
      }
    }
  }

  // Escape cancels crop
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && manager.isCropping) {
      e.preventDefault();
      cancelCrop();
    }
    // Enter confirms crop
    if (e.key === "Enter" && manager.isCropping) {
      e.preventDefault();
      applyCrop();
    }
  });

  return { manager };
}
