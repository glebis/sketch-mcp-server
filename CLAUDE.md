# Sketch MCP Server

Collaborative SVG canvas tool. Claude writes/reads SVG via MCP tools; user edits in Fabric.js browser editor. Real-time sync via WebSocket.

## Architecture

```
Claude Code <--stdio/MCP--> Node.js Server <--WebSocket--> Browser Editor(s)
                            (Express + WS)                  (Fabric.js)
```

## Build & Run

```bash
npm run build    # type-check + vite (editor) + bun (server)
npm start        # node dist/index.js --stdio
```

## MCP Tools

- `sketch_open_canvas` - create/open canvas, opens browser
- `sketch_get_svg` - read SVG (base64 images truncated at 25KB)
- `sketch_set_svg` - replace entire canvas SVG
- `sketch_add_element` - add SVG fragment without clearing
- `sketch_add_textbox` - add fixed-width Textbox with word wrapping
- `sketch_lock_objects` - lock all objects (non-selectable/movable)
- `sketch_unlock_objects` - unlock all objects
- `sketch_save_template` - save canvas as JSON template (preserves Textbox widths + lock state)
- `sketch_load_template` - load JSON template into canvas
- `sketch_list_templates` - list saved templates
- `sketch_list_canvases` - list active sessions
- `sketch_clear_canvas` - clear canvas to blank
- `sketch_focus_canvas` - bring canvas window to front
- `sketch_close_canvas` - close canvas + browser

## Key Files

- `src/main.ts` - entry: HTTP+WS server, then MCP stdio
- `src/server.ts` - MCP tool definitions
- `src/canvas-manager.ts` - session state, Express routes, WebSocket
- `src/editor/` - Fabric.js browser editor (built by Vite into single HTML)

## Port

OS-assigned (port 0). Logged to stderr on startup.
