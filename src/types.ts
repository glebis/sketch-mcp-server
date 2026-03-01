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
  | { type: "clear" }
  | { type: "focus" }
  | { type: "close" }
  | { type: "ping" }
  | { type: "add_textbox"; options: TextboxOptions }
  | { type: "lock_all" }
  | { type: "unlock_all" }
  | { type: "request_json"; request_id: string }
  | { type: "load_json"; json: string };

export interface TextboxOptions {
  x: number;
  y: number;
  width: number;
  text?: string;
  fontSize?: number;
  fill?: string;
  fontFamily?: string;
}

// Browser -> Server messages
export type ClientMessage =
  | { type: "canvas_update"; svg: string }
  | { type: "ready"; canvas_name: string }
  | { type: "pong" }
  | { type: "canvas_json"; request_id: string; json: string };
