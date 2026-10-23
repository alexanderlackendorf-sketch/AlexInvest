"""Rating 1-10 und Ampeln nach den Regeln des Projekts "Aktienanalyse".

Getrennt beurteilt werden (Abschnitt 1/5 der Analyse-Anweisungen):
  - Unternehmensqualität   (Säule Qualität)
  - Bewertung              (Säule Bewertung)
  - Wachstum               (Säule Wachstum)
  - Datenqualität          (Abdeckung, Plausibilitäts- und SEC-Prüfung)
  - Einstieg               (Chart: Trend, Buy-Zone) – NICHT im Score
Urteile: Kandidat für Einzelanalyse / Beobachten / Beobachten – gutes Unternehmen, zu teuer /
Kein Vorteil erkennbar / Meiden – zu teuer / Meiden – wirtschaftlich schwach / Meiden /
Nicht ausreichend beurteilbar. Ein Screener spricht kein "Kaufen" aus.
Analystenziele fließen nicht in den Score ein, sie dienen nur zum Vergleich.

Score = gewichtetes Mittel der Säulen Qualität/Bewertung/Wachstum, jede Kennzahl als Perzentil
innerhalb ihres Sektors (keine universellen Schwellen), über das Universum auf 1..10 skaliert.
Eine rote Ampel wird nicht durch andere Stärken überstimmt: Qualität rot -> Score max. 4,
Bewertung rot -> max. 6, Value-Trap-Risiko -> max. 6, unzureichende Daten -> kein Score.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from . import quality, valuation

# (Kennzahl, höher_ist_besser)
PILLARS: dict[str, dict] = {
    "Qualität": {"weight": 0.35, "in_score": True, "metrics": [
        ("roic_med5", True), ("roe", True), ("op_margin", True), ("gross_margin", True), ("fcf_margin", True),
        ("net_debt_ebitda", False), ("roa_fin", True), ("op_margin_std", False), ("op_margin_trend", True),
        ("cash_conversion", True),
        ("share_cagr", False),
    ]},
    "Bewertung": {"weight": 0.30, "in_score": True, "metrics": [
        ("pe_fwd", False), ("pe_ttm", False), ("ev_ebitda", False), ("fcf_yield", True), ("peg", False),
        ("pb_fin", False), ("pe_vs_hist", False), ("implied_growth", False), ("pe_norm", False),
    ]},
    "Wachstum": {"weight": 0.25, "in_score": True, "metrics": [
        ("rev_growth", True), ("earn_growth", True), ("eps_growth_fwd", True), ("rev_cagr", True), ("eps_cagr", True),
    ]},
    "Revisionen": {"weight": 0.10, "in_score": True, "metrics": [
        ("rev_eps_90d", True), ("rev_breadth", True),
    ]},
    "Trend": {"weight": 0.0, "in_score": False, "metrics": [
        ("mom_12_1", True), ("ret_3m", True), ("dist_sma200", True),
    ]},
    "Analysten": {"weight": 0.0, "in_score": False, "metrics": [
        ("analyst_upside", True), ("analyst_rec", False),
    ]},
}
# Zusatzkennzahlen aus Historie/Revisionen: fehlen oft bei Nicht-US-Werten -> zählen nicht in die
# Datenabdeckung (sonst würden Auslandswerte systematisch "nicht beurteilbar")
OPTIONAL = {"op_margin_trend", "pe_norm", "roic_med5", "op_margin_std", "cash_conversion", "share_cagr", "pe_vs_hist", "implied_growth",
            "rev_cagr", "eps_cagr", "rev_eps_90d", "rev_breadth"}
SCORE_PILLARS = [n for n, p in PILLARS.items() if p["in_score"]]
LABELS = {"pe_fwd": "KGV (fwd)", "pe_ttm": "KGV (ttm)", "ev_ebitda": "EV/EBITDA", "fcf_yield": "FCF-Rendite",
          "peg": "PEG", "pb_fin": "KBV (Finanzwerte/Immobilien)", "roe": "Eigenkapitalrendite",
          "op_margin": "Operative Marge", "gross_margin": "Bruttomarge", "fcf_margin": "FCF-Marge",
          "net_debt_ebitda": "Nettoverschuldung/EBITDA", "roa_fin": "Gesamtkapitalrendite (Finanzwerte)",
          "rev_growth": "Umsatzwachstum", "earn_growth": "Gewinnwachstum", "eps_growth_fwd": "EPS-Wachstum erw.",
          "mom_12_1": "Momentum 12-1M", "ret_3m": "Performance 3M", "dist_sma200": "Abstand SMA200",
          "analyst_upside": "Analysten-Upside", "analyst_rec": "Analysten-Empfehlung",
          "roic_med5": "ROIC (Median 5J)", "op_margin_std": "Margen-Schwankung um den Trend 5J", "op_margin_trend": "Margen-Trend 5J (Pp. p.a.)", "cash_conversion": "Cash Conversion 5J",
          "share_cagr": "Aktienzahl-Veränderung p.a.", "pe_vs_hist": "KGV vs. eigener 5J-Median",
          "implied_growth": "Eingepreistes FCF-Wachstum (Reverse-DCF)", "rev_cagr": "Umsatz-CAGR 5J",
          "eps_cagr": "EPS-CAGR 5J", "pe_norm": "KGV auf normalisierten Gewinn (Median-Marge 5J)", "rev_eps_90d": "EPS-Revision 90 Tage", "rev_breadth": "Revisions-Saldo 30 Tage"}
MIN_SECTOR_N = 10
MIN_GROUP_N = 8
# Branchengruppen: feiner als Sektoren, damit z.B. Software nicht mit Halbleitern verglichen wird.
# Reihenfolge zählt (erster Treffer im Yahoo-Branchennamen gewinnt); sonst Vergleich im Sektor.
PEER_GROUPS = [
    ("Halbleiter", ("semiconductor",)),
    ("Software & IT-Dienste", ("software", "information technology services")),
    ("Hardware & Elektronik", ("consumer electronics", "computer hardware", "communication equipment",
                               "electronic components", "scientific & technical", "electronics & computer")),
    ("Internet & Medien", ("internet content", "internet retail", "entertainment", "advertising", "publishing",
                           "broadcasting", "electronic gaming")),
    ("Pharma & Biotech", ("drug manufacturers", "biotechnology")),
    ("Medizintechnik & Diagnostik", ("medical devices", "medical instruments", "diagnostics", "medical distribution")),
    ("Gesundheitsdienste", ("healthcare plans", "medical care", "health information")),
    ("Banken", ("banks",)),
    ("Versicherer", ("insurance",)),
    ("Asset Manager & Börsen", ("asset management", "capital markets", "financial data")),
    ("Zahlungsverkehr & Kredit", ("credit services", "financial conglomerates")),
    ("Öl & Gas", ("oil & gas",)),
    ("Versorger", ("utilities",)),
    ("Luftfahrt & Verteidigung", ("aerospace & defense",)),
    ("Industriemaschinen & Ausrüstung", ("specialty industrial machinery", "electrical equipment", "farm & heavy",
                                         "industrial distribution", "tools & accessories")),
    ("Transport & Logistik", ("railroads", "trucking", "integrated freight", "airlines", "marine shipping")),
    ("Konsum & Marken", ("apparel", "footwear", "luxury goods", "leisure", "household & personal", "packaged foods",
                         "beverages", "confectioners", "tobacco")),
    ("Handel", ("discount stores", "specialty retail", "home improvement retail", "department stores",
                "grocery stores", "auto parts")),
    ("Chemie & Materialien", ("chemicals", "specialty chemicals", "building materials", "packaging")),
]
MIN_COVERAGE = 0.6

# Ampelgrenzen auf Säulenwerte (0-10 = mittleres Sektor-Perzentil)
GREEN, RED = 6.5, 3.5

# Zyklische Branchen: hohe Gewinne können Zyklushochs sein (Abschnitt 7 "Zykliker/Rohstoffe")
CYCLICAL_SECTORS = {"Energy", "Basic Materials"}
CYCLICAL_INDUSTRY_KEYWORDS = ("semiconductor", "auto", "steel", "chemical", "airline", "shipping", "oil",
                              "gold", "copper", "aluminum", "metal", "mining", "agricultural inputs",
                              "building materials", "lumber", "homebuilding", "residential construction",
                              "trucking", "computer hardware")
CYCLE_DROP = -0.15
WARN_FLAG_EXCLUDE = {"waehrung_umgerechnet", "zyklik_normalisiert", "zahlen_in_kuerze", "split_nach_bericht_bereinigt"}


def ampel(v) -> str:
    if v is None or v != v:
        return "grau"
    return "gruen" if v >= GREEN else "rot" if v < RED else "gelb"


def is_cyclical(sector, industry) -> bool:
    ind = industry.lower() if isinstance(industry, str) else ""
    return sector in CYCLICAL_SECTORS or any(k in ind for k in CYCLICAL_INDUSTRY_KEYWORDS)


def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    fin = df["is_financial"].fillna(False).astype(bool)
    reit = df.get("is_reit", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    df["pb_fin"] = df["pb"].where(fin | reit)
    df["roa_fin"] = df["roa"].where(fin)
    # Verlustbringer: KGV existiert nicht -> schlechtestes Perzentil statt "fehlt" (sonst würden sie bevorzugt)
    df["_loss"] = df["loss_making"].fillna(False).astype(bool)
    return df


_OVERRIDES_FILE = Path(__file__).resolve().parent.parent / "config" / "peer_overrides.json"


def _load_overrides() -> dict[str, str]:
    try:
        cfg = json.loads(_OVERRIDES_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return {sym: grp for grp, syms in cfg.items() if not grp.startswith("_") for sym in syms}


PEER_OVERRIDES = _load_overrides()


def peer_group(sector, industry, symbol: str | None = None) -> str | None:
    if symbol in PEER_OVERRIDES:
        return PEER_OVERRIDES[symbol]
    ind = industry.lower() if isinstance(industry, str) else ""
    for name, keys in PEER_GROUPS:
        if any(k in ind for k in keys):
            return name
    return sector if isinstance(sector, str) else None


def _pct(series: pd.Series, levels: list[tuple[pd.Series, int]], higher_better: bool) -> pd.Series:
    """Perzentil im feinsten Vergleichskreis mit genug Werten: Branchengruppe -> Sektor -> Universum."""
    out = series.rank(pct=True, ascending=higher_better)
    has = series.notna()
    for keys, min_n in reversed(levels):
        k = keys.fillna("__ohne__")
        cnt = has.groupby(k).transform("sum")
        ranked = series.groupby(k).rank(pct=True, ascending=higher_better)
        use = (cnt >= min_n) & keys.notna()
        out = ranked.where(use, out)
    return out


CORE = [m for p in SCORE_PILLARS for m, _ in PILLARS[p]["metrics"] if m not in OPTIONAL]


def _applicable(row) -> int:
    na = set(row.get("not_applicable") or [])
    own = {"pb_fin"} if (row.get("is_financial") or row.get("is_reit")) else set()
    own |= {"roa_fin"} if row.get("is_financial") else set()
    excluded = ({"pb_fin", "roa_fin"} - own) | na
    return max(len([m for m in CORE if m not in excluded]), 1)


def data_quality(row) -> tuple[str, list[str]]:
    """Ampel Datenqualität + Begründungen."""
    flags = [f for f in (row.get("flags") or []) if f not in WARN_FLAG_EXCLUDE]
    cov = row.get("coverage")
    why = []
    if cov is None or cov != cov or cov < MIN_COVERAGE:
        why.append("zu wenige belastbare Kennzahlen")
    if "sec_abweichung" in flags:
        why.append("Yahoo weicht vom SEC-Abschluss ab")
    if "kurs_veraltet" in flags:
        why.append("kein aktueller Referenzkurs")
    if row.get("is_financial") and "kbv_unplausibel" in flags:
        why.append("Buchwert je Aktie unplausibel – Bank/Versicherer nicht bewertbar")
    if why:
        return "rot", why
    if cov < 0.85:
        why.append(f"Datenabdeckung {round(cov * 100)} %")
    if flags:
        why.append(f"{len(flags)} Prüfhinweis(e)")
    if why:
        return "gelb", why
    sec = (row.get("sec") or {}).get("status")
    return "gruen", ["SEC-bestätigt" if sec in ("bestaetigt", "bestaetigt_split") else "Plausibilitätsprüfungen bestanden"]


def entry(row) -> str:
    """Ampel Einstieg (Chart) – bewusst getrennt von Qualität und Bewertung."""
    trend = row.get("trend")
    if trend in (None, "n/a") or "kurs_veraltet" in (row.get("flags") or []):
        return "grau"
    dist = row.get("dist_sma200")
    soon = "zahlen_in_kuerze" in (row.get("flags") or [])
    if not soon and (row.get("in_buy_zone") or (trend == "Aufwärtstrend" and dist is not None and dist < 0.15)):
        return "gruen"
    if trend == "Abwärtstrend" and not row.get("buy_zones"):
        return "rot"
    return "gelb"


def score(df: pd.DataFrame) -> pd.DataFrame:
    """df: eine Zeile je Aktie (Index = Symbol). Gibt Säulen, Score, Ampeln, Urteil und Zusatz-Flags zurück."""
    df = _prepare(df)
    df["peer_group"] = [peer_group(sec, ind, sym) for sym, sec, ind
                        in zip(df.index, df["sector"], df.get("industry", [None] * len(df)))]
    levels = [(df["peer_group"], MIN_GROUP_N), (df["sector"], MIN_SECTOR_N)]

    # --- Zyklik-Prüfung VOR der Säulenbildung (Abschnitt 7/13: zyklisch überhöhter Gewinn) ---
    extra_flags = {s: [] for s in df.index}
    sector_pe = df.groupby("sector")["pe_ttm"].median()
    norm_cyc = set()
    for s, r in df.iterrows():
        if not is_cyclical(r.get("sector"), r.get("industry")):
            continue
        # Rohstoffe/Energie sind immer zyklisch (Preisnehmer). Bei übrigen zyklischen Branchen (Halbleiter,
        # Auto, Chemie ...) muss sich die Zyklik in mind. 5 Jahren Historie belegen lassen (Umsatzeinbruch
        # >= 15 % in einem Jahr), sonst gilt ein Margenanstieg als strukturell.
        drop = r.get("max_rev_drop")
        if (r.get("sector") not in CYCLICAL_SECTORS and (r.get("hist_years") or 0) >= 5
                and drop == drop and drop is not None and drop > CYCLE_DROP):
            continue
        pe, med = r.get("pe_ttm"), sector_pe.get(r.get("sector"))
        eg = r.get("earn_growth")
        om, om5 = r.get("op_margin"), r.get("op_margin_avg5")
        margin_peak = om == om and om5 == om5 and om is not None and om5 is not None and om5 > 0 and om > 1.5 * om5
        if ((eg is not None and eg == eg and eg > 0.4) or (pe == pe and pe and med == med and med and pe < 0.6 * med)
                or margin_peak):
            pn = r.get("pe_norm")
            if pn == pn and pn is not None and pn > 0:
                extra_flags[s].append("zyklik_normalisiert")
                norm_cyc.add(s)
            else:
                extra_flags[s].append("zyklik_spitzengewinn")

    pct: dict[str, pd.Series] = {}
    for p in PILLARS.values():
        for m, hb in p["metrics"]:
            col = pd.to_numeric(df[m], errors="coerce") if m in df else pd.Series(float("nan"), index=df.index)
            pct[m] = _pct(col, levels, hb)
    for m in ("pe_ttm", "pe_fwd"):
        pct[m] = pct[m].where(~(df["_loss"] & pct[m].isna()), 0.0)
    # Zykliker mit Mehrjahresdaten: Bewertung nur über den normalisierten Gewinn. Alle Kennzahlen auf Basis
    # aktueller (möglicherweise Spitzen-)Gewinne/Cashflows wären verzerrt.
    # Datenabdeckung VOR dem Ausblenden zählen: ausgeblendet heißt "bewusst nicht gewertet", nicht "fehlt"
    n_avail = pd.Series(0, index=df.index)
    for name in SCORE_PILLARS:
        for m, _ in PILLARS[name]["metrics"]:
            if m not in OPTIONAL:
                n_avail += pct[m].notna().astype(int)
    # Das normalisierte KGV ist für Zykliker gedacht; bei Firmen, die gerade profitabel werden oder
    # strukturell wachsen, würde der Margen-Median vergangener (Verlust-)Jahre sie zu Unrecht bestrafen
    pct["pe_norm"] = pct["pe_norm"].where(df.index.isin(list(norm_cyc)))
    if norm_cyc:
        mask = df.index.isin(list(norm_cyc))
        for m in ("pe_ttm", "pe_fwd", "peg", "ev_ebitda", "fcf_yield", "implied_growth", "pe_vs_hist"):
            pct[m] = pct[m].where(~mask)

    res = pd.DataFrame(index=df.index)
    for name, p in PILLARS.items():
        mat = pd.concat([pct[m].rename(m) for m, _ in p["metrics"]], axis=1)
        res[f"p_{name}"] = (mat.mean(axis=1, skipna=True) * 10).round(1)   # nur Information (Perzentile)
    res["coverage"] = [round(min(n_avail[s] / _applicable(df.loc[s].to_dict()), 1), 2) for s in df.index]

    # --- Absolute Qualität und fairer Wert je Aktie ---
    peer_pe = df.groupby("peer_group")["pe_fwd"].median().to_dict()
    margin_pct = pct["op_margin"]
    q_scores, q_comp, q_adj, vals, p_scores, totals = [], [], [], [], [], []
    for s in df.index:
        row = df.loc[s].to_dict()
        row["flags"] = list(row.get("flags") or []) + extra_flags[s]
        mp = margin_pct.get(s)
        q = quality.quality(row, None if mp != mp else mp)
        v = valuation.fair_value(row, q["score"], _nan_none(peer_pe.get(row.get("peer_group"))))
        p_sc = (v or {}).get("price_score")
        q_scores.append(q["score"])
        q_comp.append(q["components"])
        q_adj.append(q["adjustments"])
        vals.append(v)
        p_scores.append(p_sc)
        totals.append(total_score(q["score"], p_sc, row))
        if q["score"] is not None and q["score"] < 5 and p_sc is not None and p_sc >= 7:
            extra_flags[s].append("value_trap_risiko")
    res["q_score"] = q_scores
    res["q_components"] = q_comp
    res["q_adjustments"] = q_adj
    res["valuation"] = vals
    res["price_score"] = p_scores
    res["score"] = totals
    res["extra_flags"] = [extra_flags[s] for s in df.index]
    res["peer_group"] = df["peer_group"]
    res["metric_pct"] = [
        {m: round(float(pct[m].loc[s]) * 100) for m in pct if pd.notna(pct[m].loc[s])} for s in df.index
    ]
    return res


def _nan_none(x):
    return None if x is None or x != x else x


W_QUALITY, W_PRICE = 0.55, 0.45
MODEL_VERSION = 2   # 1: Perzentil-Rangfolge, 2: absolute Qualität + fairer Wert


def total_score(q, p, row) -> float | None:
    """Gesamt 1-10 = 55 % Qualität + 45 % Preis-Attraktivität, kleine Korrektur durch Gewinnrevisionen.
    Schwache Qualität wird durch einen niedrigen Preis nicht ausgeglichen (Deckel 4,5)."""
    if q is None:
        return None
    p = valuation.NEUTRAL_P if p is None else p
    s = W_QUALITY * q + W_PRICE * p
    rev = _nan_none(row.get("rev_eps_90d"))
    if rev is not None:
        s += 0.3 if rev > 0.03 else -0.3 if rev < -0.03 else 0.0
    if q < 4:
        s = min(s, 4.5)
    return round(max(1.0, min(10.0, s)), 1)


Q_GOOD, Q_OK = 7.0, 5.0
KAUF_EXIT_TOL = 1.05   # Hysterese: Kandidat bleibt, solange der Kurs max. 5 % über dem Kaufkurs liegt


def assess(row: dict, prev_code: str | None = None) -> dict:
    """Ampeln + Urteil. Leitfrage: Gutes Unternehmen? Interessanter Kaufkurs?"""
    q = row.get("q_score")
    v = row.get("valuation") or {}
    p = row.get("price_score")
    a = {"Qualität": "grau" if q is None else "gruen" if q >= Q_GOOD else "gelb" if q >= Q_OK else "rot",
         "Bewertung": "grau" if p is None else "gruen" if p >= 6 else "gelb" if p >= 3.5 else "rot",
         "Wachstum": ampel_component((row.get("q_components") or {}).get("Wachstum"))}
    dq, dq_why = data_quality(row)
    a["Daten"] = dq
    a["Einstieg"] = entry(row)
    flags = set(row.get("flags") or [])
    price, fv, buy = row.get("price"), v.get("fair_value"), v.get("buy_price")
    in_buy = bool(price and buy and price <= buy * (KAUF_EXIT_TOL if prev_code == "kandidat" else 1.0))
    below_fv = bool(price and fv and price <= fv)
    cur = row.get("currency") or ""
    buy_txt = f" · Kaufkurs ≤ {buy:,.2f} {cur}".replace(",", "X").replace(".", ",").replace("X", ".") if buy else ""

    if q is None or dq == "rot":
        code, text = "nab", "Nicht ausreichend beurteilbar"
    elif fv is None:
        code, text = ("beobachten", "Gutes Unternehmen – Bewertung nicht belastbar") if q >= Q_GOOD else (
            "neutral", "Bewertung nicht belastbar")
    elif q >= Q_GOOD:
        if in_buy and "zyklik_spitzengewinn" not in flags:
            code, text = "kandidat", "Gutes Unternehmen im Kaufbereich – Kandidat für Einzelanalyse"
        elif below_fv:
            code, text = "beobachten", "Gutes Unternehmen – nahe Kaufbereich" + buy_txt
        else:
            code, text = "beobachten_teuer", "Gutes Unternehmen – auf Kaufkurs warten" + buy_txt
    elif q >= Q_OK:
        if in_buy:
            code, text = "beobachten", "Solide Qualität, günstig bewertet" + buy_txt
        elif price and fv and price <= fv * 1.1:
            code, text = "neutral", "Solide Qualität, fair bewertet"
        else:
            code, text = "meiden_teuer", "Solide Qualität, aber zu teuer"
    else:
        if in_buy:
            code, text = "meiden", "Schwache Qualität, niedrig bewertet – Value-Falle möglich"
        else:
            code, text = "meiden_schwach", "Meiden – schwache Qualität"
    if code in ("kandidat", "beobachten") and a["Einstieg"] == "gruen" and row.get("in_buy_zone"):
        text += " · Chart in Buy-Zone"
    if "zahlen_in_kuerze" in flags and code != "nab":
        d = int(row.get("earnings_in_days") or 0)
        text += " · Zahlen " + ("heute" if d == 0 else "morgen" if d == 1 else f"in {d} Tagen")
    return {"ampeln": a, "data_why": dq_why, "verdict_code": code, "verdict": text}


def ampel_component(v) -> str:
    if v is None or v != v:
        return "grau"
    return "gruen" if v >= 6.5 else "rot" if v < 3.5 else "gelb"
