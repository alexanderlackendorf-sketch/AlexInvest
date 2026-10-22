"""Rating 1-10: regelbasiert, branchenrelativ, nachvollziehbar.

Jede Kennzahl wird innerhalb ihres Sektors (mind. 10 Werte mit Daten, sonst gesamtes Universum)
in ein Perzentil 0..1 umgerechnet. Pillar = Mittel der verfügbaren Perzentile.
Gesamt = gewichtetes Mittel der verfügbaren Pillars, anschließend über das Universum
perzentil-skaliert auf 1..10. Ein Score von 8,0 heißt also: besser als ~78 % des Universums.
Fehlende Daten werden nicht aufgefüllt; ihr Gewicht entfällt (Datenabdeckung wird ausgewiesen).
"""
from __future__ import annotations

import pandas as pd

# (Kennzahl, höher_ist_besser)
PILLARS: dict[str, dict] = {
    "Bewertung": {"weight": 0.25, "metrics": [
        ("pe_fwd", False), ("pe_ttm", False), ("ev_ebitda", False), ("fcf_yield", True), ("peg", False), ("pb_fin", False),
    ]},
    "Qualität": {"weight": 0.25, "metrics": [
        ("roe", True), ("op_margin", True), ("gross_margin", True), ("fcf_margin", True),
        ("net_debt_ebitda", False), ("roa_fin", True),
    ]},
    "Wachstum": {"weight": 0.20, "metrics": [
        ("rev_growth", True), ("earn_growth", True), ("eps_growth_fwd", True),
    ]},
    "Momentum": {"weight": 0.20, "metrics": [
        ("mom_12_1", True), ("ret_3m", True), ("dist_sma200", True),
    ]},
    "Analysten": {"weight": 0.10, "metrics": [
        ("analyst_upside", True), ("analyst_rec", False),
    ]},
}
LABELS = {"pe_fwd": "KGV (fwd)", "pe_ttm": "KGV (ttm)", "ev_ebitda": "EV/EBITDA", "fcf_yield": "FCF-Rendite",
          "peg": "PEG", "pb_fin": "KBV (Finanzwerte)", "roe": "Eigenkapitalrendite", "op_margin": "Operative Marge",
          "gross_margin": "Bruttomarge", "fcf_margin": "FCF-Marge", "net_debt_ebitda": "Nettoverschuldung/EBITDA",
          "roa_fin": "Gesamtkapitalrendite (Finanzwerte)", "rev_growth": "Umsatzwachstum", "earn_growth": "Gewinnwachstum",
          "eps_growth_fwd": "EPS-Wachstum erw.", "mom_12_1": "Momentum 12-1M", "ret_3m": "Performance 3M",
          "dist_sma200": "Abstand SMA200", "analyst_upside": "Analysten-Upside", "analyst_rec": "Analysten-Empfehlung"}
MIN_SECTOR_N = 10
NOT_FOR_FIN = {"ev_ebitda", "fcf_yield", "gross_margin", "fcf_margin", "net_debt_ebitda"}


def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    fin = df["is_financial"].fillna(False).astype(bool)
    df["pb_fin"] = df["pb"].where(fin)
    df["roa_fin"] = df["roa"].where(fin)
    # Verlustbringer: KGV existiert nicht -> schlechtestes Perzentil statt "fehlt" (sonst würden sie bevorzugt)
    df["_pe_ttm_loss"] = df["loss_making"].fillna(False).astype(bool)
    return df


def _pct(series: pd.Series, groups: pd.Series, higher_better: bool) -> pd.Series:
    out = pd.Series(index=series.index, dtype=float)
    glob = series.rank(pct=True, ascending=higher_better)
    for g, idx in groups.groupby(groups).groups.items():
        s = series.loc[idx]
        if s.notna().sum() >= MIN_SECTOR_N:
            out.loc[idx] = s.rank(pct=True, ascending=higher_better)
        else:
            out.loc[idx] = glob.loc[idx]
    out.loc[groups.isna()] = glob.loc[groups.isna()]
    return out


def score(df: pd.DataFrame) -> pd.DataFrame:
    """df: eine Zeile je Aktie (Index = Symbol) mit Kennzahlen + 'sector'. Gibt Score-Spalten zurück."""
    df = _prepare(df)
    groups = df["sector"]
    pct: dict[str, pd.Series] = {}
    for p in PILLARS.values():
        for m, hb in p["metrics"]:
            if m in df:
                pct[m] = _pct(pd.to_numeric(df[m], errors="coerce"), groups, hb)
    loss = df["_pe_ttm_loss"]
    for m in ("pe_ttm", "pe_fwd"):
        if m in pct:
            pct[m] = pct[m].where(~(loss & pct[m].isna()), 0.0)

    res = pd.DataFrame(index=df.index)
    total_w = pd.Series(0.0, index=df.index)
    acc = pd.Series(0.0, index=df.index)
    n_avail = pd.Series(0, index=df.index)
    for name, p in PILLARS.items():
        cols = [m for m, _ in p["metrics"] if m in pct]
        mat = pd.concat([pct[m] for m in cols], axis=1)
        n_avail += mat.notna().sum(axis=1)
        ps = mat.mean(axis=1, skipna=True)
        res[f"p_{name}"] = (ps * 10).round(1)
        has = ps.notna()
        acc += (ps.fillna(0) * p["weight"]).where(has, 0)
        total_w += pd.Series(p["weight"], index=df.index).where(has, 0)
    composite = acc / total_w.replace(0, pd.NA)
    pillars_ok = sum(res[f"p_{n}"].notna().astype(int) for n in PILLARS)
    core_ok = res["p_Bewertung"].notna() | res["p_Qualität"].notna()
    valid = (pillars_ok >= 3) & core_ok & (total_w >= 0.5)
    composite = composite.where(valid)
    res["composite"] = composite
    res["score"] = (1 + 9 * composite.rank(pct=True)).round(1)
    n_all = sum(len(p["metrics"]) for p in PILLARS.values())
    fin = df["is_financial"].fillna(False).astype(bool)
    # anwendbare Kennzahlen: Finanzwerte ohne EBITDA/FCF/Bruttomarge, übrige ohne *_fin
    applicable = pd.Series(n_all - 2, index=df.index).where(~fin, n_all - len(NOT_FOR_FIN))
    res["coverage"] = (n_avail / applicable).clip(upper=1).round(2)
    res["metric_pct"] = [
        {m: round(float(pct[m].loc[s]) * 100) for m in pct if pd.notna(pct[m].loc[s])} for s in df.index
    ]
    return res


def verdict(score: float | None, in_zone: bool, trend: str) -> str:
    if score is None or score != score:
        return "Keine Wertung"
    if score >= 8.5:
        v = "Top-Kandidat"
    elif score >= 7:
        v = "Kaufkandidat"
    elif score >= 4.5:
        v = "Neutral"
    elif score >= 3:
        v = "Schwach"
    else:
        v = "Meiden"
    if score >= 7 and in_zone:
        v += " · in Buy-Zone"
    elif score >= 7 and trend == "Abwärtstrend":
        v += " · Trend abwarten"
    return v
