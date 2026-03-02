import type { WebSocket } from "ws";

export interface CanvasSession {
  name: string;
  svg: string;
  json?: string;
  clients: Set<WebSocket>;
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
  | { type: "request_screenshot"; request_id: string }
  | { type: "load_json"; json: string }
  | { type: "set_zoom"; value: number; cx?: number; cy?: number }
  | { type: "pan_to"; x: number; y: number }
  | { type: "zoom_to_fit" }
  | { type: "canvas_textboxes"; textboxes: TextboxInfo[] }
  | { type: "canvas_dimensions"; width: number; height: number }
  | { type: "update_textbox"; object_index: number; text: string }
  | { type: "draw_points"; points: Array<{x: number; y: number}>; color: string; width: number; scale_factor: number }
  | { type: "draw_complete"; path_data: string; color: string; width: number }
  | { type: "add_image"; photo_id: string; data_base64: string; x: number; y: number; width: number; height: number }
  | { type: "remove_image"; photo_id: string }
  | { type: "photo_ack"; photo_id: string }
  | { type: "mobile_info"; url: string; qr_data_url: string };

export interface TextboxInfo {
  index: number;
  text: string;
  label: string;
}

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
  | { type: "canvas_json_update"; json: string }
  | { type: "ready"; canvas_name: string; client_type?: "editor" | "mobile" }
  | { type: "pong" }
  | { type: "canvas_json"; request_id: string; json: string }
  | { type: "canvas_screenshot"; request_id: string; data_url: string }
  | { type: "update_textbox"; object_index: number; text: string }
  | { type: "draw_points"; points: Array<{x: number; y: number}>; color: string; width: number; scale_factor: number }
  | { type: "draw_complete"; path_data: string; color: string; width: number }
  | { type: "photo_upload"; data_base64: string; width: number; height: number }
  | { type: "photo_delete"; photo_id: string };
