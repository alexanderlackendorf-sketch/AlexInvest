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
  umsatzprognose_unplausibel: "Konsens-Umsatzprognose unplausibel – verworfen",
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
  value_trap_risiko: "Value-Falle möglich: günstig bewertet, aber schwache Qualität",
  bilanz_warnsignal: "Finanzielle Schieflage (Altman Z'' in der Gefahrenzone plus Verlust oder hohe Verschuldung) – Rating max. 4",
  gewinnqualitaet_pruefen: "Gewinnqualität prüfen (Beneish M-Score bzw. Gewinn deutlich über dem Cashflow) – Rating max. 6",
  methoden_einig: "Alle drei Profi-Methoden einig (Quant-Faktoren, erwartete Rendite, fairer Wert)",
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
  "Rentabilität": { how: "ROIC Median 5 J., Mittel mit und ohne Goodwill (Banken: ROE). 6 % → 2,5 · 9 % → 4,5 · 12 % → 6 · 18 % → 8 · ≥ 30 % → 10",
    value: (r) => r.is_financial ? `ROE 5J ${pctPlain(r.roe_med5)} · aktuell ${pctPlain(r.roe)}`
      : `ROIC 5J ${pctPlain(r.roic_med5)} · ohne Goodwill ${pctPlain(r.roic_ex_gw_med5)}${!isNum(r.roic_med5) && isNum(r.roic_ttm_est) ? ` · Schätzung 12 M. ${pctPlain(r.roic_ttm_est)}` : ""}${r.ic_negative_profitable ? " · Gewinn auf negativem Kapital (Rückkäufe)" : ""}` },
  "Bruttoprofitabilität": { how: "Bruttogewinn / Bilanzsumme (Novy-Marx 2013, starker Renditefaktor): 5 % → 1 · 15 % → 4 · 25 % → 6 · 35 % → 8 · ≥ 50 % → 10",
    value: (r) => `Bruttogewinn/Bilanzsumme ${pctPlain(r.gross_prof)}` },
  "Margen": { how: "Operative Marge als Perzentil in der Vergleichsgruppe (Geschäftsmodell-abhängig)",
    value: (r) => `operative Marge ${pctPlain(r.op_margin)} · Gruppe ${esc(r.peer_group || "")}` },
  "Stabilität": { how: "Schwankung der Marge um ihren Trend: 1 Pp. → 10 · 3 → 8 · 5 → 6 · 8 → 3,5 · 12 → 1; −1,5 je Verlustjahr",
    value: (r) => r.is_financial ? `ROE-Schwankung ${pctPlain(r.roe_std5)}` : `± ${pctPlain(r.op_margin_std)} um den Trend · ${isNum(r.loss_years5) ? r.loss_years5 : "?"} Verlustjahr(e) in 5 J.` },
  "Gewinnqualität": { how: "Mittel aus operativem Cashflow / Nettogewinn 5 J. (0,7 → 3 · 0,9 → 6 · ≥ 1,2 → 10) und Accruals nach Sloan = (Gewinn − op. Cashflow) / Bilanzsumme (−5 % → 8,5 · 0 → 6 · +5 % → 3 · +10 % → 0)",
    value: (r) => `OCF/Gewinn ${fmt(r.ocf_conversion, 2)} · Accruals ${pctN(r.accruals)}` },
  "Bilanz": { how: "Nettoverschuldung / EBITDA: Nettocash → 9,5–10 · 1x → 8 · 2x → 6 · 3x → 4 · 5x → 0",
    value: (r) => `${fmt(r.net_debt_ebitda, 1)}x EBITDA` },
  "Wachstum": { how: "Umsatz-CAGR, niedrigerer Wert aus 5 und bis zu 10 Jahren (Corona-Basiseffekt): 0 % → 3 · 4 % → 5 · 8 % → 6,5 · 12 % → 8 · 20 % → 9,5",
    value: (r) => `Umsatz 5J ${pct(r.rev_cagr)} · 10J ${pct(r.rev_cagr_long)} p.a. · aktuell ${pct(r.rev_growth)}` },
  "F-Score": { how: "Piotroski F-Score: 9 Prüfungen, ob sich Ertrag, Finanzierung und Effizienz im letzten Jahr verbessert haben. 2 → 0 · 4 → 3 · 6 → 6,5 · 8 → 9 · 9 → 10",
    value: (r) => isNum(r.f_score) ? `${r.f_score} von 9 (${r.f_score_n} Prüfungen mit Daten)` : "keine Daten" },
};
const ampelOf = (v) => !isNum(v) ? "grau" : v >= 6.5 ? "gruen" : v < 3.5 ? "rot" : "gelb";
const flagText = (f) => f.startsWith("fundamentaldaten_vom_")
  ? `Fundamentaldaten vom ${f.slice(21)} (heutiger Abruf fehlgeschlagen)`
  : FLAG_TEXT[f] || f.replace(/_/g, " ");
const isWarnFlag = (f) => f !== "waehrung_umgerechnet" && f !== "methoden_einig";

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
const LENS_KEYS = [["Quant-Faktoren", "Quant"], ["Erwartete Rendite", "Rendite"], ["Fairer Wert", "Fairer Wert"]];
const lensRow = (r) => { const l = r.lenses || {};
  return `<span class="amp" title="${LENS_KEYS.map(([k, t]) => `${t}: ${AMPEL_TXT[(l[k] || {}).ampel || "grau"]}`).join("\n")}">${LENS_KEYS.map(([k]) => AMPEL[(l[k] || {}).ampel || "grau"]).join("")}</span>${r.methods_agree ? ' <span class="tag zone">einig</span>' : ""}`; };
const erCell = (r) => { const er = V(r, "er"), h = V(r, "hurdle");
  return isNum(er) ? `<span class="${er >= h ? "pos" : er >= h - 0.03 ? "" : "neg"}">${F[1].format(er * 100)} %</span>` : dash; };
