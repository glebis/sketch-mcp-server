# Sketch MCP Server

Collaborative SVG canvas for Claude Code. Claude writes/reads SVG via MCP tools; you edit in a Fabric.js browser editor. Changes sync in real-time via WebSocket.

## Architecture

```
Claude Code <--stdio/MCP--> Node.js Server <--WebSocket--> Browser Editor(s)
                            (Express + WS)                  (Fabric.js)
```

## Install

```bash
git clone https://github.com/glebis/sketch-mcp-server.git
cd sketch-mcp-server
npm install
npm run build
```

Add to your Claude Code MCP config (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "sketch-mcp-server": {
      "command": "node",
      "args": ["/path/to/sketch-mcp-server/dist/index.js", "--stdio"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `sketch_open_canvas` | Create/open a named canvas, launches browser window |
| `sketch_get_svg` | Read current SVG (base64 images truncated at 25KB) |
| `sketch_set_svg` | Replace entire canvas SVG |
| `sketch_add_element` | Add SVG fragment without clearing existing content |
| `sketch_add_textbox` | Add fixed-width text area with word wrapping |
| `sketch_lock_objects` | Lock all objects (non-selectable, non-movable) |
| `sketch_unlock_objects` | Unlock all objects |
| `sketch_save_template` | Save canvas as JSON template |
| `sketch_load_template` | Load JSON template into canvas |
| `sketch_list_templates` | List saved templates |
| `sketch_clear_canvas` | Clear canvas to blank |
| `sketch_focus_canvas` | Bring canvas window to foreground |
| `sketch_list_canvases` | List active canvas sessions |
| `sketch_close_canvas` | Close canvas and browser window |

## Editor Features

- **Toolbar**: Select, draw (freehand), shapes (rect, ellipse, triangle, line, arrow), text
- **Text tool**: Click for free-width IText, drag for fixed-width Textbox with word wrap
- **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z
- **Delete**: Backspace/Delete key
- **Clipboard**: Paste images and SVG from clipboard
- **Real-time sync**: All MCP tool calls update the browser instantly

## Templates

Templates save the full Fabric.js canvas state as JSON, preserving Textbox widths, lock states, and all object properties.

```
# Build a layout, lock structure, add editable areas, save
sketch_open_canvas -> sketch_add_element -> sketch_lock_objects -> sketch_add_textbox -> sketch_save_template

# Reuse on a new canvas
sketch_open_canvas -> sketch_load_template
```

Included template: `before-after` -- 3-column grid (Before | Product/Audience | After) with editable text areas.

## Development

```bash
npm run build    # type-check + vite (editor) + bun (server)
npm run dev      # build + run
npm start        # run built server
```

Port is OS-assigned (port 0), logged to stderr on startup.

## License

MIT
