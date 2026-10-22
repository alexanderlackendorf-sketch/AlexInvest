"use strict";

const DATA_URL = "data/screener.json";
const PX_URL = (s) => `data/px/${s.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;

const FLAG_TEXT = {
  kein_kurs: "Kein Kurs verfügbar",
  waehrung_umgerechnet: "Kurs und Bilanz in verschiedenen Währungen – Kennzahlen per Devisenkurs umgerechnet",
  waehrung_unbekannt: "Bilanzwährung nicht umrechenbar – Bewertungskennzahlen fehlen",
  mktcap_abweichung: "Marktkapitalisierung: eigene Berechnung weicht von Yahoo ab (mehrere Aktiengattungen?)",
  kgv_inkonsistent: "KGV: eigene Berechnung widerspricht Yahoo – Wert verworfen",
  kgv_fwd_inkonsistent: "Forward-KGV: eigene Berechnung widerspricht Yahoo – Wert verworfen",
  kbv_inkonsistent: "KBV: Widerspruch zwischen Quellen – Wert verworfen",
  ev_ebitda_inkonsistent: "EV/EBITDA: Widerspruch zwischen Quellen – Wert verworfen",
  eps_wachstum_unplausibel: "Erwartetes EPS-Wachstum unplausibel – verworfen",
  dividende_unplausibel: "Dividendenrendite unplausibel – verworfen",
  kursziel_unplausibel: "Analysten-Kursziel unplausibel – verworfen",
  kurs_vs_schluss_abweichung: "Live-Kurs weicht >25 % vom letzten Schlusskurs ab",
  sec_abweichung: "Nettogewinn oder EPS bei Yahoo weichen >5 % vom SEC-10-K ab",
};
const flagText = (f) => f.startsWith("fundamentaldaten_vom_")
  ? `Fundamentaldaten vom ${f.slice(21)} (heutiger Abruf fehlgeschlagen)`
  : FLAG_TEXT[f] || f.replace(/_/g, " ");
const isWarnFlag = (f) => f !== "waehrung_umgerechnet";

/* ---------- Formatierung ---------- */
const nf = (d) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const F = { 0: nf(0), 1: nf(1), 2: nf(2) };
const dash = '<span class="dash">—</span>';
const isNum = (v) => typeof v === "number" && isFinite(v);
const fmt = (v, d = 1) => isNum(v) ? F[d].format(v) : dash;
const pct = (v, d = 1, sign = true) => {
  if (!isNum(v)) return dash;
  const s = F[d].format(v * 100) + " %";
  const cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
  return `<span class="${sign ? cls : ""}">${sign && v > 0 ? "+" : ""}${s}</span>`;
};
const pctPlain = (v, d = 1) => isNum(v) ? F[d].format(v * 100) + " %" : dash;
const bn = (v) => {
  if (!isNum(v)) return dash;
  if (v >= 1e12) return F[2].format(v / 1e12) + " Bio";
  if (v >= 1e9) return F[1].format(v / 1e9) + " Mrd";
  return F[0].format(v / 1e6) + " Mio";
};
const money = (v, cur) => isNum(v) ? `${F[2].format(v)} <span class="muted">${cur || ""}</span>` : dash;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function scoreClass(s) {
  if (!isNum(s)) return "";
  if (s >= 8.5) return "s4";
  if (s >= 7) return "s3";
  if (s >= 5.5) return "s2";
  if (s >= 4) return "s1";
  if (s >= 3) return "";
  return "lo";
}
const scoreBadge = (s, big = false) =>
  `<span class="score ${scoreClass(s)} ${big ? "big" : ""}">${isNum(s) ? F[1].format(s) : "—"}</span>`;
const delta = (d) => isNum(d) && Math.abs(d) >= 0.05
  ? `<span class="delta ${d > 0 ? "pos" : "neg"}">${d > 0 ? "▲" : "▼"}${F[1].format(Math.abs(d))}</span>` : "";

/* ---------- State ---------- */
let DATA = null, ROWS = [], SORT = { key: "score", asc: false }, PRESET = null;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } },
};
let WATCH = new Set(store.get("ax-watch", []));
const $ = (s) => document.querySelector(s);

/* ---------- Spalten ---------- */
const zoneDist = (r) => {
  const z = r.buy_zones && r.buy_zones[0];
  return z ? r.price / z.high - 1 : null;
};
const COLS = [
  { k: "star", t: "", l: true, nosort: true, sticky: true, r: (r) => `<button class="star ${WATCH.has(r.symbol) ? "on" : ""}" data-star="${esc(r.symbol)}" aria-label="Watchlist">★</button>` },
  { k: "symbol", t: "Aktie", l: true, sticky: true, r: (r) => `<div class="name"><b>${esc(r.symbol)}</b><small title="${esc(r.name)}">${esc(r.name)}</small></div>` },
  { k: "score", t: "Score", r: (r) => scoreBadge(r.score) + delta(r.score_chg_1w) },
  { k: "verdict", t: "Einschätzung", l: true, r: (r) => `<span class="verdict ${r.score >= 8.5 ? "top" : ""}">${esc(r.verdict)}</span>` },
  { k: "sector", t: "Sektor", l: true, r: (r) => `<span class="small">${esc(r.sector || "—")}</span>` },
  { k: "price", t: "Kurs", n: true, r: (r) => money(r.price, r.currency) },
  { k: "ret_1m", t: "1M", n: true, r: (r) => pct(r.ret_1m) },
  { k: "ret_12m", t: "12M", n: true, r: (r) => pct(r.ret_12m) },
  { k: "pe_fwd", t: "KGV fwd", n: true, r: (r) => fmt(r.pe_fwd) },
  { k: "peg", t: "PEG", n: true, r: (r) => fmt(r.peg, 2) },
  { k: "ev_ebitda", t: "EV/EBITDA", n: true, r: (r) => fmt(r.ev_ebitda) },
  { k: "fcf_yield", t: "FCF-Rend.", n: true, r: (r) => pctPlain(r.fcf_yield) },
  { k: "roe", t: "EKR", n: true, r: (r) => pctPlain(r.roe) },
  { k: "op_margin", t: "Op. Marge", n: true, r: (r) => pctPlain(r.op_margin) },
  { k: "rev_growth", t: "Umsatz Δ", n: true, r: (r) => pct(r.rev_growth) },
  { k: "div_yield", t: "Div.", n: true, r: (r) => pctPlain(r.div_yield) },
  { k: "analyst_upside", t: "Analysten", n: true, r: (r) => pct(r.analyst_upside) },
  { k: "zone", t: "Buy-Zone", n: true, v: zoneDist, r: (r) => r.in_buy_zone ? '<span class="tag zone">IN ZONE</span>' : pct(zoneDist(r), 1, false) },
  { k: "trend", t: "Trend", l: true, r: (r) => `<span class="small">${esc(r.trend)}</span>` },
  { k: "market_cap_eur", t: "MCap €", n: true, r: (r) => bn(r.market_cap_eur) },
  { k: "flags", t: "Daten", l: true, v: (r) => warnFlags(r).length, r: (r) => dataCell(r) },
];
const warnFlags = (r) => (r.flags || []).filter(isWarnFlag);
function dataCell(r) {
  const w = warnFlags(r);
  const sec = r.sec && r.sec.status === "bestaetigt" ? '<span class="tag zone" title="Nettogewinn und EPS mit SEC-10-K abgeglichen">SEC ✓</span>' : "";
  return sec + (w.length ? `<span class="tag warn" title="${esc(w.map(flagText).join("\n"))}">⚠ ${w.length}</span>` : (sec ? "" : '<span class="dash">ok</span>'));
}

/* ---------- Presets ---------- */
const PRESETS = [
  { id: "top", label: "Top-Rating ≥ 8,5", f: (r) => r.score >= 8.5 },
  { id: "garp", label: "Qualität zum fairen Preis", f: (r) => r.pillars["Qualität"] >= 7 && r.pillars["Bewertung"] >= 6 && r.score >= 6.5 },
  { id: "dip", label: "Überverkaufte Qualität", f: (r) => r.pillars["Qualität"] >= 7 && r.score >= 6 && (r.dist_sma200 < 0 || r.rsi14 < 35) },
  { id: "zone", label: "Kaufkandidat in Buy-Zone", f: (r) => r.score >= 7 && r.in_buy_zone },
  { id: "mom", label: "Momentum-Leader", f: (r) => r.pillars["Momentum"] >= 8 && r.pillars["Qualität"] >= 5 && r.trend === "Aufwärtstrend" },
  { id: "div", label: "Dividenden-Qualität", f: (r) => r.div_yield >= 0.03 && r.pillars["Qualität"] >= 6 && (r.payout == null || r.payout < 0.8) },
  { id: "growth", label: "Wachstum vernünftig bewertet", f: (r) => r.rev_growth >= 0.12 && r.peg > 0 && r.peg < 1.5 },
  { id: "risers", label: "Score-Aufsteiger", f: (r) => r.score_chg_1w >= 0.8 },
];

/* ---------- Laden ---------- */
async function load() {
  initTheme();
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    DATA = await res.json();
  } catch (e) {
    $("#health").className = "health err";
    $("#health span").textContent = "keine Daten";
    $("#view-screener").innerHTML = `<div class="empty"><h2>Noch keine Daten</h2>
      <p>Der erste Datenlauf steht aus oder ist fehlgeschlagen. Die Daten werden automatisch täglich nach US-Börsenschluss erzeugt (GitHub Actions).</p></div>`;
    return;
  }
  ROWS = DATA.rows;
  health();
  kpis();
  fillSelects();
  presets();
  bind();
  restoreFilters();
  render();
  method();
  movers();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) openDetail(hash);
}

function health() {
  const m = DATA.meta;
  const gen = new Date(m.generated_at);
  const ageH = (Date.now() - gen) / 36e5;
  const el = $("#health");
  el.className = "health " + (ageH < 30 ? "ok" : ageH < 80 ? "stale" : "err");
  el.querySelector("span").textContent =
    `Stand ${gen.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · Kurse ${m.price_date_max ?? "–"}`;
  el.title = ageH < 30 ? "Daten aktuell" : "Daten älter als erwartet – letzter Lauf evtl. fehlgeschlagen";
}

function kpis() {
  const m = DATA.meta;
  const rated = ROWS.filter((r) => isNum(r.score));
  const top = rated.filter((r) => r.score >= 8.5).length;
  const zone = rated.filter((r) => r.score >= 7 && r.in_buy_zone).length;
  const risers = rated.filter((r) => r.score_chg_1w >= 0.8).length;
  const sec = m.sec_status || {};
  const secOk = sec.bestaetigt || 0, secAll = Object.values(sec).reduce((a, b) => a + b, 0);
  $("#kpis").innerHTML = [
    ["Universum", m.universe, `${m.rows} mit Daten · ${m.failed.length} ohne`],
    ["Bewertet", m.rated, "Rating 1–10"],
    ["Top-Kandidaten", top, "Score ≥ 8,5", "top"],
    ["In Buy-Zone", zone, "Score ≥ 7 und Kurs in Zone 1", "zone"],
    ["Score-Aufsteiger", risers, "+0,8 in 1 Woche", "risers"],
    ["SEC-geprüft", secAll ? `${secOk}/${secAll}` : "–", "US-Abschlüsse bestätigt"],
  ].map(([t, v, s, p]) => `<div class="kpi" ${p ? `data-preset="${p}"` : ""}><span>${t}</span><b>${v}</b><small>${s}</small></div>`).join("");
  document.querySelectorAll(".kpi[data-preset]").forEach((k) => k.onclick = () => setPreset(k.dataset.preset));
}

function fillSelects() {
  const uniq = (f) => [...new Set(ROWS.flatMap(f))].filter(Boolean).sort((a, b) => a.localeCompare(b, "de"));
  const add = (sel, vals) => vals.forEach((v) => sel.insertAdjacentHTML("beforeend", `<option>${esc(v)}</option>`));
  add($("#fIndex"), uniq((r) => r.indices || []));
  add($("#fRegion"), uniq((r) => [r.region]));
  add($("#fSector"), uniq((r) => [r.sector]));
}

function presets() {
  $("#presets").innerHTML = PRESETS.map((p) => `<button class="chip" data-p="${p.id}">${p.label}</button>`).join("");
  $("#presets").onclick = (e) => { const b = e.target.closest(".chip"); if (b) setPreset(b.dataset.p); };
}
function setPreset(id) {
  PRESET = PRESET === id ? null : id;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.p === PRESET));
  switchView("screener");
  render();
}

const FILTER_IDS = ["q", "fIndex", "fRegion", "fSector", "fScore", "fPe", "fCap", "fZone", "fClean"];
function bind() {
  FILTER_IDS.forEach((id) => $("#" + id).addEventListener("input", () => { saveFilters(); render(); }));
  $("#reset").onclick = () => {
    FILTER_IDS.forEach((id) => { const el = $("#" + id); el.type === "checkbox" ? el.checked = false : el.value = ""; });
    PRESET = null; document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    saveFilters(); render();
  };
  document.querySelectorAll(".tab").forEach((t) => t.onclick = () => switchView(t.dataset.view));
  document.addEventListener("click", (e) => {
    const st = e.target.closest("[data-star]");
    if (st) { e.stopPropagation(); toggleWatch(st.dataset.star); return; }
    const tr = e.target.closest("tr[data-s]");
    if (tr) openDetail(tr.dataset.s);
  });
  $("#scrim").onclick = closeDetail;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  window.addEventListener("hashchange", () => {
    const h = decodeURIComponent(location.hash.slice(1));
    h ? openDetail(h) : closeDetail(true);
  });
}
function saveFilters() {
  store.set("ax-filters", Object.fromEntries(FILTER_IDS.map((id) => {
    const el = $("#" + id); return [id, el.type === "checkbox" ? el.checked : el.value];
  })));
}
function restoreFilters() {
  const f = store.get("ax-filters", {});
  FILTER_IDS.forEach((id) => {
    if (!(id in f)) return;
    const el = $("#" + id); el.type === "checkbox" ? el.checked = !!f[id] : el.value = f[id];
  });
}

function switchView(v) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  document.querySelectorAll(".view").forEach((s) => s.hidden = s.id !== "view-" + v);
  if (v === "watch") renderWatch();
}

/* ---------- Tabelle ---------- */
function filtered() {
  const q = $("#q").value.trim().toLowerCase();
  const idx = $("#fIndex").value, reg = $("#fRegion").value, sec = $("#fSector").value;
  const minS = parseFloat($("#fScore").value), maxPe = parseFloat($("#fPe").value), minCap = parseFloat($("#fCap").value);
  const zone = $("#fZone").checked, clean = $("#fClean").checked;
  const p = PRESETS.find((x) => x.id === PRESET);
  return ROWS.filter((r) =>
    (!q || `${r.symbol} ${r.name} ${r.sector} ${r.industry}`.toLowerCase().includes(q)) &&
    (!idx || (r.indices || []).includes(idx)) && (!reg || r.region === reg) && (!sec || r.sector === sec) &&
    (isNaN(minS) || r.score >= minS) && (isNaN(maxPe) || (isNum(r.pe_fwd) && r.pe_fwd <= maxPe)) &&
    (isNaN(minCap) || r.market_cap_eur >= minCap * 1e9) && (!zone || r.in_buy_zone) &&
    (!clean || warnFlags(r).length === 0) && (!p || p.f(r)));
}
function sortRows(rows) {
  const col = COLS.find((c) => c.k === SORT.key);
  const get = col && col.v ? col.v : (r) => r[SORT.key];
  return rows.slice().sort((a, b) => {
    let x = get(a), y = get(b);
    const xn = x == null || (typeof x === "number" && !isFinite(x)), yn = y == null || (typeof y === "number" && !isFinite(y));
    if (xn && yn) return 0; if (xn) return 1; if (yn) return -1; // fehlende Werte immer unten
    if (typeof x === "string") return SORT.asc ? x.localeCompare(y, "de") : y.localeCompare(x, "de");
    return SORT.asc ? x - y : y - x;
  });
}
function head(tbl) {
  tbl.querySelector("thead").innerHTML = "<tr>" + COLS.map((c) =>
    `<th data-k="${c.k}" class="${c.l ? "l" : ""} ${c.sticky ? "sticky" : ""} ${SORT.key === c.k ? "sorted" + (SORT.asc ? " asc" : "") : ""}">${c.t}</th>`).join("") + "</tr>";
  tbl.querySelectorAll("th").forEach((th) => th.onclick = () => {
    const c = COLS.find((x) => x.k === th.dataset.k);
    if (c.nosort) return;
    SORT = { key: c.k, asc: SORT.key === c.k ? !SORT.asc : (c.k === "symbol" || c.k === "pe_fwd" || c.k === "peg" || c.k === "ev_ebitda" || c.k === "zone") };
    render(); renderWatch();
  });
}
const rowHtml = (r) => `<tr data-s="${esc(r.symbol)}">` + COLS.map((c) =>
  `<td class="${c.l ? "l" : ""} ${c.n ? "n" : ""} ${c.sticky ? "sticky" : ""}">${c.r(r)}</td>`).join("") + "</tr>";
function render() {
  const tbl = $("#tbl"); if (!tbl) return;
  head(tbl);
  const rows = sortRows(filtered());
  tbl.querySelector("tbody").innerHTML = rows.slice(0, 800).map(rowHtml).join("");
  $("#count").textContent = `${rows.length} Treffer`;
}
function renderWatch() {
  const tbl = $("#tblWatch"); head(tbl);
  const rows = sortRows(ROWS.filter((r) => WATCH.has(r.symbol)));
  tbl.querySelector("tbody").innerHTML = rows.length ? rows.map(rowHtml).join("")
    : `<tr><td colspan="${COLS.length}" class="l muted">Noch keine Aktien auf der Watchlist.</td></tr>`;
}
function toggleWatch(s) {
  WATCH.has(s) ? WATCH.delete(s) : WATCH.add(s);
  store.set("ax-watch", [...WATCH]);
  document.querySelectorAll(`[data-star="${CSS.escape(s)}"]`).forEach((b) => b.classList.toggle("on", WATCH.has(s)));
}

/* ---------- Movers ---------- */
function movers() {
  const rated = ROWS.filter((r) => isNum(r.score));
  const mini = (rows, key) => rows.length ? rows.map((r) =>
    `<tr data-s="${esc(r.symbol)}"><td class="l"><div class="name"><b>${esc(r.symbol)}</b><small>${esc(r.name)}</small></div></td>
     <td>${scoreBadge(r.score)}</td><td class="n">${key ? delta(r[key]) : pct(zoneDist(r), 1, false)}</td></tr>`).join("")
    : '<tr><td class="l muted">Noch keine Historie – erscheint nach einigen Tagen Laufzeit.</td></tr>';
  const by = (k, dir) => rated.filter((r) => isNum(r[k]) && (dir > 0 ? r[k] > 0 : r[k] < 0))
    .sort((a, b) => dir * (b[k] - a[k])).slice(0, 15);
  $("#upW").innerHTML = mini(by("score_chg_1w", 1), "score_chg_1w");
  $("#dnW").innerHTML = mini(by("score_chg_1w", -1), "score_chg_1w");
  $("#upM").innerHTML = mini(by("score_chg_1m", 1), "score_chg_1m");
  $("#zoneList").innerHTML = mini(rated.filter((r) => r.score >= 7 && r.in_buy_zone).sort((a, b) => b.score - a.score).slice(0, 20));
}

/* ---------- Methodik & Datenqualität ---------- */
function method() {
  const m = DATA.meta;
  const fc = Object.entries(m.flag_counts || {}).sort((a, b) => b[1] - a[1]);
  const sec = m.sec_status || {};
  $("#health-panel").innerHTML = `<h3>Datenqualität</h3>
    <dl class="kv">
      <dt>Letzter Lauf</dt><dd>${new Date(m.generated_at).toLocaleString("de-DE")} (${m.runtime_s}s)</dd>
      <dt>Letzter Kurstag</dt><dd>${m.price_date_max ?? "–"}</dd>
      <dt>Universum</dt><dd>${m.universe} Aktien, ${m.rows} mit Daten, ${m.rated} bewertet</dd>
      <dt>Ohne Daten</dt><dd>${m.failed.length ? esc(m.failed.join(", ")) : "keine"}</dd>
      <dt>SEC-Abgleich</dt><dd>${Object.entries(sec).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ") || "–"}</dd>
    </dl>
    ${m.warnings.length ? `<h4>Warnungen</h4><ul class="flag-list">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    <h4>Daten-Flags (Anzahl Aktien)</h4>
    <table class="metrics">${fc.map(([k, v]) => `<tr><td>${esc(flagText(k))}</td><td class="n">${v}</td></tr>`).join("") || "<tr><td>keine</td></tr>"}</table>
    <h4>Quellen</h4>
    <dl class="kv">${Object.entries(m.sources).map(([k, v]) => `<dt>${esc(k)}</dt><dd style="font-family:var(--sans)">${esc(v)}</dd>`).join("")}</dl>
    <h4>Devisenkurse (1 Einheit → EUR)</h4>
    <dl class="kv">${Object.entries(m.fx_to_eur).filter(([k]) => k !== "GBp").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${F[2].format(v)}</dd>`).join("")}</dl>`;
  $("#method-panel").innerHTML = `<h3>So entsteht das Rating</h3>
    <p class="small">Jede Kennzahl wird <b>innerhalb ihres Sektors</b> in ein Perzentil umgerechnet (0 = schlechteste, 100 = beste Aktie im Sektor).
    Die Säulen sind der Mittelwert ihrer verfügbaren Kennzahlen. Das gewichtete Mittel wird über das ganze Universum auf <b>1–10</b> skaliert:
    Ein Score von 8,0 bedeutet „besser als ca. 78 % aller Aktien“.</p>
    ${Object.entries(m.pillars).map(([n, p]) => `<h4>${esc(n)} · Gewicht ${F[0].format(p.weight * 100)} %</h4>
      <div class="small">${p.metrics.map(([, l, hb]) => `${esc(l)} <span class="muted">(${hb ? "höher besser" : "niedriger besser"})</span>`).join(" · ")}</div>`).join("")}
    <h4>Regeln gegen falsche Zahlen</h4>
    <ul class="small">
      <li>Kein Wert wird geschätzt oder aufgefüllt. Fehlt eine Kennzahl, entfällt ihr Gewicht (Datenabdeckung wird ausgewiesen).</li>
      <li>KGV, KBV und EV/EBITDA werden selbst aus Kurs und Bilanzdaten berechnet (Währung angeglichen) und mit Yahoo abgeglichen. Widersprechen sie sich, wird der Wert verworfen.</li>
      <li>US-Werte: Nettogewinn und EPS werden rollierend gegen den 10-K bei der SEC geprüft (Toleranz 5 %). Der Umsatz wird nur informativ verglichen, weil er je nach Branche unterschiedlich definiert ist.</li>
      <li>Verlustbringer bekommen bei KGV das schlechteste Perzentil.</li>
      <li>Fällt ein Abruf aus, werden Fundamentaldaten bis 10 Tage alt weiterverwendet und markiert.</li>
    </ul>
    <h4>Buy-Zonen</h4>
    <p class="small">Zone 1 = nächste Unterstützung unter dem Kurs (Pivot-Tiefs der letzten 12 Monate, SMA50/SMA200), max. 20 % entfernt.
    Zone 2 = nächste deutlich tiefere, mehrfach getestete Unterstützung oder SMA200. Breite ±0,5 ATR(14).</p>
    <h4>Modell-Kursziele</h4>
    <p class="small">Forward-EPS × (1 + erwartetes Wachstum, gedeckelt −10…+25 %, abnehmend) × faires KGV (Mittel aus eigenem und Sektor-KGV, Neubewertung max. ±25 %).
    Das ist ein Modell, keine Prognose. Daneben steht das 12-Monats-Konsensziel der Analysten.</p>
    <p class="note">Keine Anlageberatung. Das Rating ist ein relativer Filter, um Ideen zu finden. Die Einzelanalyse ersetzt es nicht.</p>`;
}

/* ---------- Detailansicht ---------- */
let chart = null;
function closeDetail(fromHash) {
  if ($("#drawer").hidden) return;
  $("#drawer").hidden = true; $("#scrim").hidden = true;
  document.body.style.overflow = "";
  if (chart) { chart.remove(); chart = null; }
  if (fromHash !== true && location.hash) history.pushState("", document.title, location.pathname + location.search);
}

function openDetail(sym) {
  const r = ROWS.find((x) => x.symbol === sym);
  if (!r) return;
  if (location.hash.slice(1) !== encodeURIComponent(sym)) history.pushState(null, "", "#" + encodeURIComponent(sym));
  const m = DATA.meta;
  const t = r.targets;
  const pctRow = (k) => {
    const p = r.metric_pct && r.metric_pct[k];
    return isNum(p) ? `<span class="pct" title="Perzentil im Sektor: ${p}"><span style="width:${p}%"></span></span> <span class="mono small">${p}</span>` : '<span class="dash">—</span>';
  };
  const metricRows = [
    ["KGV (ttm)", fmt(r.pe_ttm), "pe_ttm"], ["KGV (fwd)", fmt(r.pe_fwd), "pe_fwd"], ["PEG", fmt(r.peg, 2), "peg"],
    ["EV/EBITDA", fmt(r.ev_ebitda), "ev_ebitda"], ["FCF-Rendite", pctPlain(r.fcf_yield), "fcf_yield"],
    ["KBV", fmt(r.pb, 2), r.is_financial ? "pb_fin" : null],
    ["Eigenkapitalrendite", pctPlain(r.roe), "roe"], ["Operative Marge", pctPlain(r.op_margin), "op_margin"],
    ["Bruttomarge", pctPlain(r.gross_margin), "gross_margin"], ["FCF-Marge", pctPlain(r.fcf_margin), "fcf_margin"],
    ["Nettoverschuldung/EBITDA", fmt(r.net_debt_ebitda, 2), "net_debt_ebitda"],
    ["Umsatzwachstum (yoy)", pct(r.rev_growth), "rev_growth"], ["Gewinnwachstum (yoy)", pct(r.earn_growth), "earn_growth"],
    ["EPS-Wachstum erw.", pct(r.eps_growth_fwd), "eps_growth_fwd"],
    ["EPS ttm / fwd", `${fmt(r.eps_ttm, 2)} / ${fmt(r.eps_fwd, 2)} <span class="muted">${esc(r.financial_currency || "")}</span>`, null],
    ["Dividendenrendite", pctPlain(r.div_yield), null], ["Ausschüttungsquote", pctPlain(r.payout, 0), null],
    ["Beta", fmt(r.beta, 2), null], ["Volatilität 1J", pctPlain(r.vol_1y, 0), null],
  ];
  const zones = (r.buy_zones || []).map((z) =>
    `<div class="zone-card"><b>${esc(z.kind)}</b>: ${money(z.low, r.currency)} – ${money(z.high, r.currency)}<br>
     <span class="muted">${esc(z.label)} · ${pct(z.high / r.price - 1, 1, false)} vom Kurs</span></div>`).join("")
    || '<div class="note">Keine Unterstützung in Reichweite unter dem Kurs (z.B. neues Tief, also ein „fallendes Messer“). Keine Buy-Zone definierbar.</div>';
  const flags = (r.flags || []);
  const sec = r.sec;
  const secHtml = !sec ? "" : sec.status === "bestaetigt" || sec.status === "abweichung" ? `
    <h4>SEC-Abgleich (10-K, GJ-Ende ${esc(sec.fy_end)})</h4>
    <table class="metrics">
      <tr><td></td><td class="n muted">SEC</td><td class="n muted">Yahoo</td><td class="n muted">Abw.</td></tr>
      ${[["Umsatz", "revenue", bn], ["Nettogewinn", "net_income", bn], ["EPS verw.", "eps_diluted", (v) => fmt(v, 2)]].map(([l, k, f]) => {
        const x = sec[k] || {}; return `<tr><td>${l}</td><td class="n">${f(x.sec)}</td><td class="n">${f(x.yahoo)}</td><td class="n">${isNum(x.dev) ? pctPlain(x.dev, 1) : dash}</td></tr>`;
      }).join("")}
    </table>
    <div class="${sec.status === "bestaetigt" ? "ok-line" : "flag-list"}">${sec.status === "bestaetigt" ? "✓ Gewinn & EPS: Abweichung ≤ 5 % – bestätigt" : "⚠ Gewinn oder EPS weichen > 5 % ab – Yahoo-Werte mit Vorsicht"} · geprüft ${esc(sec.checked)} · <a href="${esc(sec.url)}" target="_blank" rel="noopener">Filings</a></div>`
    : `<div class="note">SEC: ${esc(sec.status.replace(/_/g, " "))} (geprüft ${esc(sec.checked)})</div>`;

  $("#drawerBody").innerHTML = `
    <div class="d-head">
      <div class="d-title">
        <h2>${esc(r.name)}</h2>
        <div class="sub mono">${esc(r.symbol)} · ${esc((r.indices || []).join(", "))} · ${esc(r.sector || "")}${r.industry ? " / " + esc(r.industry) : ""} · ${esc(r.country || r.region || "")}</div>
        <div style="margin-top:8px"><span class="d-price">${money(r.price, r.currency)}</span>
          <span class="small" style="margin-left:8px">1M ${pct(r.ret_1m)} · 12M ${pct(r.ret_12m)} · ${esc(r.trend)}</span></div>
      </div>
      <div class="d-actions">
        ${scoreBadge(r.score, true)}
        <div><div class="verdict ${r.score >= 8.5 ? "top" : ""}">${esc(r.verdict)}</div>
          <div class="small muted">Datenabdeckung ${pctPlain(r.coverage, 0)}${isNum(r.score_chg_1w) ? " · 1W " + delta(r.score_chg_1w) : ""}</div></div>
        <button class="btn secondary" id="wBtn">${WATCH.has(r.symbol) ? "★ Watchlist" : "☆ Watchlist"}</button>
        <button class="btn" id="claudeBtn" title="Prompt für eine Profi-Einzelanalyse kopieren">Deep-Dive-Prompt</button>
        <button class="icon-btn" id="closeBtn" aria-label="Schließen">✕</button>
      </div>
    </div>

    <div class="d-grid">
      <div class="panel">
        <div class="chart-legend">
          <span><i style="background:var(--series-price)"></i>Kurs</span>
          <span><i style="background:var(--series-sma50)"></i>SMA50</span>
          <span><i style="background:var(--series-sma200)"></i>SMA200</span>
          <span><i class="zone"></i>Buy-Zonen</span>
          <span id="hoverVal" class="mono"></span>
          <div class="range">${["6M", "1J", "2J"].map((x, i) => `<button data-r="${x}" class="${i === 1 ? "on" : ""}">${x}</button>`).join("")}</div>
        </div>
        <div class="chart-box" id="chart"></div>
        <div class="note">Tagesschlusskurse, dividenden- und splitbereinigt · letzter Kurstag ${esc(r.last_date)} · RSI(14) ${fmt(r.rsi14, 0)} · Abstand SMA200 ${pct(r.dist_sma200)} · 52W ${money(r.low52, "")} – ${money(r.high52, "")}</div>
      </div>
      <div class="panel">
        <h3>Score-Zusammensetzung</h3>
        ${Object.entries(r.pillars).map(([n, v]) => `<div class="pillar"><span>${esc(n)}</span>
          <div class="bar"><span style="width:${isNum(v) ? v * 10 : 0}%"></span></div><b>${isNum(v) ? F[1].format(v) : "—"}</b></div>`).join("")}
        <div class="note">Säulenwert = durchschnittliches Perzentil der Kennzahlen im Sektor (0–10).</div>
        <h3 style="margin-top:16px">Buy-Zonen</h3>
        ${r.in_buy_zone ? '<div class="ok-line">● Kurs liegt aktuell in Buy-Zone 1</div>' : ""}
        ${zones}
      </div>
    </div>

    <div class="d-grid">
      <div class="panel">
        <h3>Kennzahlen <span class="muted" style="text-transform:none;letter-spacing:0">· Balken = Perzentil im Sektor</span></h3>
        <table class="metrics">${metricRows.map(([l, v, k]) => `<tr><td>${l}</td><td class="n">${v}</td><td class="n">${k ? pctRow(k) : ""}</td></tr>`).join("")}</table>
        <div class="note">Fundamentaldaten Stand ${esc(r.fund_date)} · Quelle Yahoo Finance · Bilanzwährung ${esc(r.financial_currency || "–")}</div>
      </div>
      <div class="panel">
        <h3>Kursziele</h3>
        ${t ? `<table class="metrics">
          <tr><td class="muted">Horizont</td><td class="n muted">Ziel</td><td class="n muted">Potenzial</td></tr>
          <tr><td>Modell 1 Jahr</td><td class="n">${money(t.y1, r.currency)}</td><td class="n">${pct(t.y1_upside)}</td></tr>
          <tr><td>Modell 2 Jahre</td><td class="n">${money(t.y2, r.currency)}</td><td class="n">${pct(t.y2_upside)}</td></tr>
          <tr><td>Modell 3 Jahre</td><td class="n">${money(t.y3, r.currency)}</td><td class="n">${pct(t.y3_upside)}</td></tr>
        </table><div class="note">Annahmen: faires KGV ${fmt(t.fair_pe)} · EPS-Wachstum ${pctPlain(t.growth)} p.a. (abnehmend)</div>`
        : '<div class="note">Kein Modell-Kursziel: Unternehmen ohne positiven Forward-Gewinn oder ohne Wachstumsschätzung.</div>'}
        <h4>Analysten-Konsens (12 Monate)</h4>
        ${isNum(r.analyst_target) ? `<dl class="kv"><dt>Ø Kursziel</dt><dd>${money(r.analyst_target, r.currency)} (${pct(r.analyst_upside)})</dd>
          <dt>Empfehlung</dt><dd>${fmt(r.analyst_rec, 1)} <span class="muted">(1 = Strong Buy … 5 = Sell)</span> ${esc(r.analyst_rec_key || "")}</dd>
          <dt>Analysten</dt><dd>${r.analyst_count}</dd></dl>` : '<div class="note">Weniger als 3 Analysten. Kein belastbarer Konsens.</div>'}
        ${secHtml}
        <h4>Datenqualität</h4>
        ${flags.length ? `<ul class="flag-list">${flags.map((f) => `<li>${esc(flagText(f))}</li>`).join("")}</ul>` : '<div class="ok-line">✓ Keine Auffälligkeiten bei den Plausibilitätsprüfungen</div>'}
        ${r.website ? `<div class="note"><a href="${esc(r.website)}" target="_blank" rel="noopener">Investor-Website</a></div>` : ""}
      </div>
    </div>`;

  $("#drawer").hidden = false; $("#scrim").hidden = false;
  document.body.style.overflow = "hidden";
  $("#drawer").scrollTop = 0;
  $("#closeBtn").onclick = closeDetail;
  $("#wBtn").onclick = () => { toggleWatch(r.symbol); $("#wBtn").textContent = WATCH.has(r.symbol) ? "★ Watchlist" : "☆ Watchlist"; };
  $("#claudeBtn").onclick = () => copyPrompt(r);
  drawChart(r);
}

function copyPrompt(r) {
  const z = (r.buy_zones || []).map((x) => `${x.kind}: ${x.low.toFixed(2)}–${x.high.toFixed(2)} ${r.currency}`).join("; ") || "keine";
  const txt = `Analysiere ${r.name} (${r.symbol}) als Profi-Investor: KGV, Bewertung, Qualität, Wachstum, Risiken, Chart.
Gib ein Scoring 1–10, Preisziele für 1, 2 und 3 Jahre und definiere Buy-Zonen. Verifiziere alle Zahlen mit aktuellen Quellen.
Ausgangsdaten meines Screeners (Stand ${r.fund_date}, Kurse ${r.last_date}): Kurs ${r.price?.toFixed(2)} ${r.currency}, Screener-Score ${r.score},
KGV fwd ${r.pe_fwd?.toFixed(1) ?? "n/a"}, EV/EBITDA ${r.ev_ebitda?.toFixed(1) ?? "n/a"}, ROE ${isNum(r.roe) ? (r.roe * 100).toFixed(1) + " %" : "n/a"},
Umsatzwachstum ${isNum(r.rev_growth) ? (r.rev_growth * 100).toFixed(1) + " %" : "n/a"}, Trend: ${r.trend}, Buy-Zonen laut Screener: ${z}.`;
  const done = () => toast("Prompt kopiert. In Claude einfügen.");
  navigator.clipboard ? navigator.clipboard.writeText(txt).then(done, () => prompt("Prompt kopieren:", txt)) : prompt("Prompt kopieren:", txt);
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2200);
}

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
async function drawChart(r) {
  const box = $("#chart");
  if (!window.LightweightCharts) { box.innerHTML = '<div class="empty">Chart-Bibliothek nicht geladen.</div>'; return; }
  let px;
  try { px = await (await fetch(PX_URL(r.symbol))).json(); } catch { box.innerHTML = '<div class="empty">Kursdaten nicht verfügbar.</div>'; return; }
  if (chart) chart.remove();
  chart = LightweightCharts.createChart(box, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: cssVar("--text-secondary"), fontFamily: "JetBrains Mono", fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--line") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: 0 },
  });
  const closes = px.d.map((d) => ({ time: d[0], value: d[4] }));
  const sma = (n) => {
    const out = []; let sum = 0;
    closes.forEach((c, i) => { sum += c.value; if (i >= n) sum -= closes[i - n].value; if (i >= n - 1) out.push({ time: c.time, value: sum / n }); });
    return out;
  };
  const price = chart.addAreaSeries({
    lineColor: cssVar("--series-price"), lineWidth: 2,
    topColor: cssVar("--series-price") + "33", bottomColor: "transparent", priceLineVisible: false,
  });
  price.setData(closes);
  const s50 = chart.addLineSeries({ color: cssVar("--series-sma50"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  s50.setData(sma(50));
  const s200 = chart.addLineSeries({ color: cssVar("--series-sma200"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  s200.setData(sma(200));
  (r.buy_zones || []).forEach((z, i) => {
    const opt = { color: cssVar("--good"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true };
    price.createPriceLine({ ...opt, price: z.high, title: i === 0 ? "BZ1" : "BZ2" });
    price.createPriceLine({ ...opt, price: z.low, title: "", axisLabelVisible: false });
  });
  if (r.targets) price.createPriceLine({ price: r.targets.y1, color: cssVar("--text-muted"), lineWidth: 1, lineStyle: 3, title: "Ziel 1J" });
  const setRange = (k) => {
    const days = { "6M": 126, "1J": 252, "2J": 520 }[k];
    const from = closes[Math.max(0, closes.length - days)].time;
    chart.timeScale().setVisibleRange({ from, to: closes[closes.length - 1].time });
    document.querySelectorAll(".range button").forEach((b) => b.classList.toggle("on", b.dataset.r === k));
  };
  document.querySelectorAll(".range button").forEach((b) => b.onclick = () => setRange(b.dataset.r));
  setRange("1J");
  const hv = $("#hoverVal");
  chart.subscribeCrosshairMove((p) => {
    const v = p.time && p.seriesData.get(price);
    hv.textContent = v ? `${p.time}  ${F[2].format(v.value)} ${px.currency}` : "";
  });
}

/* ---------- Theme ---------- */
function initTheme() {
  const saved = store.get("ax-theme", null);
  document.documentElement.dataset.theme = saved || "dark"; // Terminal-Look als Standard
  $("#themeBtn").onclick = () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; store.set("ax-theme", t);
    const open = location.hash.slice(1);
    if (open && !$("#drawer").hidden) drawChart(ROWS.find((x) => x.symbol === decodeURIComponent(open)));
  };
}

load();
