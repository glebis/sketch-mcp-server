import { describe, it, expect } from "vitest";
import { computeCropParams, constrainOverlay, CropManager } from "../src/editor/crop";

describe("computeCropParams", () => {
  it("computes crop for overlay at image origin with no prior crop", () => {
    const result = computeCropParams(
      { left: 100, top: 50, scaleX: 1, scaleY: 1, cropX: 0, cropY: 0, width: 400, height: 300 },
      { left: 100, top: 50, width: 200, height: 150 }
    );
    expect(result).toEqual({ cropX: 0, cropY: 0, width: 200, height: 150 });
  });

  it("computes crop for overlay offset from image origin", () => {
    const result = computeCropParams(
      { left: 100, top: 50, scaleX: 1, scaleY: 1, cropX: 0, cropY: 0, width: 400, height: 300 },
      { left: 150, top: 100, width: 200, height: 150 }
    );
    expect(result).toEqual({ cropX: 50, cropY: 50, width: 200, height: 150 });
  });

  it("accounts for image scale", () => {
    // Image is displayed at 2x scale: 400x300 source shown as 800x600 on canvas
    const result = computeCropParams(
      { left: 0, top: 0, scaleX: 2, scaleY: 2, cropX: 0, cropY: 0, width: 400, height: 300 },
      { left: 100, top: 100, width: 200, height: 200 }
    );
    // In source pixels: cropX = 100/2 = 50, cropY = 100/2 = 50, w = 200/2 = 100, h = 200/2 = 100
    expect(result).toEqual({ cropX: 50, cropY: 50, width: 100, height: 100 });
  });

  it("accounts for existing crop offset", () => {
    // Image already cropped at (20, 30) in source pixels
    const result = computeCropParams(
      { left: 100, top: 50, scaleX: 1, scaleY: 1, cropX: 20, cropY: 30, width: 380, height: 270 },
      { left: 110, top: 60, width: 200, height: 150 }
    );
    // newCropX = existingCropX + (overlayLeft - imageLeft) / scaleX = 20 + 10 = 30
    // newCropY = 30 + 10 = 40
    expect(result).toEqual({ cropX: 30, cropY: 40, width: 200, height: 150 });
  });

  it("handles non-uniform scale", () => {
    const result = computeCropParams(
      { left: 0, top: 0, scaleX: 2, scaleY: 0.5, cropX: 0, cropY: 0, width: 400, height: 300 },
      { left: 60, top: 30, width: 100, height: 50 }
    );
    // cropX = 60/2 = 30, cropY = 30/0.5 = 60, w = 100/2 = 50, h = 50/0.5 = 100
    expect(result).toEqual({ cropX: 30, cropY: 60, width: 50, height: 100 });
  });
});

describe("constrainOverlay", () => {
  const imageBounds = { left: 100, top: 50, width: 400, height: 300 };

  it("returns overlay unchanged when fully inside image", () => {
    const overlay = { left: 150, top: 100, width: 200, height: 150 };
    expect(constrainOverlay(overlay, imageBounds)).toEqual(overlay);
  });

  it("clamps overlay that extends past right edge", () => {
    const overlay = { left: 400, top: 50, width: 200, height: 100 };
    // right edge would be 600, image right is 500 -> shift left to 300
    const result = constrainOverlay(overlay, imageBounds);
    expect(result.left).toBe(300);
    expect(result.width).toBe(200);
  });

  it("clamps overlay that extends past bottom edge", () => {
    const overlay = { left: 100, top: 300, width: 100, height: 200 };
    // bottom would be 500, image bottom is 350 -> shift up to 150
    const result = constrainOverlay(overlay, imageBounds);
    expect(result.top).toBe(150);
    expect(result.height).toBe(200);
  });

  it("clamps overlay that extends past left/top edges", () => {
    const overlay = { left: 50, top: 20, width: 200, height: 150 };
    const result = constrainOverlay(overlay, imageBounds);
    expect(result.left).toBe(100);
    expect(result.top).toBe(50);
  });

  it("shrinks overlay width if wider than image", () => {
    const overlay = { left: 50, top: 50, width: 600, height: 100 };
    const result = constrainOverlay(overlay, imageBounds);
    expect(result.left).toBe(100);
    expect(result.width).toBe(400);
  });

  it("shrinks overlay height if taller than image", () => {
    const overlay = { left: 100, top: 20, width: 100, height: 500 };
    const result = constrainOverlay(overlay, imageBounds);
    expect(result.top).toBe(50);
    expect(result.height).toBe(300);
  });

  it("enforces minimum size of 10x10", () => {
    const overlay = { left: 200, top: 100, width: 3, height: 5 };
    const result = constrainOverlay(overlay, imageBounds);
    expect(result.width).toBeGreaterThanOrEqual(10);
    expect(result.height).toBeGreaterThanOrEqual(10);
  });
});

// Minimal mock of FabricImage-like object for CropManager tests
function makeMockImage(props: {
  left: number; top: number;
  scaleX: number; scaleY: number;
  cropX: number; cropY: number;
  width: number; height: number;
}) {
  const state: Record<string, any> = { ...props };
  return {
    get(key: string) { return state[key]; },
    set(updates: Record<string, any>) { Object.assign(state, updates); },
    setCoords() {},
    // expose state for assertions
    _state: state,
  };
}

