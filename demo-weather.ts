import { CanvasManager } from "./src/canvas-manager.js";
import { exec, execSync } from "node:child_process";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function openApp(url: string) {
  const bins = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  for (const bin of bins) {
    try {
      execSync(`test -f "${bin}"`, { stdio: "ignore" });
      exec(`"${bin}" --app="${url}" --new-window`);
      return;
    } catch {}
  }
  exec(`open "${url}"`);
}

async function main() {
  const cm = new CanvasManager();
  const port = await cm.start();
  console.log(`Server on port ${port}`);

  const name = "weather-app";
  const { url } = cm.openCanvas(name);
  console.log(`Opening: ${url}`);
  openApp(url);

  await sleep(3000);
  cm.focusCanvas(name);
  cm.clearCanvas(name);
  await sleep(400);

  const add = async (label: string, svg: string, delay = 450) => {
    cm.addElement(name, svg);
    console.log(`  + ${label}`);
    await sleep(delay);
  };

  console.log("Streaming weather app...");

  // Mobile frame: 390x844 centered on 1200x800 canvas
  const ox = 405; // (1200-390)/2
  const oy = 0;

  // --- Phone background ---
  await add("phone bg", `
    <rect x="${ox}" y="${oy}" width="390" height="844" rx="40" fill="#0f172a" />
  `);

  // --- Status bar ---
  await add("status bar", `
    <text x="${ox + 30}" y="${oy + 38}" font-size="14" font-weight="bold" fill="#94a3b8" font-family="sans-serif">9:41</text>
    <circle cx="${ox + 310}" cy="${oy + 33}" r="4" fill="#94a3b8" />
    <circle cx="${ox + 325}" cy="${oy + 33}" r="4" fill="#94a3b8" />
    <rect x="${ox + 338}" y="${oy + 28}" width="22" height="10" rx="2" fill="none" stroke="#94a3b8" stroke-width="1.5" />
    <rect x="${ox + 340}" y="${oy + 30}" width="14" height="6" rx="1" fill="#22c55e" />
  `);

  // --- Location + date ---
  await add("location", `
    <text x="${ox + 195}" y="${oy + 90}" font-size="13" fill="#64748b" font-family="sans-serif" text-anchor="middle">SATURDAY, MARCH 1</text>
    <text x="${ox + 195}" y="${oy + 120}" font-size="22" font-weight="bold" fill="#f8fafc" font-family="sans-serif" text-anchor="middle">Amsterdam</text>
  `);

  // --- Big temperature ---
  await add("temperature", `
    <text x="${ox + 195}" y="${oy + 240}" font-size="96" font-weight="bold" fill="#f8fafc" font-family="sans-serif" text-anchor="middle">8°</text>
    <text x="${ox + 195}" y="${oy + 272}" font-size="18" fill="#94a3b8" font-family="sans-serif" text-anchor="middle">Partly Cloudy</text>
  `);

  // --- Sun icon (simple SVG) ---
  await add("sun icon", `
    <circle cx="${ox + 175}" cy="${oy + 170}" r="16" fill="#fbbf24" />
    <circle cx="${ox + 210}" cy="${oy + 162}" r="22" fill="#64748b" />
    <circle cx="${ox + 218}" cy="${oy + 158}" r="18" fill="#0f172a" />
  `);

  // --- High / Low ---
  await add("high low", `
    <text x="${ox + 145}" y="${oy + 305}" font-size="14" fill="#64748b" font-family="sans-serif" text-anchor="end">H: 11°</text>
    <text x="${ox + 245}" y="${oy + 305}" font-size="14" fill="#64748b" font-family="sans-serif">L: 4°</text>
  `);

  // --- Divider ---
  await add("divider 1", `
    <line x1="${ox + 30}" y1="${oy + 330}" x2="${ox + 360}" y2="${oy + 330}" stroke="#1e293b" stroke-width="1" />
  `);

  // --- Hourly forecast ---
  await add("hourly label", `
    <text x="${ox + 30}" y="${oy + 360}" font-size="12" font-weight="bold" fill="#64748b" font-family="sans-serif">HOURLY FORECAST</text>
  `);

  const hours = [
    { t: "Now", temp: "8°", dot: "#fbbf24" },
    { t: "13", temp: "9°", dot: "#fbbf24" },
    { t: "14", temp: "10°", dot: "#94a3b8" },
    { t: "15", temp: "11°", dot: "#94a3b8" },
    { t: "16", temp: "10°", dot: "#64748b" },
    { t: "17", temp: "8°", dot: "#334155" },
  ];

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const hx = ox + 45 + i * 56;
    const hy = oy + 385;
    await add(`hour ${h.t}`, `
      <text x="${hx}" y="${hy}" font-size="13" fill="#94a3b8" font-family="sans-serif" text-anchor="middle">${h.t}</text>
      <circle cx="${hx}" cy="${hy + 25}" r="6" fill="${h.dot}" />
      <text x="${hx}" y="${hy + 55}" font-size="15" font-weight="bold" fill="#f8fafc" font-family="sans-serif" text-anchor="middle">${h.temp}</text>
    `, 300);
  }

  // --- Divider ---
  await add("divider 2", `
    <line x1="${ox + 30}" y1="${oy + 470}" x2="${ox + 360}" y2="${oy + 470}" stroke="#1e293b" stroke-width="1" />
  `);

  // --- 5-day forecast ---
  await add("daily label", `
    <text x="${ox + 30}" y="${oy + 500}" font-size="12" font-weight="bold" fill="#64748b" font-family="sans-serif">5-DAY FORECAST</text>
  `);

  const days = [
    { d: "Today", hi: "11°", lo: "4°", bar: 55, color: "#fbbf24" },
    { d: "Sun", hi: "13°", lo: "6°", bar: 70, color: "#fb923c" },
    { d: "Mon", hi: "9°", lo: "3°", bar: 40, color: "#94a3b8" },
    { d: "Tue", hi: "7°", lo: "1°", bar: 30, color: "#64748b" },
    { d: "Wed", hi: "12°", lo: "5°", bar: 65, color: "#fbbf24" },
  ];

  for (let i = 0; i < days.length; i++) {
    const dy = oy + 530 + i * 48;
    const d = days[i];
    await add(`day ${d.d}`, `
      <text x="${ox + 30}" y="${dy + 14}" font-size="15" fill="#f8fafc" font-family="sans-serif">${d.d}</text>
      <text x="${ox + 130}" y="${dy + 14}" font-size="13" fill="#64748b" font-family="sans-serif">${d.lo}</text>
      <rect x="${ox + 170}" y="${dy + 4}" width="120" height="6" rx="3" fill="#1e293b" />
      <rect x="${ox + 170}" y="${dy + 4}" width="${d.bar}" height="6" rx="3" fill="${d.color}" />
      <text x="${ox + 310}" y="${dy + 14}" font-size="13" fill="#f8fafc" font-family="sans-serif">${d.hi}</text>
    `, 350);
  }

  // --- Divider ---
  await add("divider 3", `
    <line x1="${ox + 30}" y1="${oy + 770}" x2="${ox + 360}" y2="${oy + 770}" stroke="#1e293b" stroke-width="1" />
  `);

  // --- Bottom nav ---
  await add("bottom nav", `
    <circle cx="${ox + 98}" cy="${oy + 805}" r="4" fill="#64748b" />
    <circle cx="${ox + 195}" cy="${oy + 805}" r="4" fill="#f8fafc" />
    <circle cx="${ox + 292}" cy="${oy + 805}" r="4" fill="#64748b" />
    <text x="${ox + 98}" y="${oy + 828}" font-size="10" fill="#64748b" font-family="sans-serif" text-anchor="middle">Map</text>
    <text x="${ox + 195}" y="${oy + 828}" font-size="10" fill="#f8fafc" font-family="sans-serif" text-anchor="middle">Weather</text>
    <text x="${ox + 292}" y="${oy + 828}" font-size="10" fill="#64748b" font-family="sans-serif" text-anchor="middle">Settings</text>
  `);

  console.log("\nDone! Weather app streamed.");
  console.log("Press Ctrl+C to exit.");
}

main().catch(console.error);
