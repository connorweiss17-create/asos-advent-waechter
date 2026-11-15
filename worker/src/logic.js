// Reine Entscheidungslogik, ohne Netzwerk und ohne Cloudflare-APIs, damit sie testbar ist.

export const CONFIG = {
  productId: 210335519,
  variantId: 210335522,
  expectedPrice: 120, // EUR, DE-Shop
  productUrl:
    "https://www.asos.com/de/asos-gifting/asos-face-body-advent-calendar-2026-73-saving/prd/210335519",
  stockUrl:
    "https://www.asos.com/api/product/catalogue/v4/stockprice" +
    "?productIds=210335519&store=DE&currency=EUR&country=DE&keyStoreDataversion=7qyyrb1-46",
  repeatEveryMs: 2 * 60 * 1000,
  maxAlerts: 5,
  heartbeatEveryMs: 24 * 60 * 60 * 1000,
  errorsBeforeAlert: 5,
};

export const initialState = () => ({
  wasInStock: false,
  alertCount: 0,
  lastAlertAt: 0,
  acked: false,
  lastHeartbeatAt: 0,
  consecutiveErrors: 0,
  errorAlerted: false,
});

/**
 * Liest die Antwort des stockprice-Endpunkts.
 * Liefert { ok:false, reason } bei unerwarteter Form, sonst { ok:true, inStock, price, ... }.
 * Wichtig: Nur wenn Produkt UND die Ziel-Variante auf Lager sind, gilt es als lieferbar.
 */
export function parseStock(json, cfg = CONFIG) {
  if (!Array.isArray(json) || json.length === 0) return { ok: false, reason: "unexpected_shape" };
  const p = json.find((x) => x && x.productId === cfg.productId);
  if (!p) return { ok: false, reason: "product_missing" };
  if (typeof p.isInStock !== "boolean" || !Array.isArray(p.variants)) {
    return { ok: false, reason: "unexpected_shape" };
  }
  const v = p.variants.find((x) => x && x.id === cfg.variantId);
  if (!v || typeof v.isInStock !== "boolean") return { ok: false, reason: "variant_missing" };
  const price = p.productPrice?.current?.value;
  return {
    ok: true,
    inStock: p.isInStock === true && v.isInStock === true,
    price: typeof price === "number" ? price : null,
    restockingSoon: v.isRestockingSoon === true,
  };
}

/**
 * Entscheidet anhand von Ergebnis und Zustand, was passiert.
 * result: { ok:true, inStock, price } | { ok:false, reason }
 * Gibt { state, messages } zurück; messages: [{ kind, text }]
 */
export function evaluate(result, prev, now, cfg = CONFIG) {
  const state = { ...initialState(), ...prev };
  const messages = [];

  if (!result.ok) {
    state.consecutiveErrors += 1;
    if (state.consecutiveErrors >= cfg.errorsBeforeAlert && !state.errorAlerted) {
      state.errorAlerted = true;
      messages.push({
        kind: "error",
        text:
          `⚠️ ASOS-Wächter blind: ${state.consecutiveErrors} Abfragen in Folge fehlgeschlagen ` +
          `(${result.reason}). Evtl. Blockade oder geänderte API. Bitte manuell prüfen: ${cfg.productUrl}`,
      });
    }
    return { state, messages };
  }

  // Abfrage erfolgreich
  if (state.errorAlerted) {
    messages.push({ kind: "recovered", text: "✅ ASOS-Wächter sieht wieder Daten." });
  }
  state.consecutiveErrors = 0;
  state.errorAlerted = false;

  if (result.inStock) {
    const priceOk = result.price === cfg.expectedPrice;
    const firstAlert = !state.wasInStock || state.alertCount === 0;
    const dueRepeat =
      !firstAlert &&
      !state.acked &&
      state.alertCount < cfg.maxAlerts &&
      now - state.lastAlertAt >= cfg.repeatEveryMs;

    if (firstAlert || dueRepeat) {
      state.alertCount += 1;
      state.lastAlertAt = now;
      const prefix = priceOk
        ? "🎄 ADVENTSKALENDER LIEFERBAR!"
        : `🎄 LIEFERBAR, ABER PREIS ABWEICHEND (${result.price} € statt ${cfg.expectedPrice} €)!`;
      messages.push({
        kind: priceOk ? "restock" : "restock_price_changed",
        text: `${prefix} Jetzt öffnen und bestellen: ${cfg.productUrl}`,
      });
    }
    state.wasInStock = true;
  } else {
    // Ausverkauft: wieder scharf schalten für die nächste Welle
    if (state.wasInStock) {
      messages.push({ kind: "soldout", text: "ASOS Adventskalender ist wieder ausverkauft." });
    }
    state.wasInStock = false;
    state.alertCount = 0;
    state.acked = false;
  }

  if (now - state.lastHeartbeatAt >= cfg.heartbeatEveryMs) {
    state.lastHeartbeatAt = now;
    messages.push({
      kind: "heartbeat",
      text: `Wächter läuft. Status: ${result.inStock ? "LIEFERBAR" : "ausverkauft"}.`,
    });
  }

  return { state, messages };
}
