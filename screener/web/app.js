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
  historie_je_aktie_unplausibel: "Je-Aktie-Werte der Historie passen nicht zu Yahoo (andere Aktiengattung/Einheit) – für die Bewertung verworfen",
  kbv_unplausibel: "Buchwert je Aktie unplausibel (z.B. andere Aktiengattung) – KBV verworfen",
  value_trap_risiko: "Value-Trap-Risiko: billig bewertet, aber Umsatz rückläufig und Kurs im Abwärtstrend",
};
const AMPEL = { gruen: "🟢", gelb: "🟡", rot: "🔴", grau: "⚪" };
const AMPEL_TXT = { gruen: "stark / attraktiv", gelb: "gemischt / beobachten", rot: "wesentliche Schwäche", grau: "unbekannt / nicht anwendbar" };
const AMPEL_KEYS = [["Qualität", "Q", "Unternehmensqualität"], ["Bewertung", "B", "Bewertung"], ["Wachstum", "W", "Wachstum"],
  ["Daten", "D", "Datenqualität"], ["Einstieg", "E", "Einstieg (Chart)"]];
const ampelRow = (r) => `<span class="amp" title="${AMPEL_KEYS.map(([k, , l]) => `${l}: ${AMPEL_TXT[(r.ampeln || {})[k] || "grau"]}`).join("\n")}">${
  AMPEL_KEYS.map(([k]) => AMPEL[(r.ampeln || {})[k] || "grau"]).join("")}</span>`;
