# Mobile Input Page Design

## Summary

Add a mobile-friendly page at `/mobile/:canvas` that lets phone users draw with finger, edit text fields, and capture photos -- all syncing live to the desktop Fabric.js editor via WebSocket.

## Architecture

```
Phone Browser                    Server                     Desktop Editor
/mobile/:canvas  ──WS──>  WebSocket Hub  ──WS──>  /editor/:canvas
  Fabric.js (PencilBrush)     (broadcasts)         Fabric.js (full editor)
  Text form fields             Canvas Manager
  Photo capture                (multi-client)
```

## Key Decisions

- **Drawing engine**: Fabric.js on mobile (same as desktop) for serialization parity
- **Layout**: Tabbed (Draw / Text / Photo) with collapsible bottom tab bar
- **Coordinate mapping**: Scaled to fit -- mobile canvas matches desktop aspect ratio, paths scale proportionally
- **Sync timing**: Live streaming -- touch points streamed in real-time via WebSocket
- **Server binding**: 0.0.0.0 for LAN access

## Multi-Client WebSocket Refactor

`CanvasSession.ws: WebSocket | null` becomes `CanvasSession.clients: Set<WebSocket>`. Server broadcasts incoming changes to all other clients on the same canvas.

Each client sends `{type: "ready", canvas_name, client_type: "editor" | "mobile"}` on connect.

## New WebSocket Message Types

### Mobile -> Server

| Type | Payload | Purpose |
|------|---------|---------|
| `draw_points` | `{points: {x,y}[], color, width, scale_factor}` | Live stroke streaming |
| `draw_complete` | `{path_data: string, color, width}` | Finished stroke (Fabric Path JSON) |
| `update_textbox` | `{object_index: number, text: string}` | Text field change |
| `photo_upload` | `{data_base64: string, width, height}` | Camera capture |

### Server -> Mobile

| Type | Payload | Purpose |
|------|---------|---------|
| `canvas_textboxes` | `{textboxes: {index, text, label}[]}` | Editable fields list |
| `canvas_dimensions` | `{width, height}` | For scale calculation |

### Server -> Desktop (forwarded)

| Type | Payload | Purpose |
|------|---------|---------|
| `draw_points` | Same, coordinates scaled to desktop | Live stroke preview |
| `draw_complete` | Same, scaled | Final stroke as Fabric Path |
| `update_textbox` | Same | Update textbox text |
| `add_image` | `{data_base64, x, y, width, height}` | Photo added to canvas |

## Mobile Page Structure

Three tabs with collapsible bottom bar (arrow to minimize):

- **Draw**: Full-screen Fabric.js canvas, PencilBrush mode only. Color picker, brush size, undo, clear.
- **Text**: Auto-generated form from `canvas_textboxes`. Each input maps to a non-locked Textbox on desktop.
- **Photo**: File input with `capture="environment"`, preview, resize to max 800px, base64 upload.

## Coordinate Scaling

Mobile receives `canvas_dimensions` on connect. Scale factor = `desktopWidth / mobileCanvasWidth`. Mobile Fabric canvas sized to desktop aspect ratio. Path objects serialize identically -- `scale()` transform applied when forwarding to desktop.

## File Structure

```
src/
  mobile/
    index.html
    mobile.ts
    mobile.css
  canvas-manager.ts   # multi-client refactor
  types.ts            # new message types
```

## Server Changes

- Bind to 0.0.0.0 (configurable via `--host` flag, default 0.0.0.0)
- New route: `GET /mobile/:canvasName`
- QR code generation with LAN URL (terminal + optional editor UI)
