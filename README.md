# ASOS Adventskalender-Wächter

Prüft jede Minute den öffentlichen ASOS-Bestand (DE-Shop, 120 €) für den Face + Body Advent Calendar 2026
(Produkt 210335519) und schickt dir sofort einen Push mit Direktlink, sobald er lieferbar ist.
**Das System kauft nie selbst.** Login, Karte und "Bestellen" machst du im eigenen Browser.

## Was drin ist
- `worker/src/logic.js` – Entscheidungslogik (Produkt-/Varianten-/Preisprüfung, 1 Alarm pro Welle, Wiederholung max. 5x alle 2 Min, Blockade-Warnung, Tages-Heartbeat)
- `worker/src/index.js` – Cloudflare Worker (Cron jede Minute, KV-Zustand, Push per ntfy und/oder Telegram)
- `test/logic.test.js` – 12 Tests (`npm test`)
- `scripts/live-check.mjs` – einmalige Live-Abfrage ohne Alarm (`npm run live`)

## Einrichtung (einmalig, ca. 10 Minuten)
1. Kostenloses Cloudflare-Konto anlegen.
2. Push-Kanal wählen:
   - **ntfy (am einfachsten):** App "ntfy" installieren, ein schwer erratbares Thema abonnieren, z. B. `asos-advent-x7k29q`.
   - **Telegram:** Bei `@BotFather` einen Bot anlegen (Token), dem Bot schreiben, Chat-ID ermitteln.
3. Im Projektordner:
   ```bash
   npm install
   npx wrangler login
   npx wrangler kv namespace create STATE   # ausgegebene id in worker/wrangler.toml eintragen
   npx wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml          # langes Zufallspasswort
   npx wrangler secret put NTFY_TOPIC --config worker/wrangler.toml           # falls ntfy
   npx wrangler secret put TELEGRAM_BOT_TOKEN --config worker/wrangler.toml   # falls Telegram
   npx wrangler secret put TELEGRAM_CHAT_ID --config worker/wrangler.toml     # falls Telegram
   npm run deploy
   ```
   Die Secrets tippst du selbst ein. Sie stehen nirgends im Code.
4. Test: `https://<dein-worker>.workers.dev/test?key=<ADMIN_TOKEN>` muss einen Push auf dein Handy senden.

## Bedienung
- `/status?key=…` zeigt Zustand und Live-Bestand. `/ack?key=…` stoppt die Wiederholungen nach einem Alarm.
- Beim ersten Lauf kommt sofort ein Heartbeat ("Wächter läuft"). Danach einmal pro Tag.
- Meldung "Wächter blind": 5 Abfragen in Folge fehlgeschlagen, evtl. blockt ASOS die Cloud-IP. Dann bitte melden, Ausweichplan wäre dein PC als Wächter.

## Kauf-Sicherheit
- Alarm nur bei Produkt-ID + Variante + Bestand "lieferbar". Weicht der Preis von 120 € ab, kommt ein Warn-Alarm.
- Du bestellst selbst. Prüfe im Warenkorb: genau **1 Stück**, richtige Summe, danach nicht erneut bestellen.
- Auf ASOS-DE ist die Bestätigungs-Mail der Beleg. Wiederholte Alarme sind nur Erinnerungen und kein Hinweis auf eine zweite Chance.

## Hinweise
- Die Abfrage nutzt nur einen öffentlichen Endpunkt, 1 Request pro Minute, ohne Umgehung von Schutzmechanismen.
- Nicht den `summaries`-Endpunkt verwenden: er meldet den Artikel fälschlich als verfügbar.