describe("CropManager", () => {
  it("starts not in crop mode", () => {
    const mgr = new CropManager();
    expect(mgr.isCropping).toBe(false);
  });

  it("enters crop mode on uncropped image -- expands to full source", () => {
    const mgr = new CropManager();
    const img = makeMockImage({
      left: 100, top: 50, scaleX: 1, scaleY: 1,
      cropX: 0, cropY: 0, width: 400, height: 300,
    });
    const result = mgr.enterCrop(img as any, 400, 300);
    expect(mgr.isCropping).toBe(true);
    // No existing crop: imageBounds == cropArea == full image
    expect(result.imageBounds).toEqual({ left: 100, top: 50, width: 400, height: 300 });
    expect(result.cropArea).toEqual({ left: 100, top: 50, width: 400, height: 300 });
  });

  it("enters crop mode on already-cropped image -- shows full source", () => {
    const mgr = new CropManager();
    // Image was cropped: showing 200x150 from offset (50,50), at position (200, 100)
    const img = makeMockImage({
      left: 200, top: 100, scaleX: 1, scaleY: 1,
      cropX: 50, cropY: 50, width: 200, height: 150,
    });
    const result = mgr.enterCrop(img as any, 400, 300);

    // Image should be expanded: shifted left/up to show full source
    expect(img._state.left).toBe(150);   // 200 - 50*1
    expect(img._state.top).toBe(50);     // 100 - 50*1
    expect(img._state.cropX).toBe(0);
    expect(img._state.cropY).toBe(0);
    expect(img._state.width).toBe(400);
    expect(img._state.height).toBe(300);

    // imageBounds = full source at expanded position
    expect(result.imageBounds).toEqual({ left: 150, top: 50, width: 400, height: 300 });
    // cropArea = where the previous crop was (original position/size)
    expect(result.cropArea).toEqual({ left: 200, top: 100, width: 200, height: 150 });
  });

  it("enters crop on scaled+cropped image", () => {
    const mgr = new CropManager();
    const img = makeMockImage({
      left: 100, top: 100, scaleX: 2, scaleY: 2,
      cropX: 30, cropY: 20, width: 200, height: 150,
    });
    const result = mgr.enterCrop(img as any, 400, 300);

    // Expanded: left = 100 - 30*2 = 40, top = 100 - 20*2 = 60
    expect(img._state.left).toBe(40);
    expect(img._state.top).toBe(60);
    expect(result.imageBounds).toEqual({ left: 40, top: 60, width: 800, height: 600 });
    expect(result.cropArea).toEqual({ left: 100, top: 100, width: 400, height: 300 });
  });

  it("cancelCrop restores original image state including position", () => {
    const mgr = new CropManager();
    const img = makeMockImage({
      left: 200, top: 100, scaleX: 1, scaleY: 1,
      cropX: 50, cropY: 50, width: 200, height: 150,
    });
    mgr.enterCrop(img as any, 400, 300);

    // Image was expanded -- verify it changed
    expect(img._state.left).toBe(150);
    expect(img._state.cropX).toBe(0);

    mgr.cancelCrop();
    expect(mgr.isCropping).toBe(false);
    expect(img._state.left).toBe(200);
    expect(img._state.top).toBe(100);
    expect(img._state.cropX).toBe(50);
    expect(img._state.cropY).toBe(50);
    expect(img._state.width).toBe(200);
    expect(img._state.height).toBe(150);
  });

  it("applyCrop on uncropped image", () => {
    const mgr = new CropManager();
    const img = makeMockImage({
      left: 100, top: 50, scaleX: 1, scaleY: 1,
      cropX: 0, cropY: 0, width: 400, height: 300,
    });
    mgr.enterCrop(img as any, 400, 300);

    mgr.applyCrop({ left: 150, top: 100, width: 200, height: 150 });
    expect(mgr.isCropping).toBe(false);
    expect(img._state.left).toBe(150);
    expect(img._state.top).toBe(100);
    expect(img._state.cropX).toBe(50);
    expect(img._state.cropY).toBe(50);
    expect(img._state.width).toBe(200);
    expect(img._state.height).toBe(150);
  });

  it("applyCrop with scaled image", () => {
    const mgr = new CropManager();
    const img = makeMockImage({
      left: 0, top: 0, scaleX: 2, scaleY: 2,
      cropX: 0, cropY: 0, width: 400, height: 300,
    });
    mgr.enterCrop(img as any, 400, 300);

    // Overlay at 100,100 with size 200x200 in screen coords
    mgr.applyCrop({ left: 100, top: 100, width: 200, height: 200 });
    // In source pixels: cropX=50, cropY=50, w=100, h=100
    expect(img._state.left).toBe(100);
    expect(img._state.top).toBe(100);
    expect(img._state.cropX).toBe(50);
    expect(img._state.cropY).toBe(50);
    expect(img._state.width).toBe(100);
    expect(img._state.height).toBe(100);
  });

  it("re-crop: apply new crop on already-cropped image", () => {
    const mgr = new CropManager();
    // Previously cropped to (50,50) 200x150 of a 400x300 source
    const img = makeMockImage({
      left: 200, top: 100, scaleX: 1, scaleY: 1,
      cropX: 50, cropY: 50, width: 200, height: 150,
    });
    mgr.enterCrop(img as any, 400, 300);

    // Image expanded to (150, 50) showing full 400x300
    // Now crop to a different region: top-left corner, 100x100 in screen
    mgr.applyCrop({ left: 150, top: 50, width: 100, height: 100 });
    expect(img._state.left).toBe(150);
    expect(img._state.top).toBe(50);
    expect(img._state.cropX).toBe(0);
    expect(img._state.cropY).toBe(0);
    expect(img._state.width).toBe(100);
    expect(img._state.height).toBe(100);
  });

  it("throws if applyCrop called without entering crop mode", () => {
    const mgr = new CropManager();
    expect(() => mgr.applyCrop({ left: 0, top: 0, width: 100, height: 100 }))
      .toThrow();
  });

  it("cancelCrop when not cropping is a no-op", () => {
    const mgr = new CropManager();
    expect(() => mgr.cancelCrop()).not.toThrow();
    expect(mgr.isCropping).toBe(false);
  });
});
