import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, evaluate, initialState, parseStock } from "../worker/src/logic.js";

const api = ({ inStock = false, variantInStock = inStock, price = 120 } = {}) => [
  {
    productId: CONFIG.productId,
    productPrice: { current: { value: price } },
    isInStock: inStock,
    variants: [{ id: CONFIG.variantId, isInStock: variantInStock, isRestockingSoon: !inStock }],
  },
];
const kinds = (r) => r.messages.map((m) => m.kind);
const T0 = 1_000_000_000_000;
const quiet = { ...initialState(), lastHeartbeatAt: T0 }; // Heartbeat nicht fällig

test("parseStock: ausverkauft", () => {
  const r = parseStock(api());
  assert.deepEqual([r.ok, r.inStock, r.price], [true, false, 120]);
});

test("parseStock: lieferbar nur wenn Produkt UND Variante lieferbar", () => {
  assert.equal(parseStock(api({ inStock: true })).inStock, true);
  assert.equal(parseStock(api({ inStock: true, variantInStock: false })).inStock, false);
  assert.equal(parseStock(api({ inStock: false, variantInStock: true })).inStock, false);
});

test("parseStock: falsches Produkt, fehlende Variante, kaputte Form", () => {
  assert.equal(parseStock([{ productId: 1, isInStock: true, variants: [] }]).ok, false);
  const noVariant = api({ inStock: true });
  noVariant[0].variants[0].id = 999;
  assert.equal(parseStock(noVariant).reason, "variant_missing");
  assert.equal(parseStock({}).ok, false);
  assert.equal(parseStock([]).ok, false);
});

test("ausverkauft: kein Alarm", () => {
  const r = evaluate(parseStock(api()), quiet, T0);
  assert.deepEqual(kinds(r), []);
});

test("Restock: genau ein Alarm, danach Ruhe innerhalb von 2 Minuten", () => {
  const r1 = evaluate(parseStock(api({ inStock: true })), quiet, T0);
  assert.deepEqual(kinds(r1), ["restock"]);
  const r2 = evaluate(parseStock(api({ inStock: true })), r1.state, T0 + 60_000);
  assert.deepEqual(kinds(r2), []);
});

test("Wiederholung alle 2 Minuten, maximal 5 Alarme", () => {
  let state = quiet;
  let sent = 0;
  for (let i = 0; i < 20; i++) {
    const r = evaluate(parseStock(api({ inStock: true })), state, T0 + i * 120_000);
    sent += r.messages.filter((m) => m.kind === "restock").length;
    state = r.state;
  }
  assert.equal(sent, CONFIG.maxAlerts);
});

test("Quittierung stoppt Wiederholungen", () => {
  const r1 = evaluate(parseStock(api({ inStock: true })), quiet, T0);
  const acked = { ...r1.state, acked: true };
  const r2 = evaluate(parseStock(api({ inStock: true })), acked, T0 + 600_000);
  assert.deepEqual(kinds(r2), []);
});

test("Wieder ausverkauft: Hinweis und erneut scharf", () => {
  const r1 = evaluate(parseStock(api({ inStock: true })), quiet, T0);
  const r2 = evaluate(parseStock(api()), r1.state, T0 + 60_000);
  assert.deepEqual(kinds(r2), ["soldout"]);
  const r3 = evaluate(parseStock(api({ inStock: true })), r2.state, T0 + 120_000);
  assert.deepEqual(kinds(r3), ["restock"]);
});

test("Abweichender Preis: Warnalarm, nicht normaler Alarm", () => {
  const r = evaluate(parseStock(api({ inStock: true, price: 149 })), quiet, T0);
  assert.deepEqual(kinds(r), ["restock_price_changed"]);
  assert.match(r.messages[0].text, /149/);
});

test("Blockade: Alarm erst nach 5 Fehlern, nur einmal, Entwarnung bei Erholung", () => {
  let state = quiet;
  let errorMsgs = 0;
  for (let i = 0; i < 12; i++) {
    const r = evaluate({ ok: false, reason: "http_403" }, state, T0 + i * 60_000);
    errorMsgs += r.messages.filter((m) => m.kind === "error").length;
    state = r.state;
  }
  assert.equal(errorMsgs, 1);
  const ok = evaluate(parseStock(api()), state, T0 + 13 * 60_000);
  assert.deepEqual(kinds(ok), ["recovered"]);
  assert.equal(ok.state.consecutiveErrors, 0);
});

test("Fehler zwischendurch löschen den Restock-Zustand nicht (kein Doppelalarm)", () => {
  const r1 = evaluate(parseStock(api({ inStock: true })), quiet, T0);
  const err = evaluate({ ok: false, reason: "http_500" }, r1.state, T0 + 30_000);
  const r2 = evaluate(parseStock(api({ inStock: true })), err.state, T0 + 60_000);
  assert.deepEqual(kinds(r2), []);
});

test("Heartbeat einmal pro 24 Stunden", () => {
  const r1 = evaluate(parseStock(api()), initialState(), T0);
  assert.deepEqual(kinds(r1), ["heartbeat"]);
  const r2 = evaluate(parseStock(api()), r1.state, T0 + 3_600_000);
  assert.deepEqual(kinds(r2), []);
  const r3 = evaluate(parseStock(api()), r2.state, T0 + 24 * 3_600_000);
  assert.deepEqual(kinds(r3), ["heartbeat"]);
});
