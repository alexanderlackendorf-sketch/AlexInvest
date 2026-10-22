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
  kurs_veraltet: "Kein aktueller Referenzkurs (letzter Kurs älter als 5 Tage) – keine kursbezogenen Aussagen",
  zyklik_spitzengewinn: "Zyklische Branche mit möglichem Spitzengewinn – niedriges KGV kann täuschen; ohne Mehrjahresdaten keine Normalisierung möglich",
  zyklik_normalisiert: "Zyklische Branche mit möglichem Spitzengewinn – Bewertung daher über den normalisierten Gewinn (aktueller Umsatz × Median-Nettomarge 5 J.) statt über das aktuelle KGV",
  zahlen_in_kuerze: "Quartalszahlen in den nächsten 7 Tagen – Einstieg erst danach prüfen (Kurslücken-Risiko)",
  split_nach_bericht_bereinigt: "Aktiensplit nach dem letzten Jahresbericht – historische EPS/Aktienzahlen entsprechend bereinigt",
  value_trap_risiko: "Value-Trap-Risiko: billig bewertet, aber Umsatz rückläufig und Kurs im Abwärtstrend",
};
const AMPEL = { gruen: "🟢", gelb: "🟡", rot: "🔴", grau: "⚪" };
const AMPEL_TXT = { gruen: "stark / attraktiv", gelb: "gemischt / beobachten", rot: "wesentliche Schwäche", grau: "unbekannt / nicht anwendbar" };
const AMPEL_KEYS = [["Qualität", "Q", "Unternehmensqualität"], ["Bewertung", "B", "Bewertung"], ["Wachstum", "W", "Wachstum"],
  ["Daten", "D", "Datenqualität"], ["Einstieg", "E", "Einstieg (Chart)"]];
const ampelRow = (r) => `<span class="amp" title="${AMPEL_KEYS.map(([k, , l]) => `${l}: ${AMPEL_TXT[(r.ampeln || {})[k] || "grau"]}`).join("\n")}">${
  AMPEL_KEYS.map(([k]) => AMPEL[(r.ampeln || {})[k] || "grau"]).join("")}</span>`;
const VERDICT_RANK = { kandidat: 7, beobachten: 6, beobachten_teuer: 5, neutral: 4, meiden_teuer: 3, meiden: 2, meiden_schwach: 1, nab: 0 };
const verdictHtml = (r) => `<span class="verdict v-${esc(r.verdict_code)}">${esc(r.verdict)}</span>`;
// Kennzeichnung nach Projekt-Regeln (Abschnitt 3.4)
const TAG = {
  pe_ttm: "BERECHNET", pe_fwd: "BERECHNET aus SCHÄTZUNG", peg: "BERECHNET aus SCHÄTZUNG", ev_ebitda: "BERECHNET",
  fcf_yield: "BERECHNET", pb: "BERECHNET", roe: "IST", op_margin: "IST", gross_margin: "IST", fcf_margin: "BERECHNET",
  net_debt_ebitda: "BERECHNET", rev_growth: "IST", earn_growth: "IST", eps_growth_fwd: "BERECHNET aus SCHÄTZUNG",
  eps: "IST / SCHÄTZUNG", div_yield: "BERECHNET", payout: "IST", beta: "IST", vol_1y: "BERECHNET",
  roic_med5: "BERECHNET", op_margin_std: "BERECHNET", cash_conversion: "BERECHNET", share_cagr: "BERECHNET",
  rev_cagr: "BERECHNET", eps_cagr: "BERECHNET", pe_vs_hist: "BERECHNET", pe_norm: "BERECHNET", implied_growth: "BERECHNET aus SCHÄTZUNG",
  rev_eps_90d: "BERECHNET aus SCHÄTZUNG", rev_breadth: "BERECHNET aus SCHÄTZUNG", sbc_rev: "BERECHNET",
};
const ampelOf = (v) => !isNum(v) ? "grau" : v >= 6.5 ? "gruen" : v < 3.5 ? "rot" : "gelb";
const flagText = (f) => f.startsWith("fundamentaldaten_vom_")
  ? `Fundamentaldaten vom ${f.slice(21)} (heutiger Abruf fehlgeschlagen)`
  : FLAG_TEXT[f] || f.replace(/_/g, " ");
const isWarnFlag = (f) => f !== "waehrung_umgerechnet";

/* ---------- Formatierung ---------- */
const nf = (d) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const F = { 0: nf(0), 1: nf(1), 2: nf(2), 4: nf(4) };
const dash = '<span class="dash">—</span>';
const isNum = (v) => typeof v === "number" && isFinite(v);
const fmt = (v, d = 1) => isNum(v) ? F[d].format(v) : dash;
const pct = (v, d = 1, sign = true) => {
  if (!isNum(v)) return dash;
  const s = F[d].format(v * 100) + " %";
  const cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
  return `<span class="${sign ? cls : ""}">${sign && v > 0 ? "+" : ""}${s}</span>`;
};
// Vorzeichen ohne Gut/Schlecht-Färbung (z.B. eingepreistes Wachstum, KGV-Abweichung: "höher" ist nicht "besser")
const pctN = (v, d = 1) => isNum(v) ? `${v > 0 ? "+" : ""}${F[d].format(v * 100)} %` : dash;
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
let REPO_WATCH = new Set();
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
  { k: "ampeln", t: "Q B W D E", l: true, v: (r) => AMPEL_KEYS.filter(([k]) => (r.ampeln || {})[k] === "gruen").length, r: ampelRow },
  { k: "verdict", t: "Urteil", l: true, v: (r) => VERDICT_RANK[r.verdict_code] ?? -1, r: verdictHtml },
  { k: "sector", t: "Sektor", l: true, r: (r) => `<span class="small">${esc(r.sector || "—")}</span>` },
  { k: "price", t: "Kurs", n: true, r: (r) => money(r.price, r.currency) },
  { k: "ret_1m", t: "1M", n: true, r: (r) => pct(r.ret_1m) },
  { k: "ret_12m", t: "12M", n: true, r: (r) => pct(r.ret_12m) },
  { k: "pe_fwd", t: "KGV fwd", n: true, r: (r) => fmt(r.pe_fwd) },
  { k: "peg", t: "PEG", n: true, r: (r) => fmt(r.peg, 2) },
  { k: "ev_ebitda", t: "EV/EBITDA", n: true, r: (r) => fmt(r.ev_ebitda) },
  { k: "fcf_yield", t: "FCF-Rend.", n: true, r: (r) => pctPlain(r.fcf_yield) },
  { k: "roic_med5", t: "ROIC 5J", n: true, r: (r) => pctPlain(r.roic_med5) },
  { k: "roe", t: "EKR", n: true, r: (r) => pctPlain(r.roe) },
  { k: "op_margin", t: "Op. Marge", n: true, r: (r) => pctPlain(r.op_margin) },
  { k: "rev_growth", t: "Umsatz Δ", n: true, r: (r) => pct(r.rev_growth) },
  { k: "rev_cagr", t: "Umsatz 5J", n: true, r: (r) => pct(r.rev_cagr) },
  { k: "pe_vs_hist", t: "KGV/Hist", n: true, r: (r) => pctN(r.pe_vs_hist, 0) },
  { k: "rev_eps_90d", t: "Rev. 90T", n: true, r: (r) => pct(r.rev_eps_90d) },
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
  const sec = r.sec && (r.sec.status === "bestaetigt" || r.sec.status === "bestaetigt_split") ? '<span class="tag zone" title="Nettogewinn und EPS mit SEC-10-K abgeglichen">SEC ✓</span>' : "";
  return sec + (w.length ? `<span class="tag warn" title="${esc(w.map(flagText).join("\n"))}">⚠ ${w.length}</span>` : (sec ? "" : '<span class="dash">ok</span>'));
}

