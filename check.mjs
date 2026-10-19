// Checks a HiOrg course page for free seats and pushes to ntfy.
// Env: NTFY_TOPIC (required unless DRY_RUN), PAGE_URL, STATE_FILE, HTML_FILE (local test),
//      DRY_RUN=1 (print instead of send), TEST=1 (send a test push with the current status).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PAGE_URL = process.env.PAGE_URL || "https://www.hiorg-server.de/kurse_extern.php?ov=bks&kt=43910";
const BASE = "https://www.hiorg-server.de/";
const STATE_FILE = process.env.STATE_FILE || "state.json";
const TOPIC = process.env.NTFY_TOPIC;
const DRY_RUN = process.env.DRY_RUN === "1";
const TEST = process.env.TEST === "1";
const ERROR_ALERT_AFTER = 3; // consecutive failed runs before warning

const text = (s) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&NewLine;/g, " ").replace(/&nbsp;/g, " ").replace(/&colon;/g, ":").replace(/&period;/g, ".")
    .replace(/&auml;/g, "ä").replace(/&ouml;/g, "ö").replace(/&uuml;/g, "ü").replace(/&szlig;/g, "ß").replace(/&lpar;/g, "(").replace(/&rpar;/g, ")").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();

async function loadHtml() {
  if (process.env.HTML_FILE) return readFileSync(process.env.HTML_FILE, "utf8");
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(PAGE_URL, { headers: { "User-Agent": "Mozilla/5.0 (seat-watch)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw lastErr;
}

// One entry per course date: { key, dates, title, state: "open"|"full"|"other", detail, link }
function parseTerms(html) {
  const blocks = html.split('class="termine-container"').slice(1);
  return blocks.map((b) => {
    const dates = text((b.match(/class="termine-start-ende-datum">([\s\S]*?)<\/div>/) || [])[1] || "?");
    const title = text((b.match(/class="kurstyp-bezeichung">([\s\S]*?)<\/div>/) || [])[1] || "");
    const seats = text((b.match(/class="termine-button-anmeld-plaetze">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || "");
    const href = (b.match(/href="([^"]*tn_anmeldung\.php[^"]*)"/) || [])[1];
    let state = "other";
    if (href) state = "open";
    else if (/ausgebucht/i.test(seats)) state = "full";
    return {
      key: dates,
      dates,
      title,
      state,
      detail: seats || null,
      link: href ? new URL(href.replace(/&amp;/g, "&"), BASE).href : null,
    };
  });
}

async function push({ title, message, priority = 3, tags = [], click = PAGE_URL }) {
  const body = { topic: TOPIC, title, message, priority, tags, click };
  if (DRY_RUN || !TOPIC) {
    console.log(`[push${TOPIC ? "" : " skipped: no NTFY_TOPIC"}] p${priority} ${title}\n  ${message}\n  -> ${click}`);
    return;
  }
  const res = await fetch("https://ntfy.sh/", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}: ${await res.text()}`);
}

const prev = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : null;
const state = { checked: new Date().toISOString(), errors: 0, terms: {} };

let terms;
try {
  terms = parseTerms(await loadHtml());
  if (terms.length === 0) throw new Error("no course dates found on page (layout changed or course removed?)");
} catch (e) {
  state.errors = (prev?.errors || 0) + 1;
  state.terms = prev?.terms || {};
  console.error(`check failed (${state.errors}x in a row): ${e.message}`);
  if (state.errors === ERROR_ALERT_AFTER || TEST)
    await push({ title: "Seat watch: check failing", message: `${state.errors} failed checks in a row: ${e.message}`, priority: 3, tags: ["warning"] });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  process.exit(0);
}

for (const t of terms) state.terms[t.key] = t.state;
const summary = terms.map((t) => `${t.dates}: ${t.state === "open" ? "SEATS FREE" : t.detail || t.state}`).join("\n");
console.log(summary);

if (TEST) {
  await push({ title: "Seat watch: test", message: `Watcher works. Current status:\n${summary}`, tags: ["white_check_mark"] });
} else if (!prev) {
  await push({ title: "Seat watch started", message: `Checking every ~5 min.\n${summary}`, priority: 2, tags: ["eyes"] });
}

for (const t of terms) {
  const before = prev?.terms?.[t.key];
  if (t.state === "open") {
    // Repeat on every run while seats are free, so it can't be missed.
    await push({
      title: `FREE SEAT: ${t.title}, ${t.dates.split(" - ")[0]}`,
      message: `${t.title} ${t.dates}${t.detail ? ` (${t.detail})` : ""}. Tap to sign up.`,
      priority: 5,
      tags: ["rotating_light"],
      click: t.link,
    });
  } else if (before === "open") {
    await push({ title: "Seat taken again", message: `${t.dates}: ${t.detail || t.state}`, priority: 3, tags: ["x"] });
  } else if (prev && before === undefined) {
    await push({ title: "New course date listed", message: `${t.title} ${t.dates}: ${t.detail || t.state}`, priority: 4, tags: ["new"] });
  }
}
if (prev) {
  for (const key of Object.keys(prev.terms || {}))
    if (!(key in state.terms))
      await push({ title: "Course date no longer listed", message: key, priority: 2, tags: ["wastebasket"] });
}
if (prev?.errors >= ERROR_ALERT_AFTER)
  await push({ title: "Seat watch: recovered", message: summary, priority: 2, tags: ["white_check_mark"] });

writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
