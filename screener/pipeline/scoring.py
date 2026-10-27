"""Rating 1-10 (Modell 3) und Urteile nach den Regeln des Projekts "Aktienanalyse".

Rating = 40 % Bewertung + 35 % Qualität + 15 % Momentum + 10 % Gewinnrevisionen, danach harte Deckel:
  Bewertung (0-10)  60 % erwartete Rendite (IRR zum heutigen Kurs), 20 % gegenüber der eigenen
                    Bewertungshistorie, 20 % gegenüber der Vergleichsgruppe (Owner-Earnings-, FCF-Rendite, EV/EBITDA)
  Qualität (0-10)   absolute Skala (quality.py)
  Momentum (0-10)   Kursentwicklung 12 Monate ohne letzten Monat, Perzentil im Universum
  Revisionen (0-10) Änderung der Konsens-Gewinnschätzung 90 Tage und Saldo der Anpassungen 30 Tage
  Deckel            Qualität < 5 -> max. 5 (< 4 -> max. 4); Bilanz-Warnsignal -> max. 4;
                    erwartete Rendite < 8 % -> max. 6; Bewertung nicht möglich -> max. 6
Drei Profi-Methoden als Gegenprobe (Ampeln): Quant-Faktoren, erwartete Rendite, fairer Wert mit Sicherheitsmarge.
"Methoden einig" = alle drei grün. Ein Screener spricht kein "Kaufen" aus: bestes Urteil ist
"Kandidat für Einzelanalyse". Analystenziele fließen nicht ein.
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
# Kein Datenproblem -> zählt nicht als Prüfhinweis in der Datenqualität
WARN_FLAG_EXCLUDE = {"waehrung_umgerechnet", "zyklik_normalisiert", "zahlen_in_kuerze", "split_nach_bericht_bereinigt",
                     "methoden_einig", "bilanz_warnsignal", "gewinnqualitaet_pruefen", "value_trap_risiko"}


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
    cyc_ev = {}
    for s, r in df.iterrows():
        if not is_cyclical(r.get("sector"), r.get("industry")):
            continue
        d0 = r.get("max_rev_drop")
        # Belegte Zyklik: Rohstoffe/Energie immer, sonst Umsatzeinbruch >= 15 % in der Historie
        cyc_ev[s] = r.get("sector") in CYCLICAL_SECTORS or (d0 == d0 and d0 is not None and d0 <= CYCLE_DROP)
        # Rohstoffe/Energie sind immer zyklisch (Preisnehmer). Bei übrigen zyklischen Branchen (Halbleiter,
        # Auto, Chemie ...) muss sich die Zyklik in mind. 5 Jahren Historie belegen lassen (Umsatzeinbruch
        # >= 15 % in einem Jahr), sonst gilt ein Margenanstieg als strukturell.
        drop = r.get("max_rev_drop")
        if (r.get("sector") not in CYCLICAL_SECTORS and (r.get("hist_years") or 0) >= 5
                and drop == drop and drop is not None and drop > CYCLE_DROP):
            continue
        pn = r.get("pe_norm")
        if r.get("sector") in CYCLICAL_SECTORS and not (pn == pn and pn is not None and pn > 0):
            # Rohstoffe/Energie ohne Mehrjahresdaten: Gewinnniveau im Zyklus nicht einordenbar
            extra_flags[s].append("zyklik_spitzengewinn")
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

    # --- Qualität, Bewertung (erwartete Rendite), Bilanz-Forensik je Aktie ---
    margin_pct = pct["op_margin"]
    Q, V, warn = {}, {}, {}
    for s in df.index:
        row = df.loc[s].to_dict()
        row["flags"] = list(row.get("flags") or []) + extra_flags[s]
        row["cyclical_evidenced"] = cyc_ev.get(s, False)
        mp = margin_pct.get(s)
        Q[s] = quality.quality(row, None if mp != mp else mp)
        V[s] = valuation.fair_value(row, Q[s]["score"])
        warn[s] = red_flags(row)
        if any(lv == "schieflage" for lv, _ in warn[s]):
            extra_flags[s].append("bilanz_warnsignal")
        if any(lv == "gewinnqualitaet" for lv, _ in warn[s]):
            extra_flags[s].append("gewinnqualitaet_pruefen")

    # Bewertung gegenüber der Vergleichsgruppe: Owner-Earnings-Rendite, FCF-Rendite, EV/EBITDA
    oy = pd.Series({s: (V[s] or {}).get("owner_yield") for s in df.index}, dtype=float)
    rel = [_pct(oy, levels, True), pct["fcf_yield"], pct["ev_ebitda"]]
    sector_val = (pd.concat(rel, axis=1).mean(axis=1, skipna=True) * 10)
    mom = pd.to_numeric(df.get("mom_12_1"), errors="coerce")
    mom_pct = mom.rank(pct=True)
    q_ser = pd.Series({s: Q[s]["score"] for s in df.index}, dtype=float)
    q_pct = q_ser.rank(pct=True)

    rows_out = {k: [] for k in ("q_score", "q_components", "q_adjustments", "valuation", "price_score", "v_parts",
                                "mom_score", "rev_score", "score", "lenses", "methods_agree", "warn_why", "score_caps")}
    for s in df.index:
        row = df.loc[s].to_dict()
        q, v = Q[s]["score"], V[s] or {}
        sv = _nan_none(sector_val.get(s))
        parts = {"Erwartete Rendite": v.get("er_score"), "vs. eigene Historie": v.get("hist_score"),
                 "vs. Vergleichsgruppe": None if sv is None else round(sv, 1)}
        p_sc = value_score(parts)
        m_sc = None if pd.isna(mom_pct.get(s)) else round(float(mom_pct[s]) * 10, 1)
        r_sc = revision_score(row)
        total, caps = total_score(q, p_sc, m_sc, r_sc, v, {lv for lv, _ in warn[s]})
        lens = lenses(v, row.get("price"), _nan_none(sv), _nan_none(q_pct.get(s)), _nan_none(mom_pct.get(s)))
        agree = all(l["ampel"] == "gruen" for l in lens.values()) and not warn[s] and (q or 0) >= Q_GOOD
        if agree:
            extra_flags[s].append("methoden_einig")
        if q is not None and q < 5 and p_sc is not None and p_sc >= 7:
            extra_flags[s].append("value_trap_risiko")
        for k, x in (("q_score", q), ("q_components", Q[s]["components"]), ("q_adjustments", Q[s]["adjustments"]),
                     ("valuation", V[s]), ("price_score", p_sc), ("v_parts", parts), ("mom_score", m_sc),
                     ("rev_score", r_sc), ("score", total), ("lenses", lens), ("methods_agree", agree),
                     ("warn_why", [t for _, t in warn[s]]), ("score_caps", caps)):
            rows_out[k].append(x)
    for k, col in rows_out.items():
        res[k] = col
    res["extra_flags"] = [extra_flags[s] for s in df.index]
    res["cyclical_evidenced"] = [cyc_ev.get(s, False) for s in df.index]
    res["peer_group"] = df["peer_group"]
    res["metric_pct"] = [
        {m: round(float(pct[m].loc[s]) * 100) for m in pct if pd.notna(pct[m].loc[s])} for s in df.index
    ]
    return res


def _nan_none(x):
    return None if x is None or x != x else x


WEIGHTS = {"Bewertung": 0.40, "Qualität": 0.35, "Momentum": 0.15, "Revisionen": 0.10}
VALUE_WEIGHTS = {"Erwartete Rendite": 0.6, "vs. eigene Historie": 0.2, "vs. Vergleichsgruppe": 0.2}
MODEL_VERSION = 3   # 1: Perzentil-Rangfolge, 2: Qualität + fairer Wert, 3: erwartete Rendite + Faktoren + Forensik
ER_MIN_FOR_GOOD = 0.08
REV_PTS = [(-0.10, 0), (-0.03, 2.5), (0.0, 5), (0.03, 7.5), (0.10, 10)]
BREADTH_PTS = [(-0.5, 0), (0.0, 5), (0.5, 10)]


def value_score(parts: dict) -> float | None:
    """Bewertung 0-10; ohne erwartete Rendite keine Bewertung (Relativvergleiche allein tragen nicht)."""
    if parts.get("Erwartete Rendite") is None:
        return None
    avail = {k: v for k, v in parts.items() if v is not None}
    w = sum(VALUE_WEIGHTS[k] for k in avail)
    return round(sum(VALUE_WEIGHTS[k] * v for k, v in avail.items()) / w, 1)


def revision_score(row: dict) -> float | None:
    a = quality.scale(_nan_none(row.get("rev_eps_90d")), REV_PTS)
    b = quality.scale(_nan_none(row.get("rev_breadth")), BREADTH_PTS)
    vals = [x for x in (a, b) if x is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


NO_ALTMAN_SECTORS = {"Utilities", "Real Estate"}   # regulierte bzw. immobilienlastige Bilanzen: Z'' nicht aussagekräftig


def red_flags(row: dict) -> list[tuple[str, str]]:
    """Bilanz-Warnsignale als (Stufe, Text); Stufe "schieflage" (Deckel 4) oder "gewinnqualitaet" (Deckel 6).
    Nur Unternehmen: Banken, Versicherer und REITs haben eine andere Bilanzlogik. Altman allein schlägt bei
    Versorgern und Firmen mit hohen Rückkäufen (negatives Eigenkapital) fälschlich an, Beneish allein bei
    schnellem Wachstum – deshalb jeweils nur zusammen mit einem zweiten Beleg."""
    if row.get("is_financial") or row.get("is_reit"):
        return []
    out = []
    z, m, acc = _nan_none(row.get("altman_z2")), _nan_none(row.get("beneish_m")), _nan_none(row.get("accruals"))
    nd, f = _nan_none(row.get("net_debt_ebitda")), _nan_none(row.get("f_score"))
    if (z is not None and z < 1.1 and row.get("sector") not in NO_ALTMAN_SECTORS
            and (row.get("loss_making") or (nd is not None and nd > 4 and f is not None and f <= 4))):
        out.append(("schieflage", f"Finanzielle Schieflage: Altman Z'' {z:.2f} (< 1,1) bei "
                                  + ("Verlust" if row.get("loss_making") else f"Verschuldung {nd:.1f}x EBITDA und F-Score {f:.0f}")))
    if m is not None and m > -1.78 and acc is not None and acc > 0.05:
        out.append(("gewinnqualitaet", f"Gewinnqualität prüfen: Beneish M-Score {m:.2f} (> -1,78) und Accruals {acc:.0%} "
                                       "(bei starkem Wachstum oder Sondergewinnen oft Fehlalarm)"))
    elif acc is not None and acc > 0.10:
        out.append(("gewinnqualitaet", f"Gewinnqualität prüfen: Gewinn liegt {acc:.0%} der Bilanzsumme über dem Cashflow"))
    return out


def total_score(q, p, m, rv, v: dict, warn) -> tuple[float | None, list[str]]:
    """warn: Menge der Warnstufen ({"schieflage", "gewinnqualitaet"}); True gilt als Schieflage."""
    """Rating 1-10 und angewandte Deckel. Ohne Qualitäts-Score kein Rating."""
    if q is None:
        return None, []
    comp = {"Bewertung": p, "Qualität": q, "Momentum": m, "Revisionen": rv}
    avail = {k: x for k, x in comp.items() if x is not None}
    w = sum(WEIGHTS[k] for k in avail)
    s = sum(WEIGHTS[k] * x for k, x in avail.items()) / w
    caps = []
    er = (v or {}).get("er")
    warn = {"schieflage"} if warn is True else set(warn or ())
    for cond, lim, why in ((q < 4, 4.0, "Qualität < 4"), (q < 5, 5.0, "Qualität < 5"),
                           ("schieflage" in warn, 4.0, "finanzielle Schieflage"),
                           ("gewinnqualitaet" in warn, 6.0, "Gewinnqualität prüfen"),
                           (p is None, 6.0, "keine belastbare Bewertung"),
                           (er is not None and er < ER_MIN_FOR_GOOD, 6.0, "erwartete Rendite < 8 %")):
        if cond and s > lim:
            s = lim
            caps.append(why)
    return round(max(1.0, min(10.0, s)), 1), caps


def lenses(v: dict, price, sector_val, q_pct, mom_pct) -> dict:
    """Drei unabhängige Profi-Sichten: Quant-Faktoren, erwartete Rendite, fairer Wert mit Sicherheitsmarge."""
    v = v or {}
    facs = {"Value": None if sector_val is None else sector_val / 10, "Quality": q_pct, "Momentum": mom_pct}
    have = [x for x in facs.values() if x is not None]
    comp = sum(have) / len(have) if len(have) >= 2 else None
    quant = {"ampel": "grau" if comp is None else "gruen" if comp >= 0.70 else "gelb" if comp >= 0.40 else "rot",
             "composite": None if comp is None else round(comp * 100),
             "factors": {k: None if x is None else round(x * 100) for k, x in facs.items()}}
    er, h = v.get("er"), v.get("hurdle")
    er_l = {"ampel": "grau" if er is None else "gruen" if er >= h else "gelb" if er >= h - 0.03 else "rot",
            "er": er, "hurdle": h, "implied_growth": v.get("implied_growth"), "growth_hist": v.get("growth_hist")}
    fv, mos = v.get("fair_value"), v.get("mos_required")
    disc = (1 - price / fv) if (fv and price) else None
    fv_l = {"ampel": "grau" if disc is None else "gruen" if disc >= mos else "gelb" if disc >= 0 else "rot",
            "fair_value": fv, "discount": None if disc is None else round(disc, 3), "mos": mos,
            "uncertainty": v.get("uncertainty")}
    return {"Quant-Faktoren": quant, "Erwartete Rendite": er_l, "Fairer Wert": fv_l}


Q_GOOD, Q_OK = 7.0, 5.0
KAUF_EXIT_TOL = 1.05   # Hysterese: Kandidat bleibt, solange der Kurs max. 5 % über dem Kaufkurs liegt
NEAR_TOL = 1.10        # "nahe Kaufbereich": Kurs höchstens 10 % über dem Kaufkurs


def assess(row: dict, prev_code: str | None = None) -> dict:
    """Ampeln + Urteil. Leitfrage: Gutes Unternehmen? Interessanter Kaufkurs?"""
    q = row.get("q_score")
    v = row.get("valuation") or {}
    p = row.get("price_score")
    er, hurdle = v.get("er"), v.get("hurdle")
    a = {"Qualität": "grau" if q is None else "gruen" if q >= Q_GOOD else "gelb" if q >= Q_OK else "rot",
         "Bewertung": "grau" if p is None else "gruen" if p >= 6 else "gelb" if p >= 3.5 else "rot",
         "Wachstum": ampel_component((row.get("q_components") or {}).get("Wachstum"))}
    dq, dq_why = data_quality(row)
    a["Daten"] = dq
    a["Einstieg"] = entry(row)
    flags = set(row.get("flags") or [])
    price, fv, buy = row.get("price"), v.get("fair_value"), v.get("buy_price")
    in_buy = bool(price and buy and price <= buy * (KAUF_EXIT_TOL if prev_code == "kandidat" else 1.0))
    near = bool(price and buy and price <= buy * NEAR_TOL)
    warn = bool({"bilanz_warnsignal", "gewinnqualitaet_pruefen"} & set(row.get("flags") or []))
    cur = row.get("currency") or ""
    buy_txt = f" · Kaufkurs ≤ {buy:,.2f} {cur}".replace(",", "X").replace(".", ",").replace("X", ".") if buy else ""

    if q is None or dq == "rot":
        code, text = "nab", "Nicht ausreichend beurteilbar"
    elif er is None:
        code, text = ("beobachten", "Gutes Unternehmen – Bewertung nicht belastbar") if q >= Q_GOOD else (
            "neutral", "Bewertung nicht belastbar")
    elif q >= Q_GOOD:
        if in_buy and not warn and v.get("uncertainty") != "sehr hoch":
            code, text = "kandidat", "Gutes Unternehmen im Kaufbereich – Kandidat für Einzelanalyse"
        elif in_buy and warn:
            code, text = "beobachten", "Gutes Unternehmen, günstig – aber Bilanz-Warnsignal: erst prüfen"
        elif in_buy:
            code, text = "beobachten", "Gutes Unternehmen, rechnerisch günstig – Unsicherheit sehr hoch, Grund für Abschlag prüfen"
        elif near:
            code, text = "beobachten", "Gutes Unternehmen – nahe Kaufbereich" + buy_txt
        else:
            code, text = "beobachten_teuer", "Gutes Unternehmen – auf Kaufkurs warten" + buy_txt
    elif q >= Q_OK:
        if in_buy:
            code, text = "beobachten", "Solide Qualität, günstig bewertet" + buy_txt
        elif er >= ER_MIN_FOR_GOOD:
            code, text = "neutral", "Solide Qualität, fair bewertet"
        else:
            code, text = "meiden_teuer", "Solide Qualität, aber zu teuer"
    else:
        if in_buy:
            code, text = "meiden", "Schwache Qualität, niedrig bewertet – Value-Falle möglich"
        else:
            code, text = "meiden_schwach", "Meiden – schwache Qualität"
    if row.get("methods_agree") and code == "kandidat":
        text += " · alle drei Methoden einig"
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