/* ---------- Presets ---------- */
const PRESETS = [
  { id: "kandidat", label: "Kandidaten für Einzelanalyse", f: (r) => r.verdict_code === "kandidat" },
  { id: "garp", label: "Qualität 🟢 + Bewertung 🟢", f: (r) => r.ampeln?.["Qualität"] === "gruen" && r.ampeln?.["Bewertung"] === "gruen" && r.verdict_code !== "nab" },
  { id: "zone", label: "Kandidat/Beobachten in Buy-Zone", f: (r) => ["kandidat", "beobachten"].includes(r.verdict_code) && r.in_buy_zone },
  { id: "teuer", label: "Gutes Unternehmen, zu teuer", f: (r) => r.verdict_code === "beobachten_teuer" },
  { id: "dip", label: "Qualität im Rücksetzer", f: (r) => r.ampeln?.["Qualität"] === "gruen" && r.ampeln?.["Bewertung"] !== "rot" && r.verdict_code !== "nab" && (r.dist_sma200 < 0 || r.rsi14 < 35) },
  { id: "div", label: "Dividenden-Qualität", f: (r) => r.div_yield >= 0.03 && r.ampeln?.["Qualität"] !== "rot" && r.pillars["Qualität"] >= 6 && (r.payout == null || r.payout < 0.8) },
  { id: "growth", label: "Wachstum vernünftig bewertet", f: (r) => r.rev_growth >= 0.12 && r.peg > 0 && r.peg < 1.5 && r.ampeln?.["Qualität"] !== "rot" },
  { id: "compounder", label: "Compounder (ROIC, Wachstum, keine Verwässerung)", f: (r) => r.roic_med5 >= 0.15 && r.rev_cagr >= 0.08 && (r.share_cagr == null || r.share_cagr <= 0.005) && r.op_margin_std != null && r.op_margin_std < 0.05 },
  { id: "revs", label: "Positive Revisionen + Qualität", f: (r) => r.rev_eps_90d >= 0.03 && r.rev_breadth > 0 && r.ampeln?.["Qualität"] === "gruen" },
  { id: "hist", label: "Unter eigener Bewertungshistorie", f: (r) => r.pe_vs_hist <= -0.2 && r.ampeln?.["Qualität"] !== "rot" && !(r.flags || []).includes("zyklik_spitzengewinn") },
  { id: "warn", label: "Zykliker-/Value-Trap-Warnung", f: (r) => (r.flags || []).some((f) => f === "zyklik_spitzengewinn" || f === "zyklik_normalisiert" || f === "value_trap_risiko") },
  { id: "soon", label: "Zahlen in ≤ 7 Tagen", f: (r) => (r.flags || []).includes("zahlen_in_kuerze") },
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
  REPO_WATCH = new Set(DATA.meta.watchlist || []);
  REPO_WATCH.forEach((s) => WATCH.add(s));
  health();
  kpis();
  fillSelects();
  presets();
  bind();
  restoreFilters();
  render();
  method();
  movers();
  trackingView();
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
  const cnt = (c) => ROWS.filter((r) => r.verdict_code === c).length;
  const zone = ROWS.filter((r) => ["kandidat", "beobachten"].includes(r.verdict_code) && r.in_buy_zone).length;
  const sec = m.sec_status || {};
  const secOk = (sec.bestaetigt || 0) + (sec.bestaetigt_split || 0), secAll = Object.values(sec).reduce((a, b) => a + b, 0);
  $("#kpis").innerHTML = [
    ["Universum", m.universe, `${m.rows} mit Daten · ${rated.length} mit Score`],
    ["Kandidaten", cnt("kandidat"), "für Einzelanalyse", "kandidat"],
    ["In Buy-Zone", zone, "Kandidat/Beobachten, Kurs in Zone 1", "zone"],
    ["Gut, aber zu teuer", cnt("beobachten_teuer"), "Qualität 🟢, Bewertung 🔴", "teuer"],
    ["Nicht beurteilbar", cnt("nab"), "Datenlage unzureichend"],
    ["SEC-geprüft", secAll ? `${secOk}/${secAll}` : "–", "US-Gewinn & EPS bestätigt"],
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
function exportWatch() {
  const repo = DATA.meta.repo || "alexanderlackendorf-sketch/AlexInvest";
  const json = JSON.stringify({ _comment: "Watchlist für den Wochen-Digest und für alle Geräte.", symbols: [...WATCH].sort() }, null, 2);
  const url = `https://github.com/${repo}/edit/main/screener/config/watchlist.json`;
  const go = () => { toast("Watchlist kopiert. Auf GitHub den Inhalt ersetzen und „Commit changes“ klicken."); window.open(url, "_blank", "noopener"); };
  navigator.clipboard ? navigator.clipboard.writeText(json).then(go, () => { prompt("Inhalt kopieren:", json); window.open(url, "_blank", "noopener"); }) : prompt("Inhalt kopieren:", json);
}

function renderWatch() {
  const local = [...WATCH].filter((s) => !REPO_WATCH.has(s)).length;
  $("#watchInfo").textContent = `${REPO_WATCH.size} Werte aus dem Repo (auf allen Geräten, im Wochen-Digest) · ${local} nur in diesem Browser`;
  $("#watchExport").onclick = exportWatch;
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
  $("#zoneList").innerHTML = mini(rated.filter((r) => ["kandidat", "beobachten"].includes(r.verdict_code) && r.in_buy_zone).sort((a, b) => b.score - a.score).slice(0, 20));
}

/* ---------- Erfolgskontrolle ---------- */
function trackingView() {
  const t = DATA.meta.tracking;
  const el = $("#track-panel");
  if (!t || !t.cohorts) { el.innerHTML = "<h3>Erfolgskontrolle</h3><p class='small'>Noch keine Kohorten gespeichert.</p>"; return; }
  const groups = [["kandidat", "Kandidaten für Einzelanalyse"], ["top_decile", "Oberstes Score-Zehntel"], ["universe", "Ganzes Universum (gleichgewichtet)"],
    ["bottom_decile", "Unterstes Score-Zehntel"], ["S&P 500", "S&P 500 (Index)"], ["DAX", "DAX (Index)"]];
  const H = { ...t.horizons, ...t.running };
  const hs = Object.keys(H);
  const cell = (v) => isNum(v) ? pct(v) : dash;
  el.innerHTML = `<h3>Erfolgskontrolle · funktioniert das Rating?</h3>
    <p class="small">Seit <b>${esc(t.since)}</b> wird einmal pro Woche festgehalten, welche Aktien in welcher Gruppe waren (${t.cohorts} Kohorte${t.cohorts === 1 ? "" : "n"}).
    Gemessen wird die Rendite ab dem Schlusskurs des nächsten Handelstags, gleichgewichtet, in Handelswährung, ohne Dividenden und Kosten.
    Ein Horizont zählt erst, wenn er für eine Kohorte vollständig abgelaufen ist. „Seit Start“ zeigt die laufende Entwicklung aller Kohorten.</p>
    <div style="overflow-x:auto"><table class="metrics">
      <tr><td class="muted">Gruppe</td>${hs.map((h) => `<td class="n muted">${esc(h)}</td>`).join("")}</tr>
      ${groups.map(([k, l]) => `<tr><td>${l}</td>${hs.map((h) => `<td class="n">${cell(H[h][k])}</td>`).join("")}</tr>`).join("")}
      <tr><td><b>Kandidaten − Universum</b></td>${hs.map((h) => `<td class="n"><b>${isNum(H[h].kandidat) && isNum(H[h].universe) ? pct(H[h].kandidat - H[h].universe) : dash}</b></td>`).join("")}</tr>
      <tr><td><b>Oberstes − unterstes Zehntel</b></td>${hs.map((h) => `<td class="n"><b>${cell(H[h].spread)}</b></td>`).join("")}</tr>
      <tr><td>Trefferquote Kandidaten &gt; Universum</td>${hs.map((h) => `<td class="n">${isNum(H[h].hit_rate) ? pctPlain(H[h].hit_rate, 0) : dash}</td>`).join("")}</tr>
      <tr><td class="muted">ausgewertete Kohorten</td>${hs.map((h) => `<td class="n muted">${H[h].cohorts}</td>`).join("")}</tr>
    </table></div>
    <h4>So liest du das</h4>
    <ul class="small">
      <li>Das Rating taugt etwas, wenn <b>Kandidaten − Universum</b> und <b>oberstes − unterstes Zehntel</b> über viele Kohorten positiv sind, die Trefferquote also deutlich über 50 % liegt.</li>
      <li>Vor 3–6 Monaten und ohne mindestens 10–15 abgeschlossene Kohorten ist das statistisch nicht belastbar. Einzelne Wochen sind Zufall.</li>
      <li>Kohorten überlappen sich (wöchentlich gebildet, monatelang gehalten), ihre Ergebnisse sind also nicht unabhängig.</li>
      <li>Es gibt bewusst keinen Rückrechnungs-Backtest: Kostenlose Daten enthalten weder frühere Indexzusammensetzungen (Pleiten fehlen) noch frühere Analystenschätzungen. Das Ergebnis wäre geschönt.</li>
    </ul>`;
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
  $("#method-panel").innerHTML = `<h3>Methodik (nach Projekt „Aktienanalyse“)</h3>
    <p class="small">Der Screener trennt konsequent: <b>gutes Unternehmen</b> (Qualität), <b>attraktive Bewertung</b>,
    <b>Datenqualität</b> und <b>Einstiegszeitpunkt</b> (Chart). Jede Säule hat eine eigene Ampel. Grüne Ampeln werden nicht addiert.</p>
    <h4>Score 1–10</h4>
    <p class="small">Jede Kennzahl wird <b>innerhalb ihres Sektors</b> als Perzentil gemessen (keine universellen Schwellen).
    Der Score ist das gewichtete Mittel aus Qualität, Bewertung, Wachstum und Gewinnrevisionen, über das Universum auf 1–10 skaliert.
    <b>Rote Ampeln deckeln den Score:</b> Qualität 🔴 → max. 4, Bewertung 🔴 → max. 6, Value-Trap-Risiko → max. 6.
    Trend und Analysten fließen <b>nicht</b> in den Score ein. Analystenziele dienen nur zum Vergleich.</p>
    ${Object.entries(m.pillars).map(([n, p]) => `<h4>${esc(n)} · ${p.in_score ? `Gewicht ${F[0].format(p.weight * 100)} %` : "nicht im Score"}</h4>
      <div class="small">${p.metrics.map(([, l, hb]) => `${esc(l)} <span class="muted">(${hb ? "höher besser" : "niedriger besser"})</span>`).join(" · ")}</div>`).join("")}
    <h4>Ampeln</h4>
    <p class="small">🟢 Säule ≥ 6,5 · 🟡 3,5–6,5 · 🔴 &lt; 3,5 · ⚪ unbekannt. Datenqualität 🔴 bei Abdeckung &lt; 60 %, SEC-Abweichung oder ohne aktuellen Kurs.
    Einstieg 🟢 in Buy-Zone oder intaktem Aufwärtstrend nahe SMA200, 🔴 im Abwärtstrend ohne Unterstützung.</p>
    <h4>Urteile</h4>
    <ul class="small">
      <li><b>Kandidat für Einzelanalyse</b>: Score ≥ 8, Qualität 🟢, Bewertung und Wachstum nicht 🔴, keine Zykliker-/Value-Trap-Warnung. Ein Screener spricht kein „Kaufen“ aus. Das gibt es erst nach der Einzelanalyse.</li>
      <li><b>Beobachten</b>: interessant, aber nicht eindeutig. <b>Beobachten – gutes Unternehmen, zu teuer</b>: Qualität 🟢, Bewertung 🔴.</li>
      <li><b>Meiden – zu teuer</b> unterscheidet sich von <b>Meiden – wirtschaftlich schwach</b> (Qualität 🔴). <b>Meiden</b> ohne Zusatz gilt bei Wachstum 🔴 oder Score &lt; 3.</li>
      <li><b>Kein Vorteil erkennbar</b>: keine rote Ampel, aber auch kein Hinweis auf eine Fehlbewertung.</li>
      <li><b>Nicht ausreichend beurteilbar</b>: zu wenige oder widersprüchliche Daten. Dann wird kein Urteil erzwungen.</li>
    </ul>
    <h4>Branchenregeln</h4>
    <ul class="small">
      <li>Banken/Versicherer: EV/EBITDA, FCF und Bruttomarge [NICHT ANWENDBAR]. Stattdessen KBV und Gesamtkapitalrendite.</li>
      <li>REITs: KGV und Gewinnwachstum [NICHT ANWENDBAR] (FFO/AFFO nötig, nicht frei verfügbar). Kein KGV-Kursziel.</li>
      <li>Zykliker (Energie, Rohstoffe, Halbleiter, Auto, Chemie …): Energie und Rohstoffe gelten immer als zyklisch. Bei übrigen zyklischen Branchen (Halbleiter, Auto, Chemie …) hebt erst eine Historie von mindestens 5 Jahren ohne Umsatzeinbruch ≥ 15 % die Zykliker-Vermutung auf. Dann gilt ein Margenanstieg als strukturell. Bei Gewinnsprung &gt; 40 %, KGV &lt; 60 % des Sektormedians oder operativer Marge &gt; 150 % des eigenen 5-Jahres-Schnitts gilt dann „möglicher Spitzengewinn“. Mit Mehrjahresdaten wird dann über den <b>normalisierten Gewinn</b> bewertet (aktueller Umsatz × Median-Nettomarge 5 J.; so bleibt echtes Wachstum erhalten). KGV, EV/EBITDA, FCF-Rendite und Reverse-DCF zählen dann nicht, weil sie auf Spitzengewinnen beruhen. Kursziel = normalisiertes EPS × eigenes Median-KGV 5 J. Ohne Mehrjahresdaten zählt die Bewertung höchstens neutral, und es gibt kein Kursziel.</li>
      <li>Vergleich: zuerst innerhalb der Branchengruppe (z.B. Halbleiter, Software, Banken; mind. 8 Werte), sonst im Sektor (mind. 10), sonst im ganzen Universum.</li>
      <li>Value-Trap-Risiko: Bewertung 🟢, aber Umsatz rückläufig und Kurs mehr als 20 % im Minus (12-1M).</li>
    </ul>
    <h4>Stabilität &amp; Termine</h4>
    <ul class="small">
      <li>Hysterese: Kandidat wird eine Aktie ab Score 8,0, sie bleibt es bis unter 7,5. „Beobachten“ gilt ab 5,5, gehalten bis unter 5,0. Das verhindert tägliches Hin- und Herspringen.</li>
      <li>Quartalszahlen in den nächsten 7 Tagen: Die Einstiegs-Ampel ist höchstens 🟡, das Urteil bekommt einen Hinweis.</li>
      <li>Wochen-Digest: jeden Freitag nach dem Datenlauf als Kommentar im GitHub-Issue „📬 Screener-Digest“. GitHub verschickt die E-Mail. Die Watchlist dafür steht in <code>screener/config/watchlist.json</code>.</li>
    </ul>
    <h4>Mehrjahres-Daten</h4>
    <ul class="small">
      <li>US-Werte: bis 10 Geschäftsjahre aus den SEC-10-K-Berichten. Übrige: meist 4 Jahre aus den Yahoo-Jahresabschlüssen. EPS und Aktienzahl werden um spätere Aktiensplits bereinigt.</li>
      <li>ROIC = operatives Ergebnis × (1 − tatsächliche Steuerquote) / (Eigenkapital + Finanzschulden − liquide Mittel), Median über 5 Jahre. Ohne berichtete Steuerquote gibt es keinen ROIC.</li>
      <li>Margen-Schwankung = Standardabweichung der operativen Marge über 5 Jahre (niedriger = stabiler). Cash Conversion = Summe FCF / Summe Gewinn über 5 Jahre.</li>
      <li>Historisches KGV = Kurs am Geschäftsjahresende / verwässertes EPS, Median über 5 Jahre. Nur bei gleicher Kurs- und Bilanzwährung.</li>
      <li>Reverse-DCF: Das FCF-Wachstum über 10 Jahre, das den heutigen Unternehmenswert rechtfertigt (Kapitalkosten 9 %, danach 2,5 %). Niedriger = geringere Erwartungen im Kurs.</li>
      <li>Gewinnrevisionen: Veränderung der Konsens-EPS-Schätzung über 90 Tage und Saldo aus Anhebungen und Senkungen über 30 Tage.</li>
      <li>Diese Zusatzkennzahlen zählen nicht in die Datenabdeckung. Fehlen sie (häufig bei Auslandswerten), entfällt nur ihr Gewicht.</li>
    </ul>
    <h4>Daten und Kennzeichnung</h4>
    <ul class="small">
      <li>[IST] veröffentlichte Zahl · [BERECHNET] eigene Rechnung aus belegten Werten · [BERECHNET aus SCHÄTZUNG] mit Konsensschätzung · [UNBEKANNT] nicht verfügbar · [NICHT ANWENDBAR] für die Branche ungeeignet.</li>
      <li>Kein Wert wird geschätzt oder aufgefüllt. KGV, KBV und EV/EBITDA werden selbst berechnet (Währung angeglichen) und mit Yahoo abgeglichen. Bei Widerspruch wird der Wert verworfen.</li>
      <li>US-Werte: Nettogewinn und EPS werden gegen den 10-K bei der SEC geprüft (Toleranz 5 %, nachträgliche Aktiensplits werden erkannt).</li>
      <li>Ist der letzte Kurs älter als 5 Tage, gibt es kein kursbezogenes Urteil, keine Buy-Zone und kein Potenzial.</li>
    </ul>
    <h4>Modell-Bewertung</h4>
    <p class="small">Forward-EPS × faires KGV (Mittel aus eigenem und Sektor-KGV, Neubewertung max. ±25 %).
    Die Szenarien unterscheiden sich in den operativen Annahmen: Bear mit Wachstum −10 Pp. und KGV ×0,8, Base mit Konsenswachstum, Bull mit Wachstum +5 Pp. und KGV ×1,15.
    Angezeigt werden der faire Wert heute, die Sicherheitsmarge = (fairer Wert − Kurs) / fairer Wert und das Potenzial = fairer Wert / Kurs − 1.
    Die Rendite über 3 Jahre enthält Dividenden ohne Wiederanlage. Das Modell ersetzt keine DCF-Einzelanalyse.</p>
    <p class="note">Keine Anlageberatung. Der Screener ist ein Filter, um Ideen zu finden. Die Einzelanalyse ersetzt er nicht.</p>`;
}

/* ---------- Detailansicht ---------- */
let chart = null;
let CUR_PX = null;   // Kursdatei der offenen Aktie (enthält die Mehrjahres-Historie für den Prompt)

// 3 Wettbewerber aus derselben Branchengruppe, möglichst ähnlich groß (log. Abstand der Marktkapitalisierung)
function peersOf(r, n = 3) {
  const key = r.peer_group || r.sector;
  if (!key) return [];
  const size = (x) => Math.log(x.market_cap_eur || 1);
  return ROWS.filter((x) => x.symbol !== r.symbol && (x.peer_group || x.sector) === key && isNum(x.market_cap_eur)
      && x.name !== r.name)   // zweite Aktiengattung desselben Unternehmens (z.B. GOOG/GOOGL) ausschließen
    .sort((a, b) => Math.abs(size(a) - size(r)) - Math.abs(size(b) - size(r))).slice(0, n);
}

function peerTable(r) {
  const peers = peersOf(r);
  if (!peers.length) return '<div class="note">Keine vergleichbaren Werte in der Branchengruppe.</div>';
  const cols = [r, ...peers];
  const rows = [
    ["Score", (x) => scoreBadge(x.score)], ["Ampeln Q B W D E", (x) => ampelRow(x)],
    ["Urteil", (x) => `<span class="small peer-verdict">${esc(x.verdict)}</span>`],
    ["KGV fwd", (x) => fmt(x.pe_fwd)], ["KGV normalisiert", (x) => fmt(x.pe_norm)], ["KGV vs. eigener 5J-Median", (x) => pctN(x.pe_vs_hist, 0)],
    ["EV/EBITDA", (x) => fmt(x.ev_ebitda)], ["FCF-Rendite", (x) => pctPlain(x.fcf_yield)],
    ["Eingepreistes FCF-Wachstum", (x) => pctN(x.implied_growth)], ["ROIC 5J", (x) => pctPlain(x.roic_med5)],
    ["Operative Marge", (x) => pctPlain(x.op_margin)], ["Umsatz-CAGR 5J", (x) => pct(x.rev_cagr)],
    ["EPS-Revision 90T", (x) => pct(x.rev_eps_90d)], ["Marktkap. €", (x) => bn(x.market_cap_eur)],
  ];
  return `<div style="overflow-x:auto"><table class="metrics">
    <tr><td></td>${cols.map((x, i) => `<td class="n"><a href="#${encodeURIComponent(x.symbol)}" class="mono" style="${i === 0 ? "font-weight:700" : ""}">${esc(x.symbol)}</a><br><span class="small muted">${esc(x.name.slice(0, 22))}</span></td>`).join("")}</tr>
    ${rows.map(([l, f]) => `<tr><td>${l}</td>${cols.map((x) => `<td class="n">${f(x)}</td>`).join("")}</tr>`).join("")}
  </table></div>
  <div class="note">Vergleichsgruppe ${esc(r.peer_group || r.sector)}, ausgewählt nach ähnlicher Marktkapitalisierung. Bewertungsunterschiede erst nach Qualität und Wachstum deuten („billiger“ allein genügt nicht).</div>`;
}
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
  const flags = r.flags || [];
  const stale = flags.includes("kurs_veraltet");
  const na = new Set(r.not_applicable || []);
  const pctRow = (k) => {
    const p = r.metric_pct && r.metric_pct[k];
    return isNum(p) ? `<span class="pct" title="Perzentil im Sektor: ${p}"><span style="width:${p}%"></span></span> <span class="mono small">${p}</span>` : "";
  };
  const tag = (k, v) => na.has(k) ? "NICHT ANWENDBAR" : (v === null || v === undefined) ? "UNBEKANNT" : TAG[k] || "";
  const M = (label, k, html, pk = k, raw = r[k]) => ({ label, k, html: na.has(k) ? '<span class="muted">n. a.</span>' : html, pk, raw });
  const metricRows = [
    M("KGV (ttm)", "pe_ttm", fmt(r.pe_ttm)), M("KGV (fwd)", "pe_fwd", fmt(r.pe_fwd)), M("PEG", "peg", fmt(r.peg, 2)),
    M("EV/EBITDA", "ev_ebitda", fmt(r.ev_ebitda)), M("FCF-Rendite", "fcf_yield", pctPlain(r.fcf_yield)),
    M("KBV", "pb", fmt(r.pb, 2), (r.is_financial || r.is_reit) ? "pb_fin" : null),
    M("Eigenkapitalrendite", "roe", pctPlain(r.roe)), M("Operative Marge", "op_margin", pctPlain(r.op_margin)),
    M("Bruttomarge", "gross_margin", pctPlain(r.gross_margin)), M("FCF-Marge", "fcf_margin", pctPlain(r.fcf_margin)),
    M("Nettoverschuldung/EBITDA", "net_debt_ebitda", fmt(r.net_debt_ebitda, 2)),
    M("Umsatzwachstum (yoy)", "rev_growth", pct(r.rev_growth)), M("Gewinnwachstum (yoy)", "earn_growth", pct(r.earn_growth)),
    M("EPS-Wachstum erw.", "eps_growth_fwd", pct(r.eps_growth_fwd)),
    M("EPS ttm / fwd", "eps", `${fmt(r.eps_ttm, 2)} / ${fmt(r.eps_fwd, 2)} <span class="muted">${esc(r.financial_currency || "")}</span>`, null, r.eps_ttm),
    M("Dividendenrendite", "div_yield", pctPlain(r.div_yield), null), M("Ausschüttungsquote", "payout", pctPlain(r.payout, 0), null),
    M("Beta", "beta", fmt(r.beta, 2), null), M("Volatilität 1J", "vol_1y", pctPlain(r.vol_1y, 0), null),
  ];
  const hs = r.hist_source ? `${esc(r.hist_source)}, ${r.hist_years} Jahre` : "keine Mehrjahresdaten";
  const histRows = [
    M("ROIC (Median 5J)", "roic_med5", pctPlain(r.roic_med5)),
    M("Operative Marge Ø 5J ± Schwankung", "op_margin_std", isNum(r.op_margin_avg5) ? `${pctPlain(r.op_margin_avg5)} ± ${pctPlain(r.op_margin_std)}` : dash, "op_margin_std", r.op_margin_avg5),
    M("Cash Conversion 5J (FCF/Gewinn)", "cash_conversion", fmt(r.cash_conversion, 2)),
    M("Aktienzahl p.a. (− = Rückkauf)", "share_cagr", pct(r.share_cagr)),
    M("Aktienvergütung / Umsatz", "sbc_rev", pctPlain(r.sbc_rev), null),
    M("Umsatz-CAGR 5J", "rev_cagr", pct(r.rev_cagr)), M("EPS-CAGR 5J", "eps_cagr", pct(r.eps_cagr)),
    M("Verlustjahre (5J)", "loss_years5", isNum(r.loss_years5) && r.hist_years >= 3 ? String(r.loss_years5) : dash, null, r.hist_years >= 3 ? r.loss_years5 : null),
    M("KGV normalisiert (Umsatz × Median-Marge 5J)", "pe_norm", fmt(r.pe_norm)),
    M("KGV vs. eigener 5J-Median", "pe_vs_hist", isNum(r.pe_vs_hist) ? `${pctN(r.pe_vs_hist, 0)} <span class="muted">(Median ${fmt(r.pe_hist_med5)})</span>` : dash),
  ];
  // Reverse-DCF: eingepreistes FCF-Wachstum gegen tatsächliches 5J-Umsatzwachstum
  const ig = r.implied_growth;
  const igJudge = !isNum(ig) || !isNum(r.rev_cagr) ? "" : ig > r.rev_cagr + 0.05 ? "anspruchsvoll" : ig < r.rev_cagr - 0.03 ? "konservativ" : "plausibel";
  const revHtml = isNum(r.rev_eps_90d) || isNum(r.rev_breadth) ? `<dl class="kv">
      <dt>EPS-Schätzung ${esc(r.eps_trend_period === "0y" ? "lfd. GJ" : "nächstes GJ")}</dt><dd>${pct(r.rev_eps_90d)} (90 T) · ${pct(r.rev_eps_30d)} (30 T)</dd>
      <dt>Anpassungen 30 T</dt><dd>${isNum(r.rev_up30) ? `▲ ${r.rev_up30} / ▼ ${r.rev_down30}` : dash}</dd></dl>` : '<div class="note">Keine Revisionsdaten verfügbar.</div>';
  const zones = stale ? '<div class="note">Kein aktueller Referenzkurs. Ohne ihn keine Buy-Zonen und keine Orderlimits.</div>'
    : (r.buy_zones || []).map((z) =>
    `<div class="zone-card"><b>${esc(z.kind)}</b>: ${money(z.low, r.currency)} – ${money(z.high, r.currency)}<br>
     <span class="muted">${esc(z.label)} · ${pct(z.high / r.price - 1, 1, false)} vom Kurs · Handelsplatz ${esc(r.exchange || "–")}</span></div>`).join("")
    || '<div class="note">Keine Unterstützung in Reichweite unter dem Kurs (z.B. neues Tief, also ein „fallendes Messer“). Keine Buy-Zone definierbar.</div>';
  const sec = r.sec;
  const secOk = sec && (sec.status === "bestaetigt" || sec.status === "bestaetigt_split");
  const secHtml = !sec ? "" : secOk || sec.status === "abweichung" ? `
    <h4>SEC-Abgleich (10-K, GJ-Ende ${esc(sec.fy_end)})</h4>
    <table class="metrics">
      <tr><td></td><td class="n muted">SEC [IST]</td><td class="n muted">Yahoo</td><td class="n muted">Abw.</td></tr>
      ${[["Umsatz (info)", "revenue", bn], ["Nettogewinn", "net_income", bn], ["EPS verw.", "eps_diluted", (v) => fmt(v, 2)]].map(([l, k, f]) => {
        const x = sec[k] || {}; return `<tr><td>${l}</td><td class="n">${f(x.sec)}</td><td class="n">${f(x.yahoo)}</td><td class="n">${isNum(x.dev) ? pctPlain(x.dev, 1) : dash}</td></tr>`;
      }).join("")}
    </table>
    <div class="${secOk ? "ok-line" : "flag-list"}">${sec.status === "bestaetigt" ? "✓ Gewinn & EPS: Abweichung ≤ 5 % – bestätigt"
      : sec.status === "bestaetigt_split" ? `✓ Gewinn bestätigt, EPS bei Yahoo split-bereinigt (Faktor ${fmt(sec.split_factor, 2)})`
      : "⚠ Gewinn oder EPS weichen > 5 % ab – Yahoo-Werte mit Vorsicht"} · geprüft ${esc(sec.checked)} · <a href="${esc(sec.url)}" target="_blank" rel="noopener">Filings</a></div>`
    : `<div class="note">SEC: ${esc(sec.status.replace(/_/g, " "))} (geprüft ${esc(sec.checked)})</div>`;
  const a = r.ampeln || {};
  const pv = (n) => isNum(r.pillars[n]) ? F[1].format(r.pillars[n]) : "—";
  const ampelDetail = [
    ["Unternehmensqualität", "Qualität", `Säule ${pv("Qualität")}`],
    ["Bewertung", "Bewertung", `Säule ${pv("Bewertung")}`],
    ["Wachstum", "Wachstum", `Säule ${pv("Wachstum")}`],
    ["Gewinnrevisionen", "_rev", `Säule ${pv("Revisionen")}`],
    ["Datenqualität", "Daten", (r.data_why || []).join(", ")],
    ["Einstieg (Chart)", "Einstieg", `${esc(r.trend)}${r.in_buy_zone ? " · in Buy-Zone" : ""} · Trend-Säule ${pv("Trend")} (nicht im Score)`],
  ].map(([l, k, d]) => `<tr><td>${AMPEL[k === "_rev" ? ampelOf(r.pillars["Revisionen"]) : a[k] || "grau"]} ${l}</td><td class="l small">${d}</td></tr>`).join("");
  const nextDate = r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("de-DE") : null;
  const priceTime = r.price_time ? new Date(r.price_time).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : null;
  const eurNote = r.currency !== "EUR" && isNum(r.price_eur)
    ? ` · ≈ ${money(r.price_eur, "EUR")} <span class="muted">(Umrechnung ${fmt(m.fx_to_eur[r.currency], 4)} – kein ausführbarer EUR-Kurs)</span>` : "";
  const noModel = r.is_reit ? "KGV-Modell nicht anwendbar (REIT: FFO/AFFO nötig)."
    : flags.includes("zyklik_spitzengewinn") ? "Möglicher zyklischer Spitzengewinn: Ein KGV-Modell wäre irreführend, nötig sind normalisierte Gewinne (Einzelanalyse)."
    : stale ? "Kein aktueller Referenzkurs, daher kein Potenzial ausweisbar."
    : "Kein positiver Forward-Gewinn oder keine Wachstumsschätzung. Modell nicht anwendbar.";
  const S = t && t.scenarios;
  const scen = S ? [["Bear", "bear"], ["Base", "base"], ["Bull", "bull"]].map(([l, k]) => `<tr>
      <td>${l}</td><td class="n">${money(S[k].end_price, r.currency)}<br><span class="small">${pct(S[k].cagr)} p.a.</span></td>
      <td class="l small">EPS-Wachstum ${pctPlain(S[k].growth, 0)} p.a. (abnehmend), KGV ${fmt(S[k].pe)}</td></tr>`).join("") : "";

  $("#drawerBody").innerHTML = `
    <div class="d-head">
      <div class="d-title">
        <h2>${esc(r.name)}</h2>
        <div class="sub mono">${esc(r.symbol)} · ${esc((r.indices || []).join(", "))} · ${esc(r.sector || "")}${r.industry ? " / " + esc(r.industry) : ""} · ${esc(r.country || r.region || "")}</div>
        <div style="margin-top:8px"><span class="d-price">${money(r.price, r.currency)}</span>
          <span class="small" style="margin-left:8px">1M ${pct(r.ret_1m)} · 12M ${pct(r.ret_12m)} · MCap ${bn(r.market_cap_eur)} €</span></div>
        <div class="small muted" style="margin-top:4px">Referenzkurs [IST]: Yahoo Finance · ${esc(r.exchange || "–")} · Kurszeitpunkt ${priceTime ? esc(priceTime) : "unbekannt"} (letzter verfügbarer Kurs, verzögert) ·
          Abruf ${new Date(m.generated_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}${eurNote}</div>
        ${stale ? '<div class="flag-list" style="margin-top:4px">⚠ Kein aktueller Referenzkurs: kein kursbezogenes Urteil</div>' : ""}
      </div>
      <div class="d-actions">
        ${scoreBadge(r.score, true)}
        <div><div>${verdictHtml(r)}</div>
          <div class="small muted">Datenabdeckung ${pctPlain(r.coverage, 0)}${r.score_cap ? ` · Score gedeckelt (${esc(r.score_cap)})` : ""}${isNum(r.score_chg_1w) ? " · 1W " + delta(r.score_chg_1w) : ""}</div></div>
        <button class="btn secondary" id="wBtn">${WATCH.has(r.symbol) ? "★ Watchlist" : "☆ Watchlist"}</button>
        <button class="btn" id="claudeBtn" title="Prompt für die Einzelanalyse nach deinen Projekt-Anweisungen kopieren">Einzelanalyse-Prompt</button>
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
        <h3>Getrennte Beurteilung</h3>
        <table class="metrics">${ampelDetail}</table>
        ${flags.filter((f) => ["zyklik_spitzengewinn", "zyklik_normalisiert", "value_trap_risiko", "zahlen_in_kuerze"].includes(f)).map((f) => `<div class="flag-list" style="margin-top:6px">⚠ ${esc(flagText(f))}</div>`).join("")}
        <div class="note">Vergleichsgruppe: <b>${esc(r.peer_group || r.sector || "Universum")}</b> (bei zu wenigen Werten Sektor bzw. Universum). Säule = mittleres Perzentil der Kennzahlen (0–10). 🟢 ≥ 6,5 · 🟡 3,5–6,5 · 🔴 &lt; 3,5. Grüne Ampeln werden nicht addiert, eine rote überstimmt sie.</div>
        <h3 style="margin-top:16px">Buy-Zonen <span class="muted" style="text-transform:none;letter-spacing:0">· [BERECHNET] aus Kursreihe</span></h3>
        ${r.in_buy_zone && !stale ? '<div class="ok-line">● Kurs liegt aktuell in Buy-Zone 1</div>' : ""}
        ${zones}
      </div>
    </div>

    <div class="d-grid">
      <div class="panel">
        <h3>Kennzahlen <span class="muted" style="text-transform:none;letter-spacing:0">· Balken = Perzentil im Sektor</span></h3>
        <table class="metrics">${metricRows.map((x) => `<tr><td>${x.label}</td><td class="n">${x.html}</td>
          <td class="l"><span class="ktag">${esc(tag(x.k, x.raw))}</span></td><td class="n">${x.pk ? pctRow(x.pk) : ""}</td></tr>`).join("")}</table>
        <div class="note">Fundamentaldaten Stand ${esc(r.fund_date)} (letzte zwölf Monate bzw. jüngstes Quartal laut Yahoo; GAAP/IFRS gemischt mit bereinigten Werten möglich) · Quelle Yahoo Finance · Bilanzwährung ${esc(r.financial_currency || "–")}</div>
        <h3 style="margin-top:16px">Mehrjahres-Qualität <span class="muted" style="text-transform:none;letter-spacing:0">· ${hs}</span></h3>
        <table class="metrics">${histRows.map((x) => `<tr><td>${x.label}</td><td class="n">${x.html}</td>
          <td class="l"><span class="ktag">${esc(tag(x.k, x.raw))}</span></td><td class="n">${x.pk ? pctRow(x.pk) : ""}</td></tr>`).join("")}</table>
        <div id="histBox"></div>
      </div>
      <div class="panel">
        <h3>Modell-Bewertung <span class="muted" style="text-transform:none;letter-spacing:0">· [BERECHNET aus SCHÄTZUNGEN]</span></h3>
        ${t ? `<dl class="kv">
            <dt>Faire Wertspanne heute</dt><dd>${money(t.fair_range[0], r.currency)} – ${money(t.fair_range[1], r.currency)}</dd>
            <dt>Fairer Wert (Base)</dt><dd>${money(t.fair_value, r.currency)}</dd>
            <dt>Potenzial zum fairen Wert</dt><dd>${pct(t.potential)}</dd>
            <dt>Sicherheitsmarge</dt><dd>${pct(t.margin_of_safety)}</dd>
          </dl>
          <h4>Szenarien in 3 Jahren (inkl. Dividende ${pctPlain(t.div_yield)} p.a., ohne Wiederanlage)</h4>
          <table class="metrics"><tr><td class="muted">Szenario</td><td class="n muted">Kurs &amp; Rendite</td><td class="l muted">Annahmen</td></tr>${scen}</table>
          <h4>Kurspfad Base</h4>
          <table class="metrics"><tr><td>1 Jahr</td><td class="n">${money(t.y1, r.currency)}</td><td class="n">${pct(t.y1_upside)}</td></tr>
            <tr><td>2 Jahre</td><td class="n">${money(t.y2, r.currency)}</td><td class="n">${pct(t.y2_upside)}</td></tr>
            <tr><td>3 Jahre</td><td class="n">${money(t.y3, r.currency)}</td><td class="n">${pct(t.y3_upside)}</td></tr></table>
          <div class="note">Basis: ${esc(t.basis || "Konsens-EPS nächstes GJ")} · faires KGV ${fmt(t.fair_pe)} [SCHÄTZUNG]. Kein DCF. Die Einzelanalyse ersetzt es nicht. Ein Bear-Szenario ist keine Verlustuntergrenze.</div>`
        : `<div class="note">${noModel}</div>`}
        <h4>Eingepreiste Erwartung (Reverse-DCF) [BERECHNET aus SCHÄTZUNG]</h4>
        ${isNum(ig) ? `<dl class="kv"><dt>Eingepreistes FCF-Wachstum</dt><dd>${pctN(ig)} p.a. über 10 Jahre</dd>
          <dt>Zum Vergleich</dt><dd>Umsatz-CAGR 5J ${pct(r.rev_cagr)}${igJudge ? ` → <b>${igJudge}</b>` : ""}</dd></dl>
          <div class="note">Annahmen: Kapitalkosten 9 %, danach 2,5 % Dauerwachstum, Basis FCF der letzten 12 Monate und Unternehmenswert (EV). Einheitliche Annahmen für die Vergleichbarkeit, ersetzt keine individuelle DCF.</div>`
          : `<div class="note">${na.has("implied_growth") ? "Nicht anwendbar (Finanzwert)." : "Nicht berechenbar (FCF oder EV nicht positiv)."}</div>`}
        <h4>Gewinnrevisionen [SCHÄTZUNG]</h4>
        ${revHtml}
        <h4>Nächster Prüfpunkt</h4>
        <div class="small">${nextDate ? `Quartalszahlen voraussichtlich am <b>${esc(nextDate)}</b> (Yahoo-Kalender)` : '<span class="muted">Kein Termin bekannt</span>'}</div>
        <h4>Analysten-Konsens 12M [SCHÄTZUNG] – nur zum Vergleich</h4>
        ${isNum(r.analyst_target) ? `<dl class="kv"><dt>Ø Kursziel</dt><dd>${money(r.analyst_target, r.currency)} (${pct(r.analyst_upside)})</dd>
          <dt>Empfehlung</dt><dd>${fmt(r.analyst_rec, 1)} <span class="muted">(1 = Strong Buy … 5 = Sell)</span></dd>
          <dt>Analysten</dt><dd>${r.analyst_count}</dd></dl>` : '<div class="note">Weniger als 3 Analysten. Kein belastbarer Konsens.</div>'}
        ${secHtml}
        <h4>Prüfhinweise</h4>
        ${flags.length ? `<ul class="flag-list">${flags.map((f) => `<li>${esc(flagText(f))}</li>`).join("")}</ul>` : '<div class="ok-line">✓ Keine Auffälligkeiten bei den Plausibilitätsprüfungen</div>'}
        ${r.website ? `<div class="note"><a href="${esc(r.website)}" target="_blank" rel="noopener">Unternehmens-Website</a></div>` : ""}
      </div>
    </div>

    <div class="panel" style="margin-top:12px">
      <h3>Peer-Vergleich</h3>
      ${peerTable(r)}
    </div>`;

  $("#drawer").hidden = false; $("#scrim").hidden = false;
  document.body.style.overflow = "hidden";
  $("#drawer").scrollTop = 0;
  $("#closeBtn").onclick = closeDetail;
  $("#wBtn").onclick = () => { toggleWatch(r.symbol); $("#wBtn").textContent = WATCH.has(r.symbol) ? "★ Watchlist" : "☆ Watchlist"; };
  $("#claudeBtn").onclick = () => copyPrompt(r);
  CUR_PX = null;
  fetch(PX_URL(r.symbol)).then((x) => x.json()).then((px) => { CUR_PX = px; renderHist(px); drawChart(r, px); })
    .catch(() => { $("#chart").innerHTML = '<div class="empty">Kursdaten nicht verfügbar.</div>'; });
}

function renderHist(px) {
  const h = px.hist || [];
  if (h.length < 2) return;
  const cur = px.hist_currency || "";
  const rows = [
    ["Umsatz", (y) => bn(y.revenue)], ["Op. Marge", (y) => pctPlain(y.op_margin)], ["EPS verw.", (y) => fmt(y.eps, 2)],
    ["Free Cashflow", (y) => bn(y.fcf)], ["ROIC", (y) => pctPlain(y.roic)], ["Aktien (verw.)", (y) => bn(y.shares)],
  ];
  const ys = h.slice(-6);
  $("#histBox").innerHTML = `<h4>Geschäftsjahre [IST, ${esc(px.hist_source || "")}] · ${esc(cur)}</h4>
    <div style="overflow-x:auto"><table class="metrics"><tr><td></td>${ys.map((y) => `<td class="n muted">${esc(y.fy_end.slice(0, 7))}</td>`).join("")}</tr>
    ${rows.map(([l, f]) => `<tr><td>${l}</td>${ys.map((y) => `<td class="n">${f(y)}</td>`).join("")}</tr>`).join("")}</table></div>
    <div class="note">FCF = operativer Cashflow − Investitionen in Sachanlagen. ROIC = operatives Ergebnis × (1 − tatsächliche Steuerquote) / (Eigenkapital + Finanzschulden − liquide Mittel). EPS und Aktienzahl um spätere Aktiensplits bereinigt.</div>`;
}

function histPrompt(r) {
  const h = (CUR_PX && CUR_PX.symbol === r.symbol && CUR_PX.hist) || [];
  if (h.length < 2) return "";
  const n = (v, d = 0) => isNum(v) ? (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + " Mrd" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(0) + " Mio" : v.toFixed(d)) : "n/a";
  const p = (v) => isNum(v) ? (v * 100).toFixed(1) + " %" : "n/a";
  return `\nMehrjahresdaten laut Screener (${CUR_PX.hist_source}, ${CUR_PX.hist_currency || ""}; selbst verifizieren):\n`
    + h.slice(-5).map((y) => `- GJ ${y.fy_end.slice(0, 7)}: Umsatz ${n(y.revenue)}, op. Marge ${p(y.op_margin)}, EPS verw. ${n(y.eps, 2)}, FCF ${n(y.fcf)}, ROIC ${p(y.roic)}, Aktien ${n(y.shares)}`).join("\n") + "\n";
}

function peerPrompt(r) {
  const peers = peersOf(r);
  if (!peers.length) return "";
  const f = (v, d = 1) => isNum(v) ? v.toFixed(d) : "n/a";
  const p = (v) => isNum(v) ? (v * 100).toFixed(0) + " %" : "n/a";
  return `\nWettbewerber für den Peer-Vergleich (aus ${r.peer_group || r.sector}, Screener-Werte):\n`
    + peers.map((x) => `- ${x.name} (${x.symbol}): Score ${x.score ?? "n/a"}, KGV fwd ${f(x.pe_fwd)}, EV/EBITDA ${f(x.ev_ebitda)}, ROIC 5J ${p(x.roic_med5)}, Umsatz-CAGR 5J ${p(x.rev_cagr)}, Urteil ${x.verdict}`).join("\n") + "\n";
}

function copyPrompt(r) {
  const f2 = (v, d = 1) => isNum(v) ? v.toFixed(d) : "n/a";
  const p1 = (v) => isNum(v) ? (v * 100).toFixed(1) + " %" : "n/a";
  const a = r.ampeln || {};
  const z = (r.buy_zones || []).map((x) => `${x.kind}: ${x.low.toFixed(2)}–${x.high.toFixed(2)} ${r.currency}`).join("; ") || "keine";
  const hints = (r.flags || []).filter(isWarnFlag).map(flagText).join("; ") || "keine";
  const txt = `Analysiere ${r.name} (Ticker ${r.symbol}, Handelsplatz ${r.exchange || "?"}, Handelswährung ${r.currency}) nach meinen Projekt-Anweisungen „Aktienanalyse“.
Analysemodus: langfristige Anlage · Horizont: 3–5 Jahre · Anlagestil: offen · Basiswährung: EUR (Analyseannahmen).
Ergänze gemäß meinen Präferenzen ein Scoring 1–10, Preisziele für 1, 2 und 3 Jahre und Buy-Zonen aus dem Chart.

Orientierungswerte aus meinem Screener. Nicht als Quelle verwenden, alle Zahlen selbst aktuell verifizieren:
- Referenzkurs ${f2(r.price, 2)} ${r.currency} (Yahoo, Kurszeitpunkt ${r.price_time || "unbekannt"}, Fundamentaldaten Stand ${r.fund_date})
- Screener-Score ${r.score ?? "n/a"} · Urteil: ${r.verdict} · Ampeln: Qualität ${AMPEL[a["Qualität"] || "grau"]}, Bewertung ${AMPEL[a["Bewertung"] || "grau"]}, Wachstum ${AMPEL[a["Wachstum"] || "grau"]}, Daten ${AMPEL[a["Daten"] || "grau"]}, Einstieg ${AMPEL[a["Einstieg"] || "grau"]}
- KGV ttm ${f2(r.pe_ttm)}, KGV fwd ${f2(r.pe_fwd)}, EV/EBITDA ${f2(r.ev_ebitda)}, FCF-Rendite ${p1(r.fcf_yield)}, ROE ${p1(r.roe)}, op. Marge ${p1(r.op_margin)}, Umsatzwachstum ${p1(r.rev_growth)}
- ROIC 5J ${p1(r.roic_med5)}, Umsatz-CAGR 5J ${p1(r.rev_cagr)}, Aktienzahl p.a. ${p1(r.share_cagr)}, KGV vs. 5J-Median ${p1(r.pe_vs_hist)}, eingepreistes FCF-Wachstum (Reverse-DCF, 9 %/2,5 %) ${p1(r.implied_growth)}
- EPS-Revision 90 Tage ${p1(r.rev_eps_90d)} · nächster Termin ${r.earnings_date || "unbekannt"}
- KGV normalisiert ${f2(r.pe_norm)} · Vergleichsgruppe ${r.peer_group || r.sector || "?"}
- Trend: ${r.trend} · Buy-Zonen laut Screener: ${z}
- Prüfhinweise des Screeners: ${hints}
${histPrompt(r)}${peerPrompt(r)}
Bitte prüfe insbesondere: Ist die Mehrjahresentwicklung nachhaltig, was ist im Kurs eingepreist, und wie schneidet die Aktie gegen die genannten Wettbewerber ab?`;
  const done = () => toast("Prompt kopiert. Im Projekt „Aktienanalyse“ einfügen.");
  navigator.clipboard ? navigator.clipboard.writeText(txt).then(done, () => prompt("Prompt kopieren:", txt)) : prompt("Prompt kopieren:", txt);
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2200);
}

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
async function drawChart(r, px) {
  const box = $("#chart");
  if (!window.LightweightCharts) { box.innerHTML = '<div class="empty">Chart-Bibliothek nicht geladen.</div>'; return; }
  if (!px) {
    try { px = await (await fetch(PX_URL(r.symbol))).json(); } catch { box.innerHTML = '<div class="empty">Kursdaten nicht verfügbar.</div>'; return; }
  }
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