const UNC_RANK = { gering: 4, mittel: 3, hoch: 2, "sehr hoch": 1 };
const COLS = [
  { k: "star", t: "", l: true, nosort: true, sticky: true, r: (r) => `<button class="star ${WATCH.has(r.symbol) ? "on" : ""}" data-star="${esc(r.symbol)}" aria-label="Watchlist">★</button>` },
  { k: "symbol", t: "Aktie", l: true, sticky: true, r: (r) => `<div class="name"><b>${esc(r.symbol)}</b><small title="${esc(r.name)}">${esc(r.name)}</small></div>` },
  { k: "score", t: "Rating", r: (r) => scoreBadge(r.score) + delta(r.score_chg_1w) },
  { k: "price_score", t: "Bewertung", r: (r) => scoreBadge(r.price_score) },
  { k: "q_score", t: "Qualität", r: (r) => scoreBadge(r.q_score) },
  { k: "mom_score", t: "Momentum", r: (r) => scoreBadge(r.mom_score) },
  { k: "verdict", t: "Urteil", l: true, v: (r) => VERDICT_RANK[r.verdict_code] ?? -1, r: verdictHtml },
  { k: "lenses", t: "3 Methoden", l: true, v: (r) => (r.methods_agree ? 10 : 0) + Object.values(r.lenses || {}).filter((x) => x.ampel === "gruen").length, r: lensRow },
  { k: "price", t: "Kurs", n: true, r: (r) => money(r.price, r.currency) },
  { k: "er", t: "Erw. Rendite", n: true, v: (r) => V(r, "er"), r: erCell },
  { k: "hurdle", t: "Hürde", n: true, v: (r) => V(r, "hurdle"), r: (r) => pctPlain(V(r, "hurdle"), 0) },
  { k: "buy", t: "Kaufkurs", n: true, v: (r) => V(r, "buy_price"),
    r: (r) => V(r, "buy_out_of_reach") ? '<span class="small muted" title="Kaufkurs mehr als 50 % unter dem Kurs">außer Reichweite</span>' : money(V(r, "buy_price"), "") },
  { k: "to_buy", t: "Kurs vs. Kaufkurs", n: true, v: toBuyPrice,
    r: (r) => { const d = toBuyPrice(r); return !isNum(d) ? dash : d <= 0 ? '<span class="tag zone">IM KAUFBEREICH</span>' : `<span class="small">+${F[0].format(d * 100)} %</span>`; } },
  { k: "fv", t: "Fairer Wert", n: true, v: (r) => V(r, "fair_value"), r: (r) => money(V(r, "fair_value"), "") },
  { k: "unc", t: "Unsicherheit", l: true, v: (r) => UNC_RANK[V(r, "uncertainty")] || 0, r: (r) => `<span class="small">${esc(V(r, "uncertainty") || "—")}</span>` },
  { k: "ig", t: "Eingepreist", n: true, v: (r) => V(r, "implied_growth"), r: (r) => pctN(V(r, "implied_growth"), 0) },
  { k: "ampeln", t: "Q B W D E", l: true, v: (r) => AMPEL_KEYS.filter(([k]) => (r.ampeln || {})[k] === "gruen").length, r: ampelRow },
  { k: "peer_group", t: "Gruppe", l: true, r: (r) => `<span class="small">${esc(r.peer_group || r.sector || "—")}</span>` },
  { k: "roic_med5", t: "ROIC 5J", n: true, r: (r) => pctPlain(r.roic_med5) },
  { k: "f_score", t: "F-Score", n: true, r: (r) => isNum(r.f_score) ? String(r.f_score) : dash },
  { k: "op_margin", t: "Op. Marge", n: true, r: (r) => pctPlain(r.op_margin) },
  { k: "rev_cagr", t: "Umsatz 5J", n: true, r: (r) => pct(r.rev_cagr) },
  { k: "net_debt_ebitda", t: "Netto-Schulden/EBITDA", n: true, r: (r) => fmt(r.net_debt_ebitda, 1) },
  { k: "pe_fwd", t: "KGV fwd", n: true, r: (r) => fmt(r.pe_fwd) },
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
  { id: "einig", label: "★ Alle drei Methoden einig", f: (r) => !!r.methods_agree },
  { id: "kandidat", label: "Gute Aktien im Kaufbereich", f: (r) => r.verdict_code === "kandidat" },
  { id: "zweifel", label: "Günstig, aber Markt zweifelt", f: (r) => r.verdict_code === "beobachten" && /Markt zweifelt/.test(r.verdict || "") },
  { id: "nahe", label: "Gute Aktien ≤ 10 % über Kaufkurs", f: (r) => r.q_score >= 7 && isNum(toBuyPrice(r)) && toBuyPrice(r) > 0 && toBuyPrice(r) <= 0.10 },
  { id: "top", label: "Top-Qualität (≥ 8,5)", f: (r) => r.q_score >= 8.5 },
  { id: "guenstig", label: "Solide & günstig (Q ≥ 5, erw. Rendite ≥ 11 %)", f: (r) => r.q_score >= 5 && V(r, "er") >= 0.11 && V(r, "uncertainty") !== "sehr hoch" },
  { id: "teuer", label: "Gut, aber zu teuer – Kaufkurs merken", f: (r) => r.verdict_code === "beobachten_teuer" },
  { id: "compounder", label: "Compounder (ROIC, Wachstum, keine Verwässerung)", f: (r) => r.roic_med5 >= 0.15 && r.rev_cagr >= 0.08 && (r.share_cagr == null || r.share_cagr <= 0.005) && r.op_margin_std != null && r.op_margin_std < 0.05 },
  { id: "div", label: "Dividenden-Qualität", f: (r) => r.div_yield >= 0.03 && r.q_score >= 6 && (r.payout == null || r.payout < 0.8) },
  { id: "revs", label: "Positive Revisionen + Qualität", f: (r) => r.rev_eps_90d >= 0.03 && r.rev_breadth > 0 && r.q_score >= 7 },
  { id: "dip", label: "Qualität im Rücksetzer (unter SMA200)", f: (r) => r.q_score >= 7 && r.dist_sma200 < 0 },
  { id: "warn", label: "Warnsignale (Bilanz, Value-Falle, Zykliker)", f: (r) => (r.flags || []).some((f) => ["zyklik_spitzengewinn", "zyklik_normalisiert", "value_trap_risiko", "bilanz_warnsignal", "gewinnqualitaet_pruefen"].includes(f)) },
  { id: "fscore", label: "Fundamentale Verbesserung (F-Score ≥ 7, Q ≥ 6)", f: (r) => r.f_score >= 7 && r.q_score >= 6 },
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
  topPicks();
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
    ["Universum", m.universe, `${m.rows} mit Daten · ${rated.length} mit Rating`],
    ["Methoden einig", ROWS.filter((r) => r.methods_agree).length, "Quant, Rendite und fairer Wert grün", "einig"],
    ["Im Kaufbereich", cnt("kandidat"), "Qualität ≥ 7, Rendite ≥ Hürde, stabil", "kandidat"],
    ["Nahe Kaufbereich", near, "Qualität ≥ 7, ≤ 10 % über Kaufkurs", "nahe"],
    ["Gut, aber zu teuer", cnt("beobachten_teuer"), "Kaufkurs merken", "teuer"],
    ["SEC-geprüft", secAll ? `${secOk}/${secAll}` : "–", "US-Gewinn & EPS bestätigt"],
  ].map(([t, v, s, p]) => `<div class="kpi" ${p ? `data-preset="${p}"` : ""}><span>${t}</span><b>${v}</b><small>${s}</small></div>`).join("");
  document.querySelectorAll(".kpi[data-preset]").forEach((k) => k.onclick = () => setPreset(k.dataset.preset));
}

