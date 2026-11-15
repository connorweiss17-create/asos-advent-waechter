// Einmalige Live-Abfrage (nur lesen, ohne Alarm, ohne Login): node scripts/live-check.mjs
import { CONFIG, parseStock } from "../worker/src/logic.js";

const res = await fetch(CONFIG.stockUrl, {
  headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
});
console.log("HTTP", res.status);
const json = await res.json().catch(() => null);
console.log(parseStock(json));
