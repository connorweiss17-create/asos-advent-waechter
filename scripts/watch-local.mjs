// Lokaler Wächter für deinen PC. Gleiche Logik wie der Cloud-Worker (worker/src/logic.js).
// Start:   node --env-file=.env scripts/watch-local.mjs
// Test:    node --env-file=.env scripts/watch-local.mjs --test   (schickt nur eine Test-Nachricht)
// Trocken: node scripts/watch-local.mjs --dry                    (fragt ab, sendet nichts)
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CONFIG, evaluate, initialState, parseStock } from "../worker/src/logic.js";

const STATE_FILE = fileURLToPath(new URL("../.watch-state.json", import.meta.url));
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry");
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const log = (...a) => console.log(new Date().toLocaleTimeString("de-DE"), ...a);

async function fetchStock() {
  try {
    const res = await fetch(CONFIG.stockUrl, {
      headers: { "user-agent": UA, accept: "application/json", "accept-language": "de-DE,de;q=0.9" },
    });
    if (res.status !== 200) return { ok: false, reason: `http_${res.status}` };
    const json = await res.json().catch(() => null);
    if (json === null) return { ok: false, reason: "not_json" };
    return parseStock(json);
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

async function notify(text) {
  if (DRY) {
    log("[dry] würde senden:", text);
    return true;
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log("FEHLER: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID fehlen (Datei .env).");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    if (!res.ok) log("Telegram-Fehler: HTTP", res.status);
    return res.ok;
  } catch {
    log("Telegram nicht erreichbar.");
    return false;
  }
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return initialState();
  }
}

async function tick() {
  const result = await fetchStock();
  const prev = await loadState();
  const { state, messages } = evaluate(result, prev, Date.now());
  let restockSent = true;
  for (const m of messages) {
    const ok = await notify(m.text);
    if (!ok && (m.kind === "restock" || m.kind === "restock_price_changed")) restockSent = false;
  }
  if (!restockSent) {
    // Alarm bleibt fällig und wird im nächsten Durchlauf erneut versucht
    state.alertCount = prev.alertCount ?? 0;
    state.lastAlertAt = prev.lastAlertAt ?? 0;
  }
  if (!DRY) await writeFile(STATE_FILE, JSON.stringify(state));
  log(result.ok ? (result.inStock ? "LIEFERBAR" : "ausverkauft") : `Abfrage fehlgeschlagen: ${result.reason}`, messages.map((m) => m.kind).join(",") || "");
}

if (args.has("--simulate")) {
  // Simulierter Restock: echte Alarmlogik mit gefälschten Daten, Nachricht mit [TEST]-Marke, kein Zustand gespeichert.
  const fake = [
    {
      productId: CONFIG.productId,
      productPrice: { current: { value: CONFIG.expectedPrice } },
      isInStock: true,
      variants: [{ id: CONFIG.variantId, isInStock: true, isRestockingSoon: false }],
    },
  ];
  const { messages } = evaluate(parseStock(fake), { ...initialState(), lastHeartbeatAt: Date.now() }, Date.now());
  let ok = messages.length > 0;
  for (const m of messages) ok = (await notify(`[TEST, kein echter Restock] ${m.text}`)) && ok;
  log(ok ? `Simulation gesendet (${messages.map((m) => m.kind).join(",")}).` : "Simulation fehlgeschlagen.");
  process.exit(ok ? 0 : 1);
}

if (args.has("--test")) {
  const ok = await notify("✅ Testalarm vom ASOS-Wächter (PC). Push funktioniert.");
  log(ok ? "Test gesendet." : "Test fehlgeschlagen.");
  process.exit(ok ? 0 : 1);
}

log(`ASOS-Wächter läuft${DRY ? " (trocken)" : ""}. Strg+C beendet. Abfrage ca. alle 60 Sekunden.`);
let stop = false;
process.on("SIGINT", () => (stop = true));
do {
  await tick().catch((e) => log("Unerwarteter Fehler:", e.message));
  if (DRY && args.has("--once")) break;
  await new Promise((r) => setTimeout(r, 50_000 + Math.random() * 20_000)); // 50-70 s
} while (!stop);
