// Ein Durchlauf pro Aufruf, gedacht für GitHub Actions (alle ~5 Minuten).
// Zustand liegt in state/state.json und wird vom Workflow zurück ins Repo committet, falls er sich ändert.
// Lokal testen ohne Senden: DRY=1 STATE_FILE=./tmp-state.json node scripts/watch-once.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CONFIG, evaluate, initialState, parseStock } from "../worker/src/logic.js";

const STATE_FILE = process.env.STATE_FILE || "state/state.json";
const DRY = process.env.DRY === "1";
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
// 5-Minuten-Takt: nach 3 Fehlern in Folge (ca. 15 Min) Blockade melden
const CFG = { ...CONFIG, errorsBeforeAlert: 3 };
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchStock() {
  try {
    const res = await fetch(CFG.stockUrl, {
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
    console.log("[dry] würde senden:", text);
    return true;
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("FEHLER: Telegram-Secrets fehlen.");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    if (!res.ok) console.log("Telegram-Fehler: HTTP", res.status);
    return res.ok;
  } catch {
    console.log("Telegram nicht erreichbar.");
    return false;
  }
}

if (process.env.SIMULATE === "1") {
  // Simulierter Restock über den echten Weg (GitHub-Secrets, Telegram). Kein Zustand wird verändert.
  const fake = [
    {
      productId: CFG.productId,
      productPrice: { current: { value: CFG.expectedPrice } },
      isInStock: true,
      variants: [{ id: CFG.variantId, isInStock: true, isRestockingSoon: false }],
    },
  ];
  const { messages } = evaluate(parseStock(fake), { ...initialState(), lastHeartbeatAt: Date.now() }, Date.now(), CFG);
  let ok = messages.length > 0;
  for (const m of messages) ok = (await notify(`[TEST, kein echter Restock] ${m.text}`)) && ok;
  console.log(ok ? `Simulation gesendet (${messages.map((m) => m.kind).join(",")}).` : "Simulation FEHLGESCHLAGEN.");
  process.exit(ok ? 0 : 1);
}

let prev;
try {
  prev = JSON.parse(await readFile(STATE_FILE, "utf8"));
} catch {
  prev = initialState();
}

const result = await fetchStock();
const { state, messages } = evaluate(result, prev, Date.now(), CFG);

let restockSent = true;
for (const m of messages) {
  const ok = await notify(m.text);
  if (!ok && (m.kind === "restock" || m.kind === "restock_price_changed")) restockSent = false;
}
if (!restockSent) {
  state.alertCount = prev.alertCount ?? 0; // Alarm bleibt fällig, nächster Lauf versucht es erneut
  state.lastAlertAt = prev.lastAlertAt ?? 0;
}
// Zähler deckeln, damit der Zustand bei Dauer-Blockade stabil bleibt (sonst Commit bei jedem Lauf)
state.consecutiveErrors = Math.min(state.consecutiveErrors, CFG.errorsBeforeAlert);

await mkdir(dirname(STATE_FILE), { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

// Log ohne Geheimnisse: nur Ergebnis und Art der Nachrichten
console.log(
  result.ok ? (result.inStock ? "LIEFERBAR" : "ausverkauft") : `Abfrage fehlgeschlagen: ${result.reason}`,
  "| Nachrichten:",
  messages.map((m) => m.kind).join(",") || "keine",
);
