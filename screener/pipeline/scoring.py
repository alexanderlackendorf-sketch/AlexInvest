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
        res[f"p_{name}"] = (mat.mean(axis=1, skipna=True) * 10).round(1)

    for s, r in df.iterrows():
        if "zyklik_spitzengewinn" in extra_flags[s]:
            # Ohne Mehrjahresdaten kein normalisierter Gewinn -> Bewertung höchstens neutral
            pb = res.at[s, "p_Bewertung"]
            if pb == pb:
                res.at[s, "p_Bewertung"] = min(pb, 5.0)
        rg, mom = r.get("rev_growth"), r.get("mom_12_1")
        if (res.at[s, "p_Bewertung"] == res.at[s, "p_Bewertung"] and res.at[s, "p_Bewertung"] >= 7
                and rg == rg and rg is not None and rg < 0 and mom == mom and mom is not None and mom < -0.2):
            extra_flags[s].append("value_trap_risiko")

    acc = pd.Series(0.0, index=df.index)
    total_w = pd.Series(0.0, index=df.index)
    for name in SCORE_PILLARS:
        ps = res[f"p_{name}"] / 10
        has = ps.notna()
        acc += (ps.fillna(0) * PILLARS[name]["weight"]).where(has, 0)
        total_w += pd.Series(PILLARS[name]["weight"], index=df.index).where(has, 0)
    composite = acc / total_w.replace(0, pd.NA)

    res["coverage"] = [round(min(n_avail[s] / _applicable(df.loc[s].to_dict()), 1), 2) for s in df.index]
    core_ok = res["p_Bewertung"].notna() & res["p_Qualität"].notna()
    valid = core_ok & (res["coverage"] >= MIN_COVERAGE)
    composite = composite.where(valid)
    sc = (1 + 9 * pd.to_numeric(composite, errors="coerce").rank(pct=True)).round(1)

    # Rote Ampeln deckeln den Score (keine Kompensation durch andere Stärken)
    caps = []
    for s in df.index:
        cap, why = 10.0, []
        if ampel(res.at[s, "p_Qualität"]) == "rot":
            cap, why = min(cap, 4.0), why + ["Qualität rot"]
        if ampel(res.at[s, "p_Bewertung"]) == "rot":
            cap, why = min(cap, 6.0), why + ["Bewertung rot"]
        if "value_trap_risiko" in extra_flags[s]:
            cap, why = min(cap, 6.0), why + ["Value-Trap-Risiko"]
        if sc[s] == sc[s] and sc[s] > cap:
            sc[s] = cap
            caps.append(", ".join(why))
        else:
            caps.append(None)
    res["score"] = sc
    res["score_cap"] = caps
    res["extra_flags"] = [extra_flags[s] for s in df.index]
    res["peer_group"] = df["peer_group"]
    res["metric_pct"] = [
        {m: round(float(pct[m].loc[s]) * 100) for m in pct if pd.notna(pct[m].loc[s])} for s in df.index
    ]
    return res


KANDIDAT_IN, KANDIDAT_OUT = 8.0, 7.5     # Hysterese: Aufstieg ab 8,0, Abstieg erst unter 7,5
BEOBACHTEN_IN, BEOBACHTEN_OUT = 5.5, 5.0


def assess(row: dict, prev_code: str | None = None) -> dict:
    """Ampeln + Urteil für eine fertige Zeile (nach Score, SEC-Status und Flags).
    prev_code: Urteil des Vortags -> Hysterese verhindert tägliches Hin- und Herspringen."""
    p = row["pillars"]
    a = {"Qualität": ampel(p.get("Qualität")), "Bewertung": ampel(p.get("Bewertung")),
         "Wachstum": ampel(p.get("Wachstum"))}
    dq, dq_why = data_quality(row)
    a["Daten"] = dq
    a["Einstieg"] = entry(row)
    sc = row.get("score")
    flags = row.get("flags") or []

    if sc is None or sc != sc or dq == "rot":
        code, text = "nab", "Nicht ausreichend beurteilbar"
    elif a["Qualität"] == "rot":
        code, text = "meiden_schwach", "Meiden – wirtschaftlich schwach"
    elif a["Bewertung"] == "rot":
        if a["Qualität"] == "gruen":
            code, text = "beobachten_teuer", "Beobachten – gutes Unternehmen, zu teuer"
        else:
            code, text = "meiden_teuer", "Meiden – zu teuer"
    elif (sc >= (KANDIDAT_OUT if prev_code == "kandidat" else KANDIDAT_IN)
          and a["Qualität"] == "gruen" and a["Bewertung"] in ("gruen", "gelb") and a["Wachstum"] != "rot"
          and not {"zyklik_spitzengewinn", "value_trap_risiko"} & set(flags)):
        code, text = "kandidat", "Kandidat für Einzelanalyse"
    elif sc >= (BEOBACHTEN_OUT if prev_code in ("kandidat", "beobachten") else BEOBACHTEN_IN):
        code, text = "beobachten", "Beobachten"
    elif "rot" in (a["Wachstum"],) or sc < 3:
        code, text = "meiden", "Meiden"
    else:
        # Keine rote Ampel, aber auch kein Vorteil: kein "Meiden" ohne Begründung
        code, text = "neutral", "Kein Vorteil erkennbar"
    if code in ("kandidat", "beobachten") and a["Einstieg"] == "gruen" and row.get("in_buy_zone"):
        text += " · Kurs in Buy-Zone"
    if "zahlen_in_kuerze" in flags and code != "nab":
        d = int(row.get("earnings_in_days") or 0)
        text += " · Zahlen " + ("heute" if d == 0 else "morgen" if d == 1 else f"in {d} Tagen")
    return {"ampeln": a, "data_why": dq_why, "verdict_code": code, "verdict": text}
