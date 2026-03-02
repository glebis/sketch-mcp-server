// Crop math utilities for Fabric.js image cropping
// Uses FabricImage's built-in cropX/cropY/width/height properties

export interface ImageCropState {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  cropX: number;
  cropY: number;
  width: number;
  height: number;
}

export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropResult {
  cropX: number;
  cropY: number;
  width: number;
  height: number;
}

/**
 * Convert screen-space overlay rect to source-image crop parameters.
 * Accounts for image scale and any existing crop offset.
 */
export function computeCropParams(image: ImageCropState, overlay: OverlayRect): CropResult {
  const cropX = image.cropX + (overlay.left - image.left) / image.scaleX;
  const cropY = image.cropY + (overlay.top - image.top) / image.scaleY;
  const width = overlay.width / image.scaleX;
  const height = overlay.height / image.scaleY;
  return { cropX, cropY, width, height };
}

export interface ImageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_CROP_SIZE = 10;

/**
 * Constrain overlay rect to stay within image bounds.
 * Clamps position and shrinks dimensions if necessary.
 */
export function constrainOverlay(overlay: OverlayRect, bounds: ImageBounds): OverlayRect {
  let { left, top, width, height } = overlay;

  // Clamp dimensions to image size
  width = Math.min(width, bounds.width);
  height = Math.min(height, bounds.height);

  // Enforce minimum size
  width = Math.max(width, MIN_CROP_SIZE);
  height = Math.max(height, MIN_CROP_SIZE);

  // Clamp position: can't go before image origin
  left = Math.max(left, bounds.left);
  top = Math.max(top, bounds.top);

  // Can't extend past image right/bottom edge
  if (left + width > bounds.left + bounds.width) {
    left = bounds.left + bounds.width - width;
  }
  if (top + height > bounds.top + bounds.height) {
    top = bounds.top + bounds.height - height;
  }

  return { left, top, width, height };
}

/** Minimal interface for the image object CropManager operates on */
export interface CroppableImage {
  get(key: string): any;
  set(updates: Record<string, any>): void;
  setCoords(): void;
}

export interface CropEnterResult {
  /** Full uncropped image bounds in screen coords */
  imageBounds: OverlayRect;
  /** Current crop area in screen coords (equals imageBounds if uncropped) */
  cropArea: OverlayRect;
}

/**
 * Manages crop mode lifecycle: enter, apply, cancel.
 * On enter, expands image to full source so user sees uncropped content.
 * Stores original state so cancel restores everything.
 */
export class CropManager {
  isCropping = false;
  private _image: CroppableImage | null = null;
  private _original: ImageCropState | null = null;
  private _sourceWidth = 0;
  private _sourceHeight = 0;

  /**
   * Enter crop mode. Expands image to show full uncropped source.
   * @param sourceWidth  Full source image width in pixels
   * @param sourceHeight Full source image height in pixels
   */
  enterCrop(image: CroppableImage, sourceWidth: number, sourceHeight: number): CropEnterResult {
    this.isCropping = true;
    this._image = image;
    this._sourceWidth = sourceWidth;
    this._sourceHeight = sourceHeight;

    const left = image.get("left") as number;
    const top = image.get("top") as number;
    const scaleX = image.get("scaleX") as number;
    const scaleY = image.get("scaleY") as number;
    const cropX = (image.get("cropX") as number) || 0;
    const cropY = (image.get("cropY") as number) || 0;
    const width = image.get("width") as number;
    const height = image.get("height") as number;

    this._original = { left, top, scaleX, scaleY, cropX, cropY, width, height };

    // Expand image to full source: shift left/top to compensate for removed crop offset
    const expandedLeft = left - cropX * scaleX;
    const expandedTop = top - cropY * scaleY;

    image.set({
      left: expandedLeft,
      top: expandedTop,
      cropX: 0,
      cropY: 0,
      width: sourceWidth,
      height: sourceHeight,
    });
    image.setCoords();

    return {
      imageBounds: {
        left: expandedLeft,
        top: expandedTop,
        width: sourceWidth * scaleX,
        height: sourceHeight * scaleY,
      },
      cropArea: {
        left,
        top,
        width: width * scaleX,
        height: height * scaleY,
      },
    };
  }

  applyCrop(overlay: OverlayRect): void {
    if (!this.isCropping || !this._image || !this._original) {
      throw new Error("Not in crop mode");
    }

    const { scaleX, scaleY } = this._original;

    // Compute crop relative to the expanded (full-source) image
    const expandedLeft = this._image.get("left") as number;
    const expandedTop = this._image.get("top") as number;
    const expandedState: ImageCropState = {
      left: expandedLeft,
      top: expandedTop,
      scaleX, scaleY,
      cropX: 0, cropY: 0,
      width: this._sourceWidth,
      height: this._sourceHeight,
    };

    const crop = computeCropParams(expandedState, overlay);

    // Position image so cropped area's top-left aligns with overlay
    this._image.set({
      left: overlay.left,
      top: overlay.top,
      cropX: crop.cropX,
      cropY: crop.cropY,
      width: crop.width,
      height: crop.height,
    });
    this._image.setCoords();

    this._cleanup();
  }

  cancelCrop(): void {
    if (!this.isCropping || !this._image || !this._original) {
      this._cleanup();
      return;
    }

    // Restore everything including position
    this._image.set({
      left: this._original.left,
      top: this._original.top,
      cropX: this._original.cropX,
      cropY: this._original.cropY,
      width: this._original.width,
      height: this._original.height,
    });
    this._image.setCoords();

    this._cleanup();
  }

  get image(): CroppableImage | null { return this._image; }
  get original(): ImageCropState | null { return this._original; }

  private _cleanup(): void {
    this.isCropping = false;
    this._image = null;
    this._original = null;
    this._sourceWidth = 0;
    this._sourceHeight = 0;
  }
}