/* ---------- Interessant heute: kurze Liste ganz oben ---------- */
function topPicks() {
  const el = $("#top-picks");
  if (!el) return;
  const picks = ROWS.filter((r) => r.verdict_code === "kandidat").sort((a, b) => (b.score || 0) - (a.score || 0));
  const doubt = ROWS.filter((r) => r.verdict_code === "beobachten" && /Markt zweifelt/.test(r.verdict || "")).length;
  const row = (r) => `<tr data-s="${esc(r.symbol)}"><td class="l"><div class="name"><b>${esc(r.symbol)}</b><small>${esc(r.name)}</small></div></td>
      <td class="n">${scoreBadge(r.score)}</td><td class="n">${scoreBadge(r.q_score)}</td><td class="n">${erCell(r)}</td>
      <td class="n">${money(r.price, r.currency)}</td><td class="n">${money(V(r, "buy_price"), r.currency)}</td>
      <td class="l small">${esc(V(r, "uncertainty") || "—")}</td></tr>`;
  el.innerHTML = `<h3>Interessant heute · gute Unternehmen im Kaufbereich, Kurs oder Schätzungen stabil</h3>
    ${picks.length ? `<div class="table-wrap"><table class="mini picks"><thead><tr><th class="l">Aktie</th><th>Rating</th><th>Qualität</th><th>Erw. Rendite</th><th>Kurs</th><th>Kaufkurs</th><th class="l">Unsicherheit</th></tr></thead>
      <tbody>${picks.map(row).join("")}</tbody></table></div>` : '<p class="small muted">Heute erfüllt keine Aktie alle Bedingungen.</p>'}
    <p class="note">Kandidaten für die Einzelanalyse, keine Kaufempfehlung.${doubt ? ` Weitere ${doubt} Aktien sind rechnerisch günstig, aber der Markt zweifelt (Kurs schwach, keine steigenden Schätzungen) – Preset „Günstig, aber Markt zweifelt“.` : ""}</p>`;
  el.onclick = (e) => { const tr = e.target.closest("tr[data-s]"); if (tr) openDetail(tr.dataset.s); };
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
  $("#method-panel").innerHTML = `<h3>Methodik (Modell 4) · Ziel: gute Aktien zu einem interessanten Kaufkurs</h3>
    <p class="small">Das Modell verbindet die drei Ansätze professioneller Investoren: <b>Quant-Faktoren</b> (Value, Quality, Momentum: über Jahrzehnte belegt, u.a. Fama-French, Asness, Novy-Marx),
    <b>erwartete Rendite</b> (Frage eines Hedgefonds: „Was verdiene ich zu diesem Kurs?“) und <b>fairer Wert mit Sicherheitsmarge</b> (Morningstar-Logik).
    Grundlage sind geprüfte Jahresabschlüsse (SEC 10-K bzw. Yahoo), keine Analysten-Gewinnprognosen. Alle Skalen sind absolut, es gibt keine erzwungene Verteilung.</p>
    <h4>1 · Rating 1–10</h4>
    <p class="small"><b>40 % Bewertung + 35 % Qualität + 15 % Momentum + 10 % Gewinnrevisionen.</b> Danach harte Deckel, denn Schwächen lassen sich nicht durch einen billigen Kurs ausgleichen:
    Qualität &lt; 5 → höchstens 5 (&lt; 4 → höchstens 4) · finanzielle Schieflage → höchstens 4 · Gewinnqualität prüfen → höchstens 6 · erwartete Rendite unter 8 % → höchstens 6 · keine belastbare Bewertung → höchstens 6.</p>
    <ul class="small">
      <li><b>Bewertung</b> = 60 % erwartete Rendite (2 % → 0 · 5 % → 2 · 8 % → 4 · 10 % → 5,5 · 12 % → 7 · 15 % → 8,5 · ≥ 20 % → 10)
        + 20 % gegenüber der eigenen Bewertungshistorie (Owner-Earnings-Rendite heute ÷ Median 5 J.: 0,7 → 2 · 1,0 → 5 · ab 1,5 → 8,5; mehr zählt nicht, alte Hype-Bewertungen sind kein Maßstab)
        + 20 % gegenüber der Vergleichsgruppe (Perzentil von Owner-Earnings-Rendite, FCF-Rendite und EV/EBITDA).</li>
      <li><b>Momentum</b>: Kursentwicklung der letzten 12 Monate ohne den letzten Monat, Perzentil im Universum. Bremst „billige“ Aktien, die weiter fallen (Value-Falle).</li>
      <li><b>Revisionen</b>: Änderung der Konsens-Gewinnschätzung über 90 Tage (−10 % → 0 · 0 → 5 · +10 % → 10) und Saldo aus Anhebungen und Senkungen über 30 Tage.</li>
    </ul>
    <h4>2 · Qualität 0–10</h4>
    <table class="metrics">${Object.entries(Q_COMP_INFO).map(([k, i]) => `<tr><td>${k}</td><td class="l small" style="white-space:normal">${esc(i.how)}</td></tr>`).join("")}</table>
    <p class="small">Gewichte: Rentabilität 25 %, Bruttoprofitabilität 10 %, Margen 10 %, Stabilität 15 %, Gewinnqualität 10 %, Bilanz 10 %, Wachstum 10 %, F-Score 10 % (fehlende Bausteine werden herausgerechnet).
    Banken und Versicherer: ROE 45 %, Stabilität 30 %, Wachstum 25 %.
    Zu- und Abschläge: Verwässerung über 2 % bzw. 4 % p.a. (−0,7 / −1,5), Rückkäufe über 2 % (+0,3), Marge steigt bzw. fällt um mehr als 2 Pp. p.a. (+0,5 / −0,7), aktuell Verlust (−1).</p>
    <h4>3 · Erwartete Rendite (interner Zinsfuß)</h4>
    <ul class="small">
      <li><b>Ertragskraft je Aktie</b> = Owner Earnings = operativer Cashflow − Erhaltungsinvestitionen (min. aus Investitionen und Abschreibungen) − Aktienvergütung.
        Normalisiert über die <b>Median-Marge der letzten 5 Jahre</b> × Umsatz je Aktie. Einmalzahlungen wie Steuernachzahlungen oder Kaufpreis-Nachzahlungen verzerren so kein Jahr.
        Liegt das letzte Jahr über dem Median, zählt das Mittel; steigt die Marge strukturell (über 1 Pp. p.a.), das letzte Jahr. Zykliker: immer der Median.
        Banken: ROE (Median 5 J.) × Buchwert. REITs: Dividende.</li>
      <li><b>Wachstum</b> = Umsatz-CAGR (der niedrigere Wert aus 5 und bis zu 10 Jahren) und aktuelles Umsatzwachstum, der niedrigere Wert zählt doppelt, begrenzt auf −3 … +15 %.
        <b>Deckel durch die Gegenwart</b>: höchstens der höchste Wert aus aktuellem Umsatzwachstum, erwartetem Gewinnwachstum und Konsens-Umsatzwachstum fürs nächste Jahr. So überstimmt ein vergangener Boom keinen Wendepunkt.
        <b>Jahre 1 und 2</b>: Konsens-Umsatzwachstum für das laufende und das nächste Geschäftsjahr (ab 3 Analysten, begrenzt auf −15 … +25 %), nach oben wie nach unten. Ab Jahr 3 gilt wieder das Wachstum aus der Vergangenheit. Umsatzprognosen sind verlässlicher als Gewinnprognosen; das erwartete Gewinnwachstum wird Konsens gegen Konsens gerechnet (gleiche Abgrenzung), nicht Prognose gegen Ist-Gewinn.</li>
      <li><b>Wettbewerbsvorteil</b>: Das Wachstum gilt 5 Jahre und läuft dann linear auf 3 % aus, und zwar bis Jahr 15 bei Qualität ≥ 8, bis Jahr 10 bei ≥ 6,5, sonst ab Jahr 3 bis Jahr 7. Danach gelten 3 % dauerhaft.
        So macht es auch Morningstar: Je breiter der Burggraben, desto länger halten Überrenditen.
        <b>Markt zweifelt</b>: Liegt das eingepreiste Wachstum mehr als 8 Pp. unter der Modellannahme, wird die Periode um eine Stufe verkürzt (15 → 10 → 7 Jahre) und die Unsicherheit steigt.</li>
      <li><b>Wachstum kostet Kapital</b> (Werttreiber-Formel aus McKinsey „Valuation“): Ausschüttbar ist nur Ertragskraft × (1 − Wachstum ÷ ROIC).
        Als ROIC gilt der ROIC mit Goodwill, Median 5 J., begrenzt auf 6–40 % (Wachstum über Zukäufe kostet Goodwill). Bei negativem Kapital trotz Gewinn (Rückkäufe) wird ein sehr hoher ROIC angesetzt.</li>
      <li><b>Erwartete Rendite</b> = der Zinssatz, bei dem der Barwert dieser Zahlungen genau dem Kurs entspricht. Das ist die Rendite p.a., die ein Käufer zum heutigen Kurs erhält, wenn die Annahmen eintreffen.</li>
      <li><b>Reverse-DCF</b>: welches Wachstum (J. 1–5) der Kurs bei den Eigenkapitalkosten einpreist, zum Vergleich mit dem bisher gelieferten.</li>
      <li><b>Hürde und Kaufkurs</b>: Hürde = Eigenkapitalkosten + 2 Pp. Das Risiko steckt schon in den Eigenkapitalkosten, es wird nicht ein zweites Mal aufgeschlagen. Der Kaufkurs ist der Kurs, bei dem die erwartete Rendite die Hürde erreicht. Liegt er mehr als 50 % unter dem Kurs, steht dort „außer Reichweite“.</li>
      <li><b>Szenarien</b>: Bär = Schrumpfung (Wachstum höchstens −2 %, Ertragskraft −25 %, Wettbewerbsvorteil nur bis Jahr 7) · Bulle = Wachstum +3 Pp., Ertragskraft +10 %.</li>
    </ul>
    <h4>4 · Fairer Wert und Unsicherheit (Morningstar-Logik)</h4>
    <p class="small">Fairer Wert = 75 % DCF zu den Eigenkapitalkosten + 25 % eigene Bewertungshistorie (Ertragskraft ÷ Median-Owner-Earnings-Rendite der letzten 5 Jahre, höchstens das 1,5-Fache der heutigen Bewertung).
    <b>Unsicherheit</b> gering / mittel / hoch / sehr hoch, aus Punkten für schwankende Margen, Verlustjahre, Zyklik, kurze Historie, widersprüchliches Wachstum, hohe Verschuldung, Bank/REIT,
    Streuung der Methoden, Zweifel des Marktes (eingepreistes Wachstum weit unter der Annahme) und einen Kurs weit unter dem Rechenwert (dann preist der Markt meist ein Risiko ein, das die Zahlen nicht zeigen). Sie bestimmt die Eigenkapitalkosten (8 / 9 / 10 / 11 %, Banken mind. 10 %, REITs 8,5 %)
    und die nötige Sicherheitsmarge (15 / 25 / 35 / 50 %). Über +150 % zum Kurs bzw. ab 40 % erwarteter Rendite wird nicht bewertet, das ist fast immer ein Datenfehler.</p>
    <h4>5 · Bilanz-Forensik</h4>
    <ul class="small">
      <li><b>Piotroski F-Score</b> (0–9): Gewinn und Cashflow positiv und steigend, Cashflow über Gewinn, weniger Schulden, mehr Liquidität, keine neuen Aktien, steigende Bruttomarge und steigender Kapitalumschlag.</li>
      <li><b>Altman Z''</b> (Insolvenzrisiko, Fassung ohne Börsenwert), <b>Beneish M-Score</b> (Hinweis auf Bilanzkosmetik) und <b>Accruals</b> nach Sloan (Gewinn ohne Cash).</li>
      <li><b>Finanzielle Schieflage</b> (Rating max. 4): Altman &lt; 1,1 <i>und</i> Verlust oder Verschuldung &gt; 4× EBITDA bei F-Score ≤ 4. Versorger und Immobilien sind ausgenommen,
        denn ihre regulierten, kapitalintensiven Bilanzen liegen fast immer unter 1,1. Firmen mit negativem Eigenkapital durch Rückkäufe fallen ohne zweiten Beleg ebenfalls nicht darunter.</li>
      <li><b>Gewinnqualität prüfen</b> (Rating max. 6, kein „Kandidat“): Beneish &gt; −1,78 <i>und</i> Accruals &gt; 5 %, oder Accruals &gt; 10 % allein.
        Bei schnellem Wachstum oder Sondergewinnen (Abspaltungen, Beteiligungsgewinne) ist das oft ein Fehlalarm. Deshalb ist es ein Prüfauftrag, kein Ausschluss.</li>
    </ul>
    <h4>6 · Drei Methoden als Gegenprobe</h4>
    <ul class="small">
      <li><b>Quant-Faktoren</b>: Mittel der Perzentile für Value (in der Vergleichsgruppe), Quality und Momentum (im Universum). Grün ab 70, gelb ab 40.</li>
      <li><b>Erwartete Rendite</b>: grün ab der Hürde, gelb bis 3 Pp. darunter.</li>
      <li><b>Fairer Wert</b>: grün, wenn der Abschlag zum fairen Wert die nötige Sicherheitsmarge erreicht; gelb, wenn der Kurs unter dem fairen Wert liegt.</li>
      <li><b>Methoden einig</b> = alle drei grün, Qualität ≥ 7 und keine Bilanz-Warnung: die kürzeste und belastbarste Liste des Screeners.</li>
    </ul>
    <h4>7 · Urteil</h4>
    <ul class="small">
      <li><b>Gutes Unternehmen im Kaufbereich</b>: Qualität ≥ 7, Kurs ≤ Kaufkurs, keine Bilanz-Warnung, Unsicherheit nicht „sehr hoch“ <b>und stabil</b>: Momentum nicht im unteren Drittel des Universums oder steigende Gewinnschätzungen (Revisionen ≥ 6). Ein Kandidat bleibt Kandidat, bis der Kurs mehr als 5 % über dem Kaufkurs liegt.</li>
      <li><b>Günstig, aber Markt zweifelt</b>: wie oben, aber Kurs schwach und keine steigenden Schätzungen. Rechnerisch billige Aktien, die weiter fallen, sind die häufigste Value-Falle. Erst die Stabilisierung abwarten.</li>
      <li><b>Mehrere Aktiengattungen</b> (z. B. FOX/FOXA): Kandidat ist nur die größte Gattung, die übrigen verweisen darauf.</li>
      <li><b>Nahe Kaufbereich</b>: Kurs höchstens 10 % über dem Kaufkurs. <b>Auf Kaufkurs warten</b>: darüber, der Kaufkurs steht dabei.</li>
      <li><b>Solide Qualität</b> (5–7): günstig (Kurs ≤ Kaufkurs), fair (erwartete Rendite ≥ 8 %) oder zu teuer. <b>Schwache Qualität</b> (&lt; 5): meiden; bei niedrigem Kurs mit dem Hinweis „Value-Falle möglich“.</li>
      <li>Chart (Trend, Buy-Zonen) und Analysten-Kursziele fließen <b>nicht</b> ins Rating ein. Sie dienen der Einordnung und dem Timing.</li>
    </ul>
    <h4>Daten und Grenzen</h4>
    <ul class="small">
      <li>[IST] veröffentlichte Zahl · [BERECHNET] eigene Rechnung · [SCHÄTZUNG] Konsens oder Annahme · [UNBEKANNT] · [NICHT ANWENDBAR]. Kein Wert wird erfunden oder aufgefüllt.</li>
      <li>US-Werte: bis 10 Jahre aus den SEC-10-K-Berichten, Gewinn und EPS gegen den 10-K geprüft. Übrige: 4 Jahre aus Yahoo. Splits, Aktiengattungen und Einheitenfehler werden bereinigt.</li>
      <li>Zukunftsaussichten jenseits der Konsensschätzungen (Disruption, Regulierung, Management, Guidance) sieht das Modell nicht. Sie sind Pflichtpunkte im Einzelanalyse-Prompt.</li>
      <li>Empfindlichkeit: 1 Pp. mehr Eigenkapitalkosten oder 2 Pp. weniger Wachstum senken den fairen Wert im Median um etwa 6–7 %. Disruption, Klagen und Managementfehler sieht kein Modell. Dafür gibt es die Einzelanalyse.</li>
      <li>Kein Rückrechnungs-Backtest: Mit kostenlosen Daten fehlen frühere Abschlüsse zum damaligen Stand, und heute stehen nur die überlebenden Firmen im Index. Die Gewichte stützen sich auf die veröffentlichte Forschung; geprüft wird vorwärts in der Erfolgskontrolle.</li>
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
    ["Rating", (x) => scoreBadge(x.score)], ["Bewertung", (x) => scoreBadge(x.price_score)], ["Qualität", (x) => scoreBadge(x.q_score)],
    ["Momentum", (x) => scoreBadge(x.mom_score)],
    ["Erwartete Rendite / Hürde", (x) => isNum(V(x, "er")) ? `${erCell(x)} <span class="small muted">/ ${pctPlain(V(x, "hurdle"), 0)}</span>` : dash],
    ["Kaufkurs", (x) => money(V(x, "buy_price"), x.currency)],
    ["Eingepreistes Wachstum", (x) => pctN(V(x, "implied_growth"), 0)],
    ["3 Methoden", (x) => lensRow(x)], ["Ampeln Q B W D E", (x) => ampelRow(x)],
    ["Urteil", (x) => `<span class="small peer-verdict">${esc(x.verdict)}</span>`],
    ["KGV fwd", (x) => fmt(x.pe_fwd)], ["KGV normalisiert", (x) => fmt(x.pe_norm)], ["KGV vs. eigener 5J-Median", (x) => pctN(x.pe_vs_hist, 0)],
    ["EV/EBITDA", (x) => fmt(x.ev_ebitda)], ["FCF-Rendite", (x) => pctPlain(x.fcf_yield)],
    ["F-Score", (x) => isNum(x.f_score) ? String(x.f_score) : dash], ["ROIC 5J", (x) => pctPlain(x.roic_med5)],
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

  const L = r.lenses || {};
  const lq = L["Quant-Faktoren"] || {}, le = L["Erwartete Rendite"] || {}, lf = L["Fairer Wert"] || {};
  const fac = lq.factors || {};
  const igTxt = isNum(v.implied_growth) && isNum(v.growth_hist)
    ? (v.implied_growth > v.growth_hist + 0.03 ? "Der Kurs verlangt deutlich mehr Wachstum als bisher geliefert"
      : v.implied_growth < v.growth_hist - 0.03 ? "Der Kurs verlangt weniger Wachstum als bisher geliefert" : "Eingepreist ist etwa das bisherige Wachstum") : "";
  const lensHtml = `<div class="lenses">
      <div class="lens"><b>${AMPEL[lq.ampel || "grau"]} Quant-Faktoren</b>
        <span class="small">Rang im Universum: Value ${isNum(fac.Value) ? fac.Value : "–"} · Quality ${isNum(fac.Quality) ? fac.Quality : "–"} · Momentum ${isNum(fac.Momentum) ? fac.Momentum : "–"} (Perzentil, Ø ${isNum(lq.composite) ? lq.composite : "–"}; grün ab 70)</span></div>
      <div class="lens"><b>${AMPEL[le.ampel || "grau"]} Erwartete Rendite</b>
        <span class="small">${isNum(le.er) ? `${pctPlain(le.er)} p.a. zum heutigen Kurs, Hürde ${pctPlain(le.hurdle, 0)}` : "nicht berechenbar"}</span></div>
      <div class="lens"><b>${AMPEL[lf.ampel || "grau"]} Fairer Wert mit Sicherheitsmarge</b>
        <span class="small">${isNum(lf.discount) ? `Abschlag zum fairen Wert ${pctN(lf.discount, 0)} · nötig ${pctPlain(lf.mos, 0)} (Unsicherheit ${esc(lf.uncertainty)})` : "nicht berechenbar"}</span></div>
      <div class="note">${r.methods_agree ? "✓ <b>Alle drei Methoden einig</b> – stärkstes Signal des Screeners." : "Je mehr unabhängige Methoden grün sind, desto belastbarer das Signal. Widersprechen sie sich, liegt der Grund meist außerhalb der Zahlen."}</div>
    </div>`;
  const vp = r.v_parts || {};
  const ratingHtml = `<table class="metrics">
      ${[["Bewertung", r.price_score, "40 %"], ["Qualität", r.q_score, "35 %"], ["Momentum", r.mom_score, "15 %"], ["Revisionen", r.rev_score, "10 %"]]
        .map(([k, x, w]) => `<tr><td>${k} <span class="muted small">${w}</span></td><td class="n">${scoreBadge(x)}</td></tr>`).join("")}
      <tr><td colspan="2" class="l small muted" style="white-space:normal">Bewertung = 60 % erwartete Rendite (${fmt(vp["Erwartete Rendite"])}) · 20 % vs. eigene Historie (${fmt(vp["vs. eigene Historie"])}) · 20 % vs. Vergleichsgruppe (${fmt(vp["vs. Vergleichsgruppe"])})</td></tr>
    </table>${(r.score_caps || []).length ? `<div class="flag-list">Rating gedeckelt: ${esc(r.score_caps.join(", "))}</div>` : ""}`;
  const sc = v.scenarios || {};
  const decision = isNum(v.er) ? `
      <dl class="kv big-kv">
        <dt>Kurs</dt><dd>${money(r.price, r.currency)}</dd>
        <dt>Erwartete Rendite</dt><dd><b>${pctPlain(v.er)} p.a.</b> <span class="muted small">(Hürde ${pctPlain(v.hurdle, 0)} · Bär/Schrumpfung ${pctPlain(sc.bear && sc.bear.er)} · Bulle ${pctPlain(sc.bull && sc.bull.er)})</span></dd>
        <dt>Kaufkurs</dt><dd><b>≤ ${money(v.buy_price, r.currency)}</b> <span class="muted small">(${v.buy_out_of_reach ? "außer Reichweite: mehr als 50 % unter dem Kurs" : "dort erreicht die Rendite die Hürde"})</span></dd>
        <dt>Abstand zum Kaufkurs</dt><dd>${toBuy <= 0 ? '<span class="ok-line" style="display:inline">● im Kaufbereich</span>' : `Kurs liegt ${pctPlain(toBuy, 0)} darüber`}</dd>
        <dt>Angenommenes Wachstum</dt><dd>${v.growth_near ? `Jahr 1 ${pctN(v.growth_near[0])} · Jahr 2 ${pctN(v.growth_near[1])} <span class="muted small">(Konsens)</span> · danach ` : ""}${pctN(v.growth)} <span class="muted small">(Ø Jahre 1–5 ${pctN(v.growth_5y)})</span></dd>
        <dt>Eingepreistes Wachstum</dt><dd>${isNum(v.implied_growth) ? `${pctN(v.implied_growth)} p.a. (J. 1–5) · geliefert ${pctN(v.growth_hist)}` : '<span class="muted">nicht sinnvoll (ROIC ≤ Kapitalkosten oder fehlend)</span>'}</dd>
        <dt>Fairer Wert</dt><dd>${money(v.fair_value, r.currency)} <span class="muted small">(${pctN(v.upside, 0)} · Spanne ${money(sc.bear && sc.bear.value, "")} – ${money(sc.bull && sc.bull.value, "")})</span></dd>
        <dt>Unsicherheit</dt><dd>${esc(v.uncertainty)} <span class="muted small">→ Eigenkapitalkosten ${pctPlain(v.coe, 0)}, nötige Sicherheitsmarge ${pctPlain(v.mos_required, 0)}</span></dd>
      </dl>
      ${igTxt ? `<div class="note">Reverse-DCF: ${igTxt}.</div>` : ""}
      ${v.market_doubt ? `<div class="flag-list">Markt zweifelt: Der Kurs preist deutlich weniger Wachstum ein als das Modell. Deshalb gilt der Wettbewerbsvorteil nur bis Jahr ${v.cap_year}, und die Unsicherheit ist höher.</div>` : ""}
      ${(v.uncertainty_why || []).length ? `<div class="note">Unsicherheit durch: ${esc(v.uncertainty_why.join(" · "))}</div>` : ""}
      <h4>Drei Profi-Methoden</h4>
      ${lensHtml}
      <h4>Rating ${scoreBadge(r.score)}</h4>
      ${ratingHtml}
      <h4>Herleitung [BERECHNET aus IST-Zahlen und Annahmen]</h4>
      <table class="metrics">
        <tr><td>Ertragskraft je Aktie</td><td class="n">${money(v.cf0, r.currency)}</td></tr>
        <tr><td colspan="2" class="l small muted" style="white-space:normal">${esc(v.cf0_src)}</td></tr>
        <tr><td>Wachstum J. 1–5 · Auslaufen bis Jahr</td><td class="n">${pctPlain(v.growth)} · ${v.cap_year}</td></tr>
        <tr><td>Rendite auf Reinvestition</td><td class="n">${pctPlain(v.roic, 0)}</td></tr>
        <tr><td colspan="2" class="l small muted" style="white-space:normal">${esc(v.roic_src || "")}</td></tr>
        ${v.methods.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${money(x.value, r.currency)}</td></tr>
        <tr><td colspan="2" class="l small muted" style="white-space:normal">${esc(x.detail)}</td></tr>`).join("")}
      </table>
      <h4>Kursziele</h4>
      <table class="metrics">
        <tr><td></td><td class="n muted small">Bewertung bleibt</td><td class="n muted small">bei fairem Wert</td></tr>
        ${[1, 2, 3].map((n) => { const k = (v.keep || [])[n - 1], f = v["y" + n];
          return `<tr><td>${n} Jahr${n > 1 ? "e" : ""}</td><td class="n">${money(k, "")} <span class="small">${pctN(k / r.price - 1, 0)}</span></td><td class="n">${money(f, "")} <span class="small">${pctN(f / r.price - 1, 0)}</span></td></tr>`; }).join("")}
      </table>
      <div class="note">„Bewertung bleibt“: Der Kurs wächst mit der Ertragskraft, der Markt verlangt weiter ${pctPlain(v.er)} Rendite. „Bei fairem Wert“: Der Markt bewertet zu den Eigenkapitalkosten (${pctPlain(v.coe, 0)}).
        Dazu kommen Ausschüttungen von etwa ${money(v.dist3, r.currency)} je Aktie über 3 Jahre. Modell, keine Prognose; der Bear-Fall ist keine Verlustgrenze.</div>`
    : `<div class="note">${esc(v.reason || "Keine Bewertung möglich.")}</div><h4>Rating ${scoreBadge(r.score)}</h4>${ratingHtml}`;
  const fz = r.f_score_tests || [];
  const forensic = r.is_financial || r.is_reit ? '<div class="note">Für Banken, Versicherer und REITs nicht anwendbar (andere Bilanzlogik).</div>' : `
      <dl class="kv">
        <dt>Piotroski F-Score</dt><dd>${isNum(r.f_score) ? `<b>${r.f_score}</b> / 9` : dash}</dd>
        <dt>Altman Z''</dt><dd>${fmt(r.altman_z2, 2)} <span class="muted small">(&lt; 1,1 Gefahr · &gt; 2,6 sicher)</span></dd>
        <dt>Beneish M-Score</dt><dd>${fmt(r.beneish_m, 2)} <span class="muted small">(&gt; −1,78 auffällig)</span></dd>
        <dt>Accruals (Sloan)</dt><dd>${pctN(r.accruals)} <span class="muted small">(Gewinn − Cashflow, je Bilanzsumme)</span></dd>
      </dl>
      ${fz.length ? `<details class="summary"><summary>F-Score: die 9 Prüfungen</summary><ul class="small" style="margin:4px 0;padding-left:18px">${fz.map(([t3, ok]) => `<li>${ok === true ? "✓" : ok === false ? "✗" : "–"} ${esc(t3)}</li>`).join("")}</ul></details>` : ""}
      ${(r.warn_why || []).map((w) => `<div class="flag-list">⚠ ${esc(w)}</div>`).join("")}`;

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
          <div><span>Rating</span>${scoreBadge(r.score, true)}</div>
          <div><span>Bewertung</span>${scoreBadge(r.price_score)}</div>
          <div><span>Qualität</span>${scoreBadge(r.q_score)}</div>
          <div><span>Momentum</span>${scoreBadge(r.mom_score)}</div>
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
        <h4>Bilanz-Forensik [BERECHNET aus IST, letztes GJ gegen Vorjahr]</h4>
        ${forensic}
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
        <h4>Gewinnrevisionen [SCHÄTZUNG] · Score ${scoreBadge(r.rev_score)}</h4>
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
    + peers.map((x) => `- ${x.name} (${x.symbol}): Rating ${x.score ?? "n/a"}, erw. Rendite ${p(V(x, "er"))}, KGV fwd ${f(x.pe_fwd)}, EV/EBITDA ${f(x.ev_ebitda)}, ROIC 5J ${p(x.roic_med5)}, Umsatz-CAGR 5J ${p(x.rev_cagr)}, Urteil ${x.verdict}`).join("\n") + "\n";
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
- Screener: Rating ${r.score ?? "n/a"} (Bewertung ${r.price_score ?? "n/a"}, Qualität ${r.q_score ?? "n/a"}, Momentum ${r.mom_score ?? "n/a"}, Revisionen ${r.rev_score ?? "n/a"}) · Urteil: ${r.verdict}
- Erwartete Rendite ${p1(V(r, "er"))} p.a. (Hürde ${p1(V(r, "hurdle"))}), Kaufkurs ${isNum(V(r, "buy_price")) ? "≤ " + V(r, "buy_price").toFixed(2) + " " + r.currency : "n/a"}, eingepreistes Wachstum ${p1(V(r, "implied_growth"))} vs. geliefert ${p1(V(r, "growth_hist"))}, fairer Wert ${isNum(V(r, "fair_value")) ? V(r, "fair_value").toFixed(2) : "n/a"} (Unsicherheit ${V(r, "uncertainty") || "n/a"})
- Drei Methoden: ${LENS_KEYS.map(([k, t]) => `${t} ${AMPEL[((r.lenses || {})[k] || {}).ampel || "grau"]}`).join(", ")} · F-Score ${r.f_score ?? "n/a"}, Altman Z'' ${f2(r.altman_z2, 2)}, Beneish ${f2(r.beneish_m, 2)}, Accruals ${p1(r.accruals)}
- Ampeln: Qualität ${AMPEL[a["Qualität"] || "grau"]}, Bewertung ${AMPEL[a["Bewertung"] || "grau"]}, Wachstum ${AMPEL[a["Wachstum"] || "grau"]}, Daten ${AMPEL[a["Daten"] || "grau"]}, Einstieg ${AMPEL[a["Einstieg"] || "grau"]}
- KGV ttm ${f2(r.pe_ttm)}, KGV fwd ${f2(r.pe_fwd)}, EV/EBITDA ${f2(r.ev_ebitda)}, FCF-Rendite ${p1(r.fcf_yield)}, ROE ${p1(r.roe)}, op. Marge ${p1(r.op_margin)}, Umsatzwachstum ${p1(r.rev_growth)}
- ROIC 5J ${p1(r.roic_med5)}, Umsatz-CAGR 5J ${p1(r.rev_cagr)} (10J ${p1(r.rev_cagr_long)}), Aktienzahl p.a. ${p1(r.share_cagr)}, KGV vs. 5J-Median ${p1(r.pe_vs_hist)}
- EPS-Revision 90 Tage ${p1(r.rev_eps_90d)} · Konsens-Umsatzwachstum laufendes GJ ${p1(r.rev_growth_cy)}, nächstes GJ ${p1(r.rev_growth_ny)} · Konsens-Gewinnwachstum ${p1(r.eps_growth_fwd)} · nächster Termin ${r.earnings_date || "unbekannt"}
- KGV normalisiert ${f2(r.pe_norm)} · Vergleichsgruppe ${r.peer_group || r.sector || "?"}
- Trend: ${r.trend} · Buy-Zonen laut Screener: ${z}
- Prüfhinweise des Screeners: ${hints}
${histPrompt(r)}${peerPrompt(r)}
Bitte prüfe insbesondere: Ist die Mehrjahresentwicklung nachhaltig, was ist im Kurs eingepreist, und wie schneidet die Aktie gegen die genannten Wettbewerber ab?

Pflichtpunkte Zukunftsaussichten (sieht das Zahlenmodell nicht, bitte jeweils mit Quelle und Datum):
1. Disruption: Bedrohen neue Technologien (z. B. KI), neue Anbieter oder Preiskampf das Kerngeschäft? Was spricht dagegen?
2. Regulierung und Recht: laufende Verfahren, Untersuchungen, Preis- oder Erstattungsregeln, Zölle, Sanktionen.
3. Management und Kapitalallokation: Wechsel an der Spitze, Übernahmen, Rückkäufe, Vergütung, Bilanzpolitik.
4. Ausblick des Unternehmens: aktuelle Guidance, Auftragsbestand, Pipeline, Trend der Schätzrevisionen – und wie realistisch sind die Konsensschätzungen?
5. Markt und Branche: Wachstum des adressierbaren Markts, Zyklusphase, Marktanteil.
6. Was müsste passieren, damit die Investmentthese scheitert? Leite daraus ein konkretes Ausstiegskriterium ab.`;
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
