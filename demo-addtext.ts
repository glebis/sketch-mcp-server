import { CanvasManager } from "./src/canvas-manager.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  // Connect to the already-running server by importing its class
  // Actually we need to talk to the running server's canvas --
  // let's start a new one that reuses the same port pattern.
  // Simpler: just start a fresh manager and re-stream everything + extra text.

  const cm = new CanvasManager();
  const port = await cm.start();
  console.log(`Server on port ${port}`);

  // The previous server is still running on a different port.
  // Let's talk to it via WebSocket. Actually, let me just add text to
  // a canvas that's already open. We need the same server instance.
  // Since the previous process is holding port 54529, let's just
  // programmatically add to a new canvas here.

  const name = "blocks-demo";
  const { url } = cm.openCanvas(name);

  // Open browser
  const { exec, execSync } = await import("node:child_process");
  try {
    execSync('test -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"', { stdio: "ignore" });
    exec(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" --new-window`);
  } catch {
    exec(`open "${url}"`);
  }

  await sleep(3000);
  cm.focusCanvas(name);

  const add = async (label: string, svg: string, delay = 600) => {
    cm.addElement(name, svg);
    console.log(`  + ${label}`);
    await sleep(delay);
  };

  console.log("Adding descriptive text to blocks...");

  // Stat descriptions under the numbers
  await add("stat 1 delta", `
    <text x="85" y="463" font-size="11" fill="#22c55e" font-family="sans-serif">+14% vs last week</text>
  `);
  await add("stat 2 delta", `
    <text x="265" y="463" font-size="11" fill="#ef4444" font-family="sans-serif">-0.4% vs last week</text>
  `);
  await add("stat 3 delta", `
    <text x="445" y="463" font-size="11" fill="#22c55e" font-family="sans-serif">+$1,200 vs last week</text>
  `);

  // Chart annotation
  await add("chart annotation", `
    <line x1="339" y1="560" x2="339" y2="575" stroke="#6366f1" stroke-width="1" stroke-dasharray="3,3" />
    <text x="339" y="590" font-size="10" fill="#6366f1" font-family="sans-serif" text-anchor="middle">Peak: Thu</text>
  `);

  // Timestamp on toast
  await add("toast time", `
    <text x="1090" y="537" font-size="11" fill="#666666" font-family="sans-serif" text-anchor="end">2m ago</text>
  `);

  // User list "View all" link
  await add("view all link", `
    <text x="1100" y="150" font-size="13" fill="#6366f1" font-family="sans-serif" text-anchor="end">View All</text>
  `);

  // Footer text
  await add("footer", `
    <text x="600" y="785" font-size="11" fill="#cccccc" font-family="sans-serif" text-anchor="middle">Streamed live with Sketch MCP Server</text>
  `);

  console.log("\nDone! Extra text added.");
  console.log("Press Ctrl+C to exit.");
}

main().catch(console.error);
