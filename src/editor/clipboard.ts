import type { Canvas as FabricCanvas } from "fabric";

export function initClipboardHandler(
  canvas: FabricCanvas,
  onModified: () => void
): void {
  document.addEventListener("paste", async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const img = new Image();
          img.onload = () => {
            const { FabricImage } = (window as any).__fabric;
            const fabricImg = new FabricImage(img, {
              left: 100,
              top: 100,
            });
            // Scale down large images
            const maxDim = 600;
            if (img.width > maxDim || img.height > maxDim) {
              const scale = maxDim / Math.max(img.width, img.height);
              fabricImg.scale(scale);
            }
            canvas.add(fabricImg);
            canvas.setActiveObject(fabricImg);
            canvas.requestRenderAll();
            onModified();
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
        break; // Handle first image only
      }
    }
  });
}
