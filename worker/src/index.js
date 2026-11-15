import { CONFIG, evaluate, initialState, parseStock } from "./logic.js";

const STATE_KEY = "state";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchStock() {
  try {
    const res = await fetch(CONFIG.stockUrl, {
      headers: { "user-agent": UA, accept: "application/json", "accept-language": "de-DE,de;q=0.9" },
    });
    if (res.status !== 200) return { ok: false, reason: `http_${res.status}` };
    let json;
    try {
      json = await res.json();
    } catch {
      return { ok: false, reason: "not_json" }; // z. B. Captcha-/Bot-Seite
    }
    return parseStock(json);
  } catch (e) {
    return { ok: false, reason: "network_error" };
  }
}

async function notify(env, text) {
  const jobs = [];
  if (env.NTFY_TOPIC) {
    jobs.push(
      fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
        method: "POST",
        body: text,
        headers: { Title: "ASOS Adventskalender", Priority: "urgent", Click: CONFIG.productUrl },
      }),
    );
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      }),
    );
  }
  const results = await Promise.allSettled(jobs);
  return results.some((r) => r.status === "fulfilled" && r.value.ok);
}

async function loadState(env) {
  const raw = await env.STATE.get(STATE_KEY, "json");
  return raw ?? initialState();
}

async function runCheck(env) {
  const result = await fetchStock();
  const prev = await loadState(env);
  const { state, messages } = evaluate(result, prev, Date.now());

  // Zustand erst speichern, wenn Alarme versendet wurden; bei Sendefehler bleibt der Alarm "fällig".
  let allSent = true;
  let lastNotifyOk = null;
  for (const m of messages) {
    const sent = await notify(env, m.text);
    lastNotifyOk = sent;
    if (!sent && (m.kind === "restock" || m.kind === "restock_price_changed")) allSent = false;
  }
  if (!allSent) {
    state.alertCount = prev.alertCount ?? 0;
    state.lastAlertAt = prev.lastAlertAt ?? 0;
  }
  state.lastCheckAt = Date.now();
  state.lastResult = result.ok ? (result.inStock ? "in_stock" : "sold_out") : result.reason;
  if (messages.length) state.lastNotifyOk = lastNotifyOk;
  await env.STATE.put(STATE_KEY, JSON.stringify(state));
  return { result, state, messages: messages.map((m) => m.kind) };
}

export default {
  // Cron-Trigger: jede Minute
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },

  // Hilfsrouten, alle mit geheimem Token geschützt: /test, /ack, /status
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.ADMIN_TOKEN || url.searchParams.get("key") !== env.ADMIN_TOKEN) {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/test") {
      const ok = await notify(env, "✅ Testalarm vom ASOS-Wächter. Push funktioniert.");
      return new Response(ok ? "sent" : "send failed", { status: ok ? 200 : 500 });
    }
    if (url.pathname === "/ack") {
      const state = await loadState(env);
      state.acked = true; // stoppt die Wiederholungen bis zur nächsten Welle
      await env.STATE.put(STATE_KEY, JSON.stringify(state));
      return new Response("quittiert");
    }
    if (url.pathname === "/status") {
      return Response.json({ state: await loadState(env), live: await fetchStock() });
    }
    return new Response("Not found", { status: 404 });
  },
};
