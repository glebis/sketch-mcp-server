import { CanvasManager } from "./src/canvas-manager.js";
import { exec, execSync } from "node:child_process";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function openAppWindow(url: string) {
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

  const name = "blocks-demo";
  const { url } = cm.openCanvas(name);
  console.log(`Opening: ${url}`);
  openAppWindow(url);

  // Wait for browser connect
  await sleep(3000);
  cm.focusCanvas(name);
  cm.clearCanvas(name);
  await sleep(400);

  console.log("Streaming blocks...");

  const add = async (label: string, svg: string, delay = 500) => {
    cm.addElement(name, svg);
    console.log(`  + ${label}`);
    await sleep(delay);
  };

  // --- Canvas background ---
  await add("background", `<rect x="0" y="0" width="1200" height="800" fill="#fafaf8" />`);

  // --- Page title ---
  await add("title", `
    <text x="60" y="60" font-size="32" font-weight="bold" fill="#111111" font-family="sans-serif">Component Blocks</text>
    <text x="60" y="85" font-size="14" fill="#999999" font-family="sans-serif">A collection of reusable UI patterns</text>
  `);

  // --- Block 1: Hero card ---
  await add("hero card bg", `
    <rect x="60" y="110" width="520" height="240" rx="16" fill="#1a1a2e" />
  `);
  await add("hero card content", `
    <text x="90" y="160" font-size="13" font-weight="bold" fill="#6366f1" font-family="sans-serif" letter-spacing="2">FEATURED</text>
    <text x="90" y="200" font-size="28" font-weight="bold" fill="#ffffff" font-family="sans-serif">Build faster with</text>
    <text x="90" y="235" font-size="28" font-weight="bold" fill="#ffffff" font-family="sans-serif">streaming components</text>
    <text x="90" y="270" font-size="14" fill="#a0a0b8" font-family="sans-serif">Watch your interface appear element by element in real-time.</text>
    <rect x="90" y="295" width="120" height="36" rx="8" fill="#6366f1" />
    <text x="118" y="318" font-size="13" font-weight="bold" fill="#ffffff" font-family="sans-serif">Get Started</text>
  `);

  // --- Block 2: Stats row ---
  await add("stat 1", `
    <rect x="60" y="375" width="165" height="100" rx="12" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="85" y="410" font-size="11" fill="#999999" font-family="sans-serif">VISITORS</text>
    <text x="85" y="445" font-size="28" font-weight="bold" fill="#111111" font-family="sans-serif">12.4k</text>
  `);
  await add("stat 2", `
    <rect x="240" y="375" width="165" height="100" rx="12" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="265" y="410" font-size="11" fill="#999999" font-family="sans-serif">CONVERSION</text>
    <text x="265" y="445" font-size="28" font-weight="bold" fill="#111111" font-family="sans-serif">3.2%</text>
  `);
  await add("stat 3", `
    <rect x="420" y="375" width="160" height="100" rx="12" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="445" y="410" font-size="11" fill="#999999" font-family="sans-serif">REVENUE</text>
    <text x="445" y="445" font-size="28" font-weight="bold" fill="#22c55e" font-family="sans-serif">$8,420</text>
  `);

  // --- Block 3: User list ---
  await add("user list header", `
    <rect x="620" y="110" width="520" height="365" rx="16" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="650" y="150" font-size="18" font-weight="bold" fill="#111111" font-family="sans-serif">Team Members</text>
    <line x1="640" y1="168" x2="1120" y2="168" stroke="#f0f0f0" stroke-width="1" />
  `);

  const users = [
    { name: "Alice Chen", role: "Lead Designer", color: "#6366f1" },
    { name: "Bob Martinez", role: "Frontend Engineer", color: "#22c55e" },
    { name: "Carol Kim", role: "Product Manager", color: "#f59e0b" },
    { name: "David Obi", role: "Backend Engineer", color: "#ef4444" },
    { name: "Elena Russo", role: "Data Scientist", color: "#3b82f6" },
  ];

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const y = 195 + i * 48;
    await add(`user: ${u.name}`, `
      <circle cx="665" cy="${y}" r="14" fill="${u.color}" />
      <text x="658" y="${y + 5}" font-size="12" font-weight="bold" fill="#ffffff" font-family="sans-serif" text-anchor="middle">${u.name[0]}</text>
      <text x="690" y="${y - 3}" font-size="14" fill="#222222" font-family="sans-serif">${u.name}</text>
      <text x="690" y="${y + 15}" font-size="12" fill="#999999" font-family="sans-serif">${u.role}</text>
      ${i < users.length - 1 ? `<line x1="640" y1="${y + 30}" x2="1120" y2="${y + 30}" stroke="#f5f5f5" stroke-width="1" />` : ""}
    `, 400);
  }

  // --- Block 4: Mini chart ---
  await add("chart block bg", `
    <rect x="60" y="500" width="520" height="260" rx="16" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="90" y="540" font-size="18" font-weight="bold" fill="#111111" font-family="sans-serif">Weekly Traffic</text>
    <text x="480" y="540" font-size="13" fill="#22c55e" font-family="sans-serif">+18.2%</text>
  `);

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const heights = [90, 130, 110, 160, 140, 80, 120];
  const barW = 45;
  const gap = 16;
  const startX = 95;
  const baseY = 720;

  await add("chart bars", days.map((d, i) => {
    const x = startX + i * (barW + gap);
    const h = heights[i];
    const isHighest = h === 160;
    return `
      <rect x="${x}" y="${baseY - h}" width="${barW}" height="${h}" rx="6" fill="${isHighest ? "#6366f1" : "#e8e8f0"}" />
      <text x="${x + barW / 2}" y="${baseY + 18}" font-size="11" fill="#999999" font-family="sans-serif" text-anchor="middle">${d}</text>
    `;
  }).join(""));

  // --- Block 5: Notification toast ---
  await add("toast notification", `
    <rect x="620" y="500" width="520" height="64" rx="12" fill="#111111" />
    <circle cx="660" cy="532" r="14" fill="#22c55e" />
    <text x="654" y="537" font-size="14" fill="#ffffff" font-family="sans-serif">&#x2713;</text>
    <text x="688" y="528" font-size="14" font-weight="bold" fill="#ffffff" font-family="sans-serif">Deployment successful</text>
    <text x="688" y="546" font-size="12" fill="#a0a0a0" font-family="sans-serif">v2.4.1 is now live in production</text>
  `);

  // --- Block 6: Tags / pills ---
  await add("tag group", `
    <rect x="620" y="585" width="520" height="80" rx="12" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="650" y="615" font-size="13" fill="#999999" font-family="sans-serif">Tags</text>
    <rect x="695" y="600" width="72" height="28" rx="14" fill="#eef2ff" />
    <text x="714" y="619" font-size="12" fill="#6366f1" font-family="sans-serif">Design</text>
    <rect x="778" y="600" width="56" height="28" rx="14" fill="#f0fdf4" />
    <text x="791" y="619" font-size="12" fill="#22c55e" font-family="sans-serif">Dev</text>
    <rect x="845" y="600" width="60" height="28" rx="14" fill="#fef3c7" />
    <text x="858" y="619" font-size="12" fill="#d97706" font-family="sans-serif">Beta</text>
    <rect x="916" y="600" width="70" height="28" rx="14" fill="#fee2e2" />
    <text x="930" y="619" font-size="12" fill="#ef4444" font-family="sans-serif">Urgent</text>
  `);

  // --- Block 7: Progress bar ---
  await add("progress block", `
    <rect x="620" y="685" width="520" height="70" rx="12" fill="#ffffff" stroke="#ebebeb" stroke-width="1" />
    <text x="650" y="715" font-size="13" fill="#555555" font-family="sans-serif">Sprint Progress</text>
    <text x="1100" y="715" font-size="13" font-weight="bold" fill="#6366f1" font-family="sans-serif" text-anchor="end">72%</text>
    <rect x="650" y="728" width="460" height="8" rx="4" fill="#e8e8f0" />
    <rect x="650" y="728" width="331" height="8" rx="4" fill="#6366f1" />
  `);

  console.log("\nDone! All blocks streamed.");
  console.log("Press Ctrl+C to exit.");
}

main().catch(console.error);
