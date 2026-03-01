import type { WebSocket } from "ws";

export interface CanvasSession {
  name: string;
  svg: string;
  ws: WebSocket | null;
  createdAt: number;
}

// Server -> Browser messages
export type ServerMessage =
  | { type: "set_svg"; svg: string }
  | { type: "add_element"; svg_fragment: string }
  | { type: "close" }
  | { type: "ping" };

// Browser -> Server messages
export type ClientMessage =
  | { type: "canvas_update"; svg: string }
  | { type: "ready"; canvas_name: string }
  | { type: "pong" };