const VERDICT_RANK = { kandidat: 7, beobachten: 6, beobachten_teuer: 5, neutral: 4, meiden_teuer: 3, meiden: 2, meiden_schwach: 1, nab: 0 };
const SORT_DEFAULT_ASC = new Set(["symbol", "pe_fwd", "to_buy", "net_debt_ebitda", "zone"]);
const verdictHtml = (r) => `<span class="verdict v-${esc(r.verdict_code)}">${esc(r.verdict)}</span>`;
// Kennzeichnung nach Projekt-Regeln (Abschnitt 3.4)
const TAG = {
  pe_ttm: "BERECHNET", pe_fwd: "BERECHNET aus SCHÄTZUNG", peg: "BERECHNET aus SCHÄTZUNG", ev_ebitda: "BERECHNET",
  fcf_yield: "BERECHNET", pb: "BERECHNET", roe: "IST", op_margin: "IST", gross_margin: "IST", fcf_margin: "BERECHNET",
  net_debt_ebitda: "BERECHNET", rev_growth: "IST", earn_growth: "IST", eps_growth_fwd: "BERECHNET aus SCHÄTZUNG",
  eps: "IST / SCHÄTZUNG", div_yield: "BERECHNET", payout: "IST", beta: "IST", vol_1y: "BERECHNET",
  roic_med5: "BERECHNET", op_margin_std: "BERECHNET", op_margin_trend: "BERECHNET", cash_conversion: "BERECHNET", share_cagr: "BERECHNET",
  rev_cagr: "BERECHNET", eps_cagr: "BERECHNET", pe_vs_hist: "BERECHNET", pe_norm: "BERECHNET", implied_growth: "BERECHNET aus SCHÄTZUNG",
  rev_eps_90d: "BERECHNET aus SCHÄTZUNG", rev_breadth: "BERECHNET aus SCHÄTZUNG", sbc_rev: "BERECHNET",
};
const Q_COMP_INFO = {
  "Rentabilität": { how: "ROIC Median 5 J. (Banken: ROE). 6 % → 2,5 · 9 % → 4,5 · 12 % → 6 · 18 % → 8 · ≥ 30 % → 10",
    value: (r) => r.is_financial ? `ROE 5J ${pctPlain(r.roe_med5)} · aktuell ${pctPlain(r.roe)}`
      : `ROIC 5J ${pctPlain(r.roic_med5)}${!isNum(r.roic_med5) && isNum(r.roic_ttm_est) ? ` · Schätzung 12 M. ${pctPlain(r.roic_ttm_est)}` : ""}` },
  "Margen": { how: "Operative Marge als Perzentil in der Vergleichsgruppe (Geschäftsmodell-abhängig)",
    value: (r) => `operative Marge ${pctPlain(r.op_margin)} · Gruppe ${esc(r.peer_group || "")}` },
  "Stabilität": { how: "Schwankung der Marge um ihren Trend: 1 Pp. → 10 · 3 → 8 · 5 → 6 · 8 → 3,5 · 12 → 1; −1,5 je Verlustjahr",
    value: (r) => r.is_financial ? `ROE-Schwankung ${pctPlain(r.roe_std5)}` : `± ${pctPlain(r.op_margin_std)} um den Trend · ${isNum(r.loss_years5) ? r.loss_years5 : "?"} Verlustjahr(e) in 5 J.` },
  "Gewinnqualität": { how: "Operativer Cashflow / Nettogewinn über 5 J.: 0,7 → 3 · 0,9 → 6 · 1,05 → 8,5 · ≥ 1,2 → 10",
    value: (r) => `OCF/Gewinn ${fmt(r.ocf_conversion, 2)}` },
  "Bilanz": { how: "Nettoverschuldung / EBITDA: Nettocash → 9,5–10 · 1x → 8 · 2x → 6 · 3x → 4 · 5x → 0",
    value: (r) => `${fmt(r.net_debt_ebitda, 1)}x EBITDA` },
  "Wachstum": { how: "Umsatz-CAGR 5 J.: 0 % → 3 · 4 % → 5 · 8 % → 6,5 · 12 % → 8 · 20 % → 9,5",
    value: (r) => `Umsatz 5J ${pct(r.rev_cagr)} p.a. · aktuell ${pct(r.rev_growth)}` },
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
const V = (r, k) => (r.valuation || {})[k];
const toBuyPrice = (r) => isNum(V(r, "buy_price")) ? r.price / V(r, "buy_price") - 1 : null;
const COLS = [
  { k: "star", t: "", l: true, nosort: true, sticky: true, r: (r) => `<button class="star ${WATCH.has(r.symbol) ? "on" : ""}" data-star="${esc(r.symbol)}" aria-label="Watchlist">★</button>` },
  { k: "symbol", t: "Aktie", l: true, sticky: true, r: (r) => `<div class="name"><b>${esc(r.symbol)}</b><small title="${esc(r.name)}">${esc(r.name)}</small></div>` },
  { k: "score", t: "Gesamt", r: (r) => scoreBadge(r.score) + delta(r.score_chg_1w) },
  { k: "q_score", t: "Qualität", r: (r) => scoreBadge(r.q_score) },
  { k: "price_score", t: "Preis", r: (r) => scoreBadge(r.price_score) },
  { k: "verdict", t: "Urteil", l: true, v: (r) => VERDICT_RANK[r.verdict_code] ?? -1, r: verdictHtml },
  { k: "price", t: "Kurs", n: true, r: (r) => money(r.price, r.currency) },
  { k: "fv", t: "Fairer Wert", n: true, v: (r) => V(r, "fair_value"), r: (r) => money(V(r, "fair_value"), "") },
  { k: "upside", t: "Potenzial", n: true, v: (r) => V(r, "upside"), r: (r) => pct(V(r, "upside"), 0) },
  { k: "buy", t: "Kaufkurs", n: true, v: (r) => V(r, "buy_price"), r: (r) => money(V(r, "buy_price"), "") },
  { k: "to_buy", t: "Kurs vs. Kaufkurs", n: true, v: toBuyPrice,
    r: (r) => { const d = toBuyPrice(r); return !isNum(d) ? dash : d <= 0 ? '<span class="tag zone">IM KAUFBEREICH</span>' : `<span class="small">+${F[0].format(d * 100)} %</span>`; } },
  { k: "conf", t: "Belastb.", l: true, v: (r) => ({ hoch: 3, mittel: 2, niedrig: 1 })[V(r, "confidence")] || 0, r: (r) => `<span class="small">${esc(V(r, "confidence") || "—")}</span>` },
  { k: "ampeln", t: "Q B W D E", l: true, v: (r) => AMPEL_KEYS.filter(([k]) => (r.ampeln || {})[k] === "gruen").length, r: ampelRow },
  { k: "peer_group", t: "Gruppe", l: true, r: (r) => `<span class="small">${esc(r.peer_group || r.sector || "—")}</span>` },
  { k: "pe_fwd", t: "KGV fwd", n: true, r: (r) => fmt(r.pe_fwd) },
  { k: "roic_med5", t: "ROIC 5J", n: true, r: (r) => pctPlain(r.roic_med5) },
  { k: "op_margin", t: "Op. Marge", n: true, r: (r) => pctPlain(r.op_margin) },
  { k: "rev_cagr", t: "Umsatz 5J", n: true, r: (r) => pct(r.rev_cagr) },
  { k: "net_debt_ebitda", t: "Netto-Schulden/EBITDA", n: true, r: (r) => fmt(r.net_debt_ebitda, 1) },
  { k: "div_yield", t: "Div.", n: true, r: (r) => pctPlain(r.div_yield) },
  { k: "ret_12m", t: "12M", n: true, r: (r) => pct(r.ret_12m) },
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
  { id: "kandidat", label: "Gute Aktien im Kaufbereich", f: (r) => r.verdict_code === "kandidat" },
  { id: "nahe", label: "Gute Aktien ≤ 10 % über Kaufkurs", f: (r) => r.q_score >= 7 && isNum(toBuyPrice(r)) && toBuyPrice(r) > 0 && toBuyPrice(r) <= 0.10 },
  { id: "top", label: "Top-Qualität (≥ 8,5)", f: (r) => r.q_score >= 8.5 },
  { id: "guenstig", label: "Solide & günstig (Q ≥ 5, Potenzial ≥ 20 %)", f: (r) => r.q_score >= 5 && V(r, "upside") >= 0.20 && V(r, "confidence") !== "niedrig" },
  { id: "teuer", label: "Gut, aber zu teuer – Kaufkurs merken", f: (r) => r.verdict_code === "beobachten_teuer" },
  { id: "compounder", label: "Compounder (ROIC, Wachstum, keine Verwässerung)", f: (r) => r.roic_med5 >= 0.15 && r.rev_cagr >= 0.08 && (r.share_cagr == null || r.share_cagr <= 0.005) && r.op_margin_std != null && r.op_margin_std < 0.05 },
  { id: "div", label: "Dividenden-Qualität", f: (r) => r.div_yield >= 0.03 && r.q_score >= 6 && (r.payout == null || r.payout < 0.8) },
  { id: "revs", label: "Positive Revisionen + Qualität", f: (r) => r.rev_eps_90d >= 0.03 && r.rev_breadth > 0 && r.q_score >= 7 },
  { id: "dip", label: "Qualität im Rücksetzer (unter SMA200)", f: (r) => r.q_score >= 7 && r.dist_sma200 < 0 },
  { id: "warn", label: "Value-Falle / Zykliker-Warnung", f: (r) => (r.flags || []).some((f) => f === "zyklik_spitzengewinn" || f === "zyklik_normalisiert" || f === "value_trap_risiko") },
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
  const near = ROWS.filter((r) => r.q_score >= 7 && isNum(toBuyPrice(r)) && toBuyPrice(r) > 0 && toBuyPrice(r) <= 0.10).length;
  const sec = m.sec_status || {};
  const secOk = (sec.bestaetigt || 0) + (sec.bestaetigt_split || 0), secAll = Object.values(sec).reduce((a, b) => a + b, 0);
  $("#kpis").innerHTML = [
    ["Universum", m.universe, `${m.rows} mit Daten · ${rated.length} mit Score`],
    ["Im Kaufbereich", cnt("kandidat"), "Qualität ≥ 7, Kurs ≤ Kaufkurs", "kandidat"],
    ["Nahe Kaufbereich", near, "Qualität ≥ 7, ≤ 10 % über Kaufkurs", "nahe"],
    ["Top-Qualität", ROWS.filter((r) => r.q_score >= 8.5).length, "Qualität ≥ 8,5", "top"],
    ["Gut, aber zu teuer", cnt("beobachten_teuer"), "Kaufkurs merken", "teuer"],
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
    SORT = { key: c.k, asc: SORT.key === c.k ? !SORT.asc : SORT_DEFAULT_ASC.has(c.k) };
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
  $("#method-panel").innerHTML = `<h3>Methodik (Modell 2) · Ziel: gute Aktien zu einem interessanten Kaufkurs</h3>
    <p class="small">Jede Aktie bekommt drei Zahlen: <b>Qualität</b> (Ist das ein gutes Unternehmen?), <b>Preis</b> (Ist der Kurs attraktiv gemessen am fairen Wert?)
    und daraus den <b>Gesamtscore</b>. Alle drei stehen auf einer <b>absoluten Skala</b>. Ein Score von 8 heißt „gut“, nicht „besser als 80 % der anderen“.
    Es gibt keine erzwungene Verteilung. Sind viele Aktien gut oder alle teuer, zeigt der Screener das auch so an.</p>
    <h4>1 · Qualität 0–10</h4>
    <table class="metrics">${Object.entries(Q_COMP_INFO).map(([k, i]) => `<tr><td>${k}</td><td class="l small" style="white-space:normal">${esc(i.how)}</td></tr>`).join("")}</table>
    <p class="small">Gewichte: Rentabilität 30 %, Margen 15 %, Stabilität 15 %, Gewinnqualität 10 %, Bilanz 15 %, Wachstum 15 %.
    Banken und Versicherer: ROE 45 %, Stabilität 30 %, Wachstum 25 %.
    Zu- und Abschläge: Verwässerung über 2 % bzw. 4 % p.a. (−0,7 / −1,5), Rückkäufe über 2 % (+0,3), Marge steigt bzw. fällt um mehr als 2 Pp. p.a. (+0,5 / −0,7), aktuell Verlust (−1).
    Als „Bank-ähnlich“ gelten nur Banken, Versicherer, Broker und Hypothekenfinanzierer. Visa, Mastercard, Ratingagenturen und Börsen werden normal bewertet.</p>
    <h4>2 · Fairer Wert je Aktie</h4>
    <ul class="small">
      <li><b>DCF auf die Ertragskraft:</b> Basis sind die Owner Earnings des letzten Geschäftsjahres aus den geprüften Abschlüssen, abzüglich Aktienvergütung.
        War das letzte Jahr ein Ausreißer nach unten (unter 60 % der 5-Jahres-Median-Marge, z.B. Vergleichszahlungen), zählt das Mittel aus beiden.
        Nur ohne Mehrjahresdaten wird Yahoos FCF der letzten 12 Monate genutzt.
        Owner Earnings = operativer Cashflow − min(Investitionen, Abschreibungen). Investitionen über den Abschreibungen gelten als Wachstum, nicht als Erhalt.
        Deshalb werden Unternehmen in Investitionsphasen (z.B. KI-Rechenzentren) nicht als „teuer“ abgestraft.</li>
      <li>Wachstum Jahre 1–5 = <b>Median</b> aus Umsatz-CAGR (der niedrigere Wert aus 5 und bis zu 10 Jahren, damit der Corona-Basiseffekt nicht zählt), aktuellem Umsatzwachstum und Konsens-Gewinnwachstum (−3 … +15 %). Ab Jahr 6 läuft es linear auf 3 % aus, danach 2,5 % dauerhaft.
        Liegen die drei Werte mehr als 15 Prozentpunkte auseinander, sinkt die Belastbarkeit um eine Stufe.</li>
      <li>Diskontsatz nach CAPM: 4,3 % + Beta × 4,5 %. Das Beta wird nach Blume geglättet (0,67 × Beta + 0,33) und auf 0,8–1,6 begrenzt, also 7,9–11,5 %.
        Zuschläge: +1 % bei Verschuldung über 3× EBITDA, +1 % bei schwankenden Margen oder Verlustjahren.</li>
      <li><b>Gewinn × faires KGV:</b> Konsens-EPS des nächsten Geschäftsjahres × faires KGV. Das faire KGV ist zur Hälfte das eigene 5-Jahres-Median-KGV und zur Hälfte ein wachstumsgerechtes KGV (12 + Wachstum in %; geeicht am Markt: rund 22× bei 10 % Wachstum).
        Ohne eigene Historie gilt nur das wachstumsgerechte KGV. Begrenzt auf 10–30.</li>
      <li><b>Banken und Versicherer:</b> Buchwert × gerechtfertigtes KBV = (ROE − 3 %) / (10 % − 3 %). <b>REITs:</b> Dividendenmodell, grob.</li>
      <li><b>Belegte Zykliker:</b> normalisierte Marge (Median 5 J.) × aktueller Umsatz. Ohne Mehrjahresdaten gibt es keinen fairen Wert.</li>
      <li>Fairer Wert = Mittel der Methoden. <b>Belastbarkeit</b>: hoch, wenn die Methoden höchstens 30 % auseinanderliegen, mittel bis 80 %, sonst niedrig.
        Eine Stufe tiefer bei widersprüchlichem Wachstum oder wenn der faire Wert mehr als 60 % über dem Kurs liegt: Dann preist der Markt meist ein Risiko ein, das die Vergangenheitszahlen nicht zeigen (Disruption, Klagen, Zyklus).
        Ist das Konsens-EPS unplausibel, zählt nur der DCF. Über +150 % Potenzial wird nicht bewertet (fast immer Datenfehler oder Sondersituation).
        „Kandidat“ setzt mindestens mittlere Belastbarkeit voraus; sonst „Beobachten“.</li>
    </ul>
    <h4>3 · Kaufkurs und Preis-Score</h4>
    <p class="small">Kaufkurs = fairer Wert × (1 − Sicherheitsmarge). Die Sicherheitsmarge beträgt 10 % bei Qualität ≥ 7,5, 20 % bei Qualität ≥ 6, sonst 30 %; +10 % bei niedriger Belastbarkeit.
    Preis-Score aus dem Potenzial zum fairen Wert: −50 % → 0 · −25 % → 2 · 0 % → 4,5 · +15 % → 6 · +30 % → 7,5 · +50 % → 9 · ≥ +75 % → 10.
    Bei niedriger Belastbarkeit wird er zur Mitte (4,5) hin halbiert.</p>
    <h4>4 · Gesamtscore und Urteil</h4>
    <p class="small">Gesamt = 55 % Qualität + 45 % Preis, ±0,3 bei deutlichen Gewinnrevisionen. Bei Qualität unter 4 ist der Gesamtscore höchstens 4,5: Schwache Qualität wird durch einen niedrigen Preis nicht ausgeglichen.</p>
    <ul class="small">
      <li><b>Gutes Unternehmen im Kaufbereich</b>: Qualität ≥ 7 und Kurs ≤ Kaufkurs. Ein Kandidat bleibt Kandidat, bis der Kurs mehr als 5 % über dem Kaufkurs liegt.</li>
      <li><b>Gutes Unternehmen – nahe Kaufbereich / auf Kaufkurs warten</b>: Qualität ≥ 7, Kurs unter bzw. über dem fairen Wert. Der Kaufkurs steht dabei.</li>
      <li><b>Solide Qualität</b> (5–7): günstig, fair oder zu teuer bewertet. <b>Schwache Qualität</b> (&lt; 5): meiden. Ist sie niedrig bewertet, gilt der Hinweis „Value-Falle möglich“.</li>
      <li>Der Chart (Trend, Buy-Zonen) und der Analysten-Konsens fließen <b>nicht</b> in den Score ein. Sie dienen der Einordnung.</li>
    </ul>
    <h4>Daten und Grenzen</h4>
    <ul class="small">
      <li>[IST] veröffentlichte Zahl · [BERECHNET] eigene Rechnung · [SCHÄTZUNG] Konsens oder Annahme · [UNBEKANNT] · [NICHT ANWENDBAR]. Kein Wert wird erfunden oder aufgefüllt.</li>
      <li>US-Werte: bis 10 Jahre aus den SEC-10-K-Berichten, Gewinn und EPS gegen den 10-K geprüft. Übrige: 4 Jahre aus Yahoo. Splits und Einheitenfehler werden bereinigt.</li>
      <li>Ein DCF ist empfindlich: 1 Prozentpunkt Wachstum oder Diskontsatz ändert den fairen Wert um 10–25 %. Deshalb gibt es Spanne, Belastbarkeit und Sicherheitsmarge.</li>
    </ul>
    <p class="note">Keine Anlageberatung. Der Screener filtert Ideen, die Kaufentscheidung fällt in der Einzelanalyse.</p>`;
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
    ["Gesamt", (x) => scoreBadge(x.score)], ["Qualität", (x) => scoreBadge(x.q_score)], ["Preis", (x) => scoreBadge(x.price_score)],
    ["Fairer Wert / Potenzial", (x) => isNum(V(x, "fair_value")) ? `${money(V(x, "fair_value"), "")}<br><span class="small">${pctN(V(x, "upside"), 0)}</span>` : dash],
    ["Kaufkurs", (x) => money(V(x, "buy_price"), x.currency)],
    ["Ampeln Q B W D E", (x) => ampelRow(x)],
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
    M("Margen-Trend 5J (Pp. p.a.)", "op_margin_trend", isNum(r.op_margin_trend) ? pctN(r.op_margin_trend) : dash),
    M("Operative Marge Ø 5J ± Schwankung um den Trend", "op_margin_std", isNum(r.op_margin_avg5) ? `${pctPlain(r.op_margin_avg5)} ± ${pctPlain(r.op_margin_std)}` : dash, "op_margin_std", r.op_margin_avg5),
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
  const v = r.valuation || {};
  const nextDate = r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("de-DE") : null;
  const priceTime = r.price_time ? new Date(r.price_time).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : null;
  const eurNote = r.currency !== "EUR" && isNum(r.price_eur)
    ? ` · ≈ ${money(r.price_eur, "EUR")} <span class="muted">(Umrechnung ${fmt(m.fx_to_eur[r.currency], 4)} – kein ausführbarer EUR-Kurs)</span>` : "";
  const toBuy = isNum(v.buy_price) ? r.price / v.buy_price - 1 : null;
  const comp = r.q_components || {};
  const compRows = Object.entries(Q_COMP_INFO).filter(([k]) => k in comp).map(([k, info]) => {
    const val = comp[k];
    return `<div class="pillar"><span title="${esc(info.how)}">${k}</span>
      <div class="bar"><span style="width:${isNum(val) ? val * 10 : 0}%"></span></div><b>${isNum(val) ? F[1].format(val) : "—"}</b></div>
      <div class="note" style="margin:-4px 0 6px 98px">${info.value(r)}</div>`;
  }).join("");
  const adjRows = (r.q_adjustments || []).map(([t2, d]) => `<li>${esc(t2)}: <b>${d > 0 ? "+" : ""}${F[1].format(d)}</b></li>`).join("");

  const decision = v.fair_value ? `
      <dl class="kv big-kv">
        <dt>Kurs</dt><dd>${money(r.price, r.currency)}</dd>
        <dt>Fairer Wert</dt><dd><b>${money(v.fair_value, r.currency)}</b> <span class="muted small">(${pctN(v.upside, 0)} zum Kurs)</span></dd>
        <dt>Spanne Bear–Bull</dt><dd>${money(v.range[0], r.currency)} – ${money(v.range[1], r.currency)}</dd>
        <dt>Kaufkurs</dt><dd><b>≤ ${money(v.buy_price, r.currency)}</b> <span class="muted small">(Sicherheitsmarge ${pctPlain(v.mos_required, 0)})</span></dd>
        <dt>Abstand zum Kaufkurs</dt><dd>${toBuy <= 0 ? '<span class="ok-line" style="display:inline">● im Kaufbereich</span>' : `Kurs liegt ${pctPlain(toBuy, 0)} darüber`}</dd>
        <dt>Belastbarkeit</dt><dd>${esc(v.confidence)} <span class="muted small">(${v.methods.length} Methode${v.methods.length > 1 ? "n" : ""}${v.methods.length > 1 ? ", Übereinstimmung" : ""})</span></dd>
      </dl>
      <h4>Herleitung [BERECHNET aus SCHÄTZUNGEN]</h4>
      <table class="metrics">${v.methods.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${money(x.value, r.currency)}</td></tr>
        <tr><td colspan="2" class="l small muted" style="white-space:normal">${esc(x.detail)}</td></tr>`).join("")}</table>
      ${v.discount_notes && v.discount_notes.length ? `<div class="note">Risikozuschläge im Diskontsatz: ${esc(v.discount_notes.join(", "))}</div>` : ""}
      <h4>Kursziele (fairer Wert in n Jahren)</h4>
      <table class="metrics">
        <tr><td>1 Jahr</td><td class="n">${money(v.y1, r.currency)}</td><td class="n">${pctN(v.y1 / r.price - 1, 0)}</td></tr>
        <tr><td>2 Jahre</td><td class="n">${money(v.y2, r.currency)}</td><td class="n">${pctN(v.y2 / r.price - 1, 0)}</td></tr>
        <tr><td>3 Jahre</td><td class="n">${money(v.y3, r.currency)}</td><td class="n">${pctN(v.y3 / r.price - 1, 0)}</td></tr>
      </table>
      <div class="note">Erwartete Rendite p.a. über 3 Jahre inkl. Dividende: <b>${pctN(v.cagr3)}</b>, wenn der Kurs zum fairen Wert findet. Das ist ein Modell, keine Prognose. Der Bear-Fall ist keine Verlustgrenze.</div>`
    : `<div class="note">${esc(v.reason || "Kein fairer Wert ermittelbar.")}</div>`;

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
        <div class="trio">
          <div><span>Gesamt</span>${scoreBadge(r.score, true)}</div>
          <div><span>Qualität</span>${scoreBadge(r.q_score)}</div>
          <div><span>Preis</span>${scoreBadge(r.price_score)}</div>
        </div>
        <div style="max-width:260px"><div>${verdictHtml(r)}</div>
          <div class="small muted">${ampelRow(r)} · Daten: ${esc((r.data_why || []).join(", "))}</div></div>
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
          <span><i style="background:var(--good)"></i>Kaufkurs</span>
          <span id="hoverVal" class="mono"></span>
          <div class="range">${["6M", "1J", "2J"].map((x, i) => `<button data-r="${x}" class="${i === 1 ? "on" : ""}">${x}</button>`).join("")}</div>
        </div>
        <div class="chart-box" id="chart"></div>
        <div class="note">Tagesschlusskurse, dividenden- und splitbereinigt · letzter Kurstag ${esc(r.last_date)} · RSI(14) ${fmt(r.rsi14, 0)} · Abstand SMA200 ${pct(r.dist_sma200)} · 52W ${money(r.low52, "")} – ${money(r.high52, "")} · Trend: ${esc(r.trend)}</div>
        <h4>Einstieg laut Chart [BERECHNET aus Kursreihe]</h4>
        ${r.in_buy_zone && !stale ? '<div class="ok-line">● Kurs liegt in Buy-Zone 1 (Unterstützung)</div>' : ""}
        ${zones}
        <div class="note">Die Chart-Zonen zeigen technische Unterstützungen. Ob der Preis fundamental attraktiv ist, zeigt der Kaufkurs rechts.</div>
      </div>
      <div class="panel">
        <h3>Kaufentscheidung</h3>
        ${decision}
      </div>
    </div>

    <div class="d-grid">
      <div class="panel">
        <h3>Unternehmensqualität ${scoreBadge(r.q_score)} <span class="muted" style="text-transform:none;letter-spacing:0">· absolute Skala 0–10</span></h3>
        ${compRows || '<div class="note">Zu wenige Daten für eine Qualitätsbewertung.</div>'}
        ${adjRows ? `<h4>Zu- und Abschläge</h4><ul class="small" style="margin:0;padding-left:18px">${adjRows}</ul>` : ""}
        ${flags.filter((f) => ["zyklik_spitzengewinn", "zyklik_normalisiert", "value_trap_risiko", "zahlen_in_kuerze"].includes(f)).map((f) => `<div class="flag-list" style="margin-top:6px">⚠ ${esc(flagText(f))}</div>`).join("")}
        <div class="note">Vergleichsgruppe für Margen und Info-Perzentile: <b>${esc(r.peer_group || r.sector || "Universum")}</b>. Die Schwellen der übrigen Komponenten sind absolut, siehe „Methodik“.</div>
      </div>
      <div class="panel">
        <h3>Steckbrief</h3>
        <div id="profileBox"><div class="note">lädt…</div></div>
        <h4>Nächster Prüfpunkt</h4>
        <div class="small">${nextDate ? `Quartalszahlen voraussichtlich am <b>${esc(nextDate)}</b> (Yahoo-Kalender)` : '<span class="muted">Kein Termin bekannt</span>'}</div>
        <h4>Nachrichten</h4>
        <div id="newsBox"><div class="note">lädt…</div></div>
      </div>
    </div>

    <div class="d-grid">
      <div class="panel">
        <h3>Kennzahlen <span class="muted" style="text-transform:none;letter-spacing:0">· Balken = Perzentil in der Vergleichsgruppe (Info)</span></h3>
        <table class="metrics">${metricRows.map((x) => `<tr><td>${x.label}</td><td class="n">${x.html}</td>
          <td class="l"><span class="ktag">${esc(tag(x.k, x.raw))}</span></td><td class="n">${x.pk ? pctRow(x.pk) : ""}</td></tr>`).join("")}</table>
        <div class="note">Fundamentaldaten Stand ${esc(r.fund_date)} (letzte zwölf Monate bzw. jüngstes Quartal laut Yahoo; GAAP/IFRS gemischt mit bereinigten Werten möglich) · Quelle Yahoo Finance · Bilanzwährung ${esc(r.financial_currency || "–")}</div>
        <h3 style="margin-top:16px">Mehrjahres-Qualität <span class="muted" style="text-transform:none;letter-spacing:0">· ${hs}</span></h3>
        <table class="metrics">${histRows.map((x) => `<tr><td>${x.label}</td><td class="n">${x.html}</td>
          <td class="l"><span class="ktag">${esc(tag(x.k, x.raw))}</span></td><td class="n">${x.pk ? pctRow(x.pk) : ""}</td></tr>`).join("")}</table>
        <div id="histBox"></div>
      </div>
      <div class="panel">
        <h3>Weitere Einordnung</h3>
        <h4>Eingepreiste Erwartung (Reverse-DCF) [BERECHNET aus SCHÄTZUNG]</h4>
        ${isNum(ig) ? `<dl class="kv"><dt>Eingepreistes FCF-Wachstum</dt><dd>${pctN(ig)} p.a. über 10 Jahre</dd>
          <dt>Zum Vergleich</dt><dd>Umsatz-CAGR 5J ${pct(r.rev_cagr)}${igJudge ? ` → <b>${igJudge}</b>` : ""}</dd></dl>
          <div class="note">Basis FCF der letzten 12 Monate (in Investitionsphasen niedrig) und Unternehmenswert, Kapitalkosten 9 %, danach 2,5 %.</div>`
          : `<div class="note">${na.has("implied_growth") ? "Nicht anwendbar (Finanzwert)." : "Nicht berechenbar (FCF oder EV nicht positiv)."}</div>`}
        <h4>Gewinnrevisionen [SCHÄTZUNG]</h4>
        ${revHtml}
        <h4>Analysten-Konsens 12M [SCHÄTZUNG] – nur zum Vergleich</h4>
        ${isNum(r.analyst_target) ? `<dl class="kv"><dt>Ø Kursziel</dt><dd>${money(r.analyst_target, r.currency)} (${pct(r.analyst_upside)})</dd>
          <dt>Empfehlung</dt><dd>${fmt(r.analyst_rec, 1)} <span class="muted">(1 = Strong Buy … 5 = Sell)</span></dd>
          <dt>Analysten</dt><dd>${r.analyst_count}</dd></dl>` : '<div class="note">Weniger als 3 Analysten. Kein belastbarer Konsens.</div>'}
        ${secHtml}
        <h4>Prüfhinweise</h4>
        ${flags.length ? `<ul class="flag-list">${flags.map((f) => `<li>${esc(flagText(f))}</li>`).join("")}</ul>` : '<div class="ok-line">✓ Keine Auffälligkeiten bei den Plausibilitätsprüfungen</div>'}
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
  fetch(PX_URL(r.symbol)).then((x) => x.json()).then((px) => { CUR_PX = px; renderHist(px); renderProfile(px); drawChart(r, px); })
    .catch(() => { $("#chart").innerHTML = '<div class="empty">Kursdaten nicht verfügbar.</div>'; });
}

function renderProfile(px) {
  const p = px.profile || {};
  const emp = isNum(p.fullTimeEmployees) ? F[0].format(p.fullTimeEmployees) : "—";
  const sum = p.longBusinessSummary || "";
  $("#profileBox").innerHTML = `<dl class="kv">
      <dt>Branche</dt><dd style="font-family:var(--sans)">${esc(p.industry || "—")} (${esc(p.sector || "—")})</dd>
      <dt>Sitz</dt><dd style="font-family:var(--sans)">${esc([p.city, p.country].filter(Boolean).join(", ") || "—")}</dd>
      <dt>Mitarbeiter</dt><dd>${emp}</dd>
      ${p.website ? `<dt>Website</dt><dd style="font-family:var(--sans)"><a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, ""))}</a></dd>` : ""}
    </dl>
    ${sum ? `<details class="summary"><summary>Geschäftsbeschreibung (englisch, Yahoo)</summary><p class="small">${esc(sum)}</p></details>` : '<div class="note">Keine Geschäftsbeschreibung verfügbar.</div>'}`;
  const news = px.news || [];
  $("#newsBox").innerHTML = news.length ? `<ul class="news">${news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <span class="muted small">${esc(n.publisher || "")}${n.date ? " · " + esc(new Date(n.date).toLocaleDateString("de-DE")) : ""}</span></li>`).join("")}</ul>
      <div class="note">Schlagzeilen laut Yahoo (Stand ${esc(px.info_date || "")}), ungeprüft – Fakten, Gerüchte und Managementaussagen selbst unterscheiden.</div>`
    : '<div class="note">Keine aktuellen Schlagzeilen verfügbar.</div>';
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
- Screener: Gesamt ${r.score ?? "n/a"}, Qualität ${r.q_score ?? "n/a"}/10, Preis ${r.price_score ?? "n/a"}/10 · Urteil: ${r.verdict}
- Modell-Fairer-Wert ${isNum(V(r, "fair_value")) ? V(r, "fair_value").toFixed(2) + " " + r.currency : "n/a"} (Belastbarkeit ${V(r, "confidence") || "n/a"}; ${(V(r, "methods") || []).map((x) => x.name + " " + x.value.toFixed(2)).join(", ")}), Kaufkurs laut Screener ${isNum(V(r, "buy_price")) ? "≤ " + V(r, "buy_price").toFixed(2) : "n/a"} · Ampeln: Qualität ${AMPEL[a["Qualität"] || "grau"]}, Bewertung ${AMPEL[a["Bewertung"] || "grau"]}, Wachstum ${AMPEL[a["Wachstum"] || "grau"]}, Daten ${AMPEL[a["Daten"] || "grau"]}, Einstieg ${AMPEL[a["Einstieg"] || "grau"]}
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
  const vv = r.valuation || {};
  if (isNum(vv.buy_price)) price.createPriceLine({ price: vv.buy_price, color: cssVar("--good"), lineWidth: 2, lineStyle: 0, title: "Kaufkurs" });
  if (isNum(vv.fair_value)) price.createPriceLine({ price: vv.fair_value, color: cssVar("--text-muted"), lineWidth: 1, lineStyle: 3, title: "Fairer Wert" });
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
