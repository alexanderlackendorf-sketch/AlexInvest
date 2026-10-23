"""Täglicher Lauf: Daten holen -> prüfen -> Kennzahlen -> Score -> JSON für die Web-Oberfläche.

Aufruf: python -m screener.pipeline.run --state state
Ausgabe: state/public/screener.json und state/public/px/<SYMBOL>.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from . import digest, fetch, history, quality, valuation, metrics, scoring, sec, technicals, targets, tracking, universe

log = logging.getLogger("screener")
MAX_INFO_AGE_DAYS = 10
MAX_PRICE_AGE_DAYS = 5  # älter -> kein aktueller Referenzkurs, keine kursbezogenen Aussagen
HISTORY_KEEP = 400
# Wächter: Abdeckung dieser Kennzahlen wird mit dem Vortag verglichen (Yahoo ändert Felder still)
WATCH_METRICS = ["price", "pe_ttm", "pe_fwd", "ev_ebitda", "fcf_yield", "roe", "op_margin", "rev_growth",
                 "eps_growth_fwd", "rev_eps_90d", "analyst_target", "earnings_date", "roic_med5", "rev_cagr",
                 "price_time", "score"]
ALARM_DROP = 0.75  # Alarm, wenn die Abdeckung auf weniger als 75 % des Vortags fällt
COVERAGE_VERSION = 2  # bei Änderung der Messung erhöhen -> kein Vergleich mit alter Messung
CHART_DAYS = 520  # Kursreihe für den Chart (~2 Jahre); intern werden 5 Jahre geladen
# GICS-Namen (Wikipedia) auf Yahoo-Sektornamen abbilden, falls Yahoo keinen Sektor liefert
GICS_TO_YAHOO = {
    "Information Technology": "Technology", "Health Care": "Healthcare", "Financials": "Financial Services",
    "Consumer Discretionary": "Consumer Cyclical", "Consumer Staples": "Consumer Defensive",
    "Materials": "Basic Materials",
}


def _clean(o):
    """NaN/Inf -> None, numpy -> python, Floats sinnvoll runden."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if hasattr(o, "item"):
        o = o.item()
    if isinstance(o, float):
        if not math.isfinite(o):
            return None
        return float(f"{o:.6g}")
    return o


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _save(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def quality_alarms(prev: dict, cur: dict) -> list[str]:
    """Vergleicht Abdeckung und Umfang mit dem letzten Lauf."""
    out = []
    same = prev.get("coverage_version") == cur.get("coverage_version")
    pc, cc = (prev.get("metric_coverage") or {}) if same else {}, cur.get("metric_coverage") or {}
    for k, old in pc.items():
        new = cc.get(k)
        if new is not None and old >= 0.3 and new < ALARM_DROP * old:
            out.append(f"{k}: Abdeckung von {old:.0%} auf {new:.0%} gefallen")
    for k, label in (("rows", "Aktien mit Daten"), ("rated", "bewertete Aktien")):
        if prev.get(k) and cur.get(k, 0) < 0.9 * prev[k]:
            out.append(f"{label}: von {prev[k]} auf {cur.get(k)} gefallen")
    return out


def alarm_markdown(alarms: list[str], meta: dict) -> str:
    lines = [f"## ⚠️ Datenqualitäts-Alarm · {meta['generated_at'][:16].replace('T', ' ')} UTC", "",
             "Im heutigen Lauf ist die Abdeckung wichtiger Kennzahlen gegenüber dem Vortag deutlich gefallen. "
             "Häufigste Ursache: Yahoo hat ein Datenfeld geändert oder blockiert Abrufe. Bis zur Klärung "
             "die Ratings mit Vorsicht nutzen.", ""]
    lines += [f"- {a}" for a in alarms]
    lines += ["", "Details: Screener → *Methodik & Daten*."]
    return "\n".join(lines)


def safe_name(sym: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", sym)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="state")
    ap.add_argument("--limit", type=int, default=0, help="nur die ersten N Aktien (Test)")
    ap.add_argument("--skip-sec", action="store_true")
    ap.add_argument("--sec-max", type=int, default=600)
    ap.add_argument("--hist-max", type=int, default=200)
    ap.add_argument("--alarm-file", default=None, help="Markdown-Datei für Datenqualitäts-Alarme")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    state = Path(args.state)
    public = state / "public"
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date().isoformat()
    t0 = time.time()

    prev_meta = (_load(public / "screener.json", {}) or {}).get("meta", {})
    uni, warnings = universe.load_universe(state)
    if args.limit:
        uni = uni[: args.limit]
    symbols = [u["symbol"] for u in uni]
    log.info("Universum: %d Aktien", len(symbols))

    # --- Kurse ---
    # 5 Jahre: für historisches KGV und Erfolgskontrolle; dazu Vergleichsindizes
    prices = fetch.fetch_prices(symbols + list(tracking.BENCHMARKS), period="5y")
    log.info("Kurse erhalten: %d/%d", len(prices), len(symbols))

    # --- Fundamentaldaten (mit Cache als Rückfallebene, max. 10 Tage alt) ---
    info_cache = _load(state / "info_cache.json", {})
    with ThreadPoolExecutor(args.workers) as ex:
        fresh = dict(zip(symbols, ex.map(fetch.fetch_info, symbols)))
    infos: dict[str, tuple[dict, str]] = {}
    for s in symbols:
        if fresh.get(s):
            info_cache[s] = {"date": today, "info": fresh[s]}
            infos[s] = (fresh[s], today)
        elif s in info_cache:
            age = (now.date() - dt.date.fromisoformat(info_cache[s]["date"])).days
            if age <= MAX_INFO_AGE_DAYS:
                infos[s] = (info_cache[s]["info"], info_cache[s]["date"])
    _save(state / "info_cache.json", info_cache)
    log.info("Fundamentaldaten: %d frisch, %d aus Cache", sum(1 for v in fresh.values() if v),
             len(infos) - sum(1 for v in fresh.values() if v))

    currencies = {i[0].get("currency") for i in infos.values()} | {i[0].get("financialCurrency") for i in infos.values()}
    fx = fetch.fetch_fx_to_eur({c for c in currencies if c})
    missing_fx = sorted(c for c in currencies if c and c not in fx)
    if missing_fx:
        warnings.append(f"Devisenkurse fehlen für {', '.join(missing_fx)} – betroffene Kennzahlen werden nicht berechnet")

    # --- Kennzahlen + Technik ---
    rows, failed, px_adj = [], [], {}
    meta_by_sym = {u["symbol"]: u for u in uni}
    for s in symbols:
        if s not in infos or s not in prices:
            failed.append(s)
            continue
        info, info_date = infos[s]
        px = prices[s]
        if info.get("currency") == "GBp":
            px = px.copy()
            px[["Open", "High", "Low", "Close"]] /= 100
        m, flags = metrics.derive(info, float(px["Close"].iloc[-1]), fx)
        if not m:
            failed.append(s)
            continue
        # Plausibilität: Live-Kurs vs. letzter Schlusskurs
        if abs(m["price"] / float(px["Close"].iloc[-1]) - 1) > 0.25:
            flags.append("kurs_vs_schluss_abweichung")
        t = technicals.compute(px)
        if (now.date() - dt.date.fromisoformat(t["last_date"])).days > MAX_PRICE_AGE_DAYS:
            flags.append("kurs_veraltet")
        if info_date != today:
            flags.append(f"fundamentaldaten_vom_{info_date}")
        u = meta_by_sym[s]
        rows.append({
            "symbol": s,
            "name": info.get("longName") or info.get("shortName") or u["name"],
            "indices": u["indices"], "region": u["region"],
            "sector": info.get("sector") or GICS_TO_YAHOO.get(u.get("gics_sector"), u.get("gics_sector")),
            "industry": info.get("industry"), "country": info.get("country"),
            "website": info.get("website"),
            "fund_date": info_date,
            **m, **t, "flags": flags,
        })
        px_adj[s] = px

    # --- SEC-Abgleich (US) – vor dem Scoring, weil er die Datenqualität bestimmt ---
    sec_cache = _load(state / "sec_cache.json", {})
    if not args.skip_sec:
        sec_cache, sec_warn = sec.refresh(uni, sec_cache, max_checks=args.sec_max)
        warnings += sec_warn
        _save(state / "sec_cache.json", sec_cache)
    for r in rows:
        if r["symbol"] in sec_cache:
            r["sec"] = {k: v for k, v in sec_cache[r["symbol"]].items() if k != "history"}
            if r["sec"].get("status") == "abweichung":
                r["flags"].append("sec_abweichung")

    # --- Mehrjahres-Historie: SEC (US, bis 10 J.) oder Yahoo-Jahresabschlüsse (übrige) ---
    hist_cache = _load(state / "hist_cache.json", {})
    if not args.skip_sec:
        hist_cache = history.refresh_yahoo(uni, hist_cache, max_checks=args.hist_max)
        _save(state / "hist_cache.json", hist_cache)
    for r in rows:
        s = r["symbol"]
        sc_ = sec_cache.get(s) or {}
        if sc_.get("history") and sc_.get("status") != "abweichung":
            years, source, same_cur = sc_["history"], "SEC 10-K", r.get("currency") == "USD"
        elif s in hist_cache:
            years, source = hist_cache[s].get("years", []), hist_cache[s].get("source", "Yahoo")
            same_cur = r.get("currency") == r.get("financial_currency")
        else:
            years, source, same_cur = [], None, False
        if years and r.get("shares_out"):
            years = [dict(y) for y in years]  # Cache nicht verändern
            if history.adjust_for_recent_split(years, r["shares_out"], r.get("eps_ttm")):
                r["flags"].append("split_nach_bericht_bereinigt")
        h = history.derive(years, px_adj[s]["Close"], same_currency=same_cur)
        # Normalisiertes KGV: Kurs (in Berichtswährung der Historie) / Ø-EPS 5 J.
        hist_cur = "USD" if source == "SEC 10-K" else r.get("financial_currency")
        cur = r.get("currency")
        if h.get("eps_norm5") and cur in fx and hist_cur in fx:
            price_h = r["price"] * fx[cur] / fx[hist_cur]
            r["pe_norm"] = price_h / h["eps_norm5"] if 0 < price_h / h["eps_norm5"] < 300 else None
            r["eps_norm_trading"] = h["eps_norm5"] * fx[hist_cur] / fx[cur]
        else:
            r["pe_norm"] = r["eps_norm_trading"] = None
        # Je-Aktie-Werte aus der Historie in Handelswährung (für den fairen Wert)
        conv = fx[hist_cur] / fx[cur] if (cur in fx and hist_cur in fx) else None
        for k_in, k_out in (("rev_ps_last", "rev_ps_trading"), ("owner_ps_last", "owner_ps_trading"),
                            ("sbc_ps_last", "sbc_ps_trading")):
            r[k_out] = h[k_in] * conv if (conv and h.get(k_in) is not None) else None
        # Plausibilität: Umsatz je Aktie aus der Historie vs. Yahoo (Umsatz 12 M. / Aktien der gehandelten Gattung).
        # Weicht er mehr als Faktor 2 ab (andere Aktiengattung, Einheitenfehler), werden die Je-Aktie-Werte verworfen.
        fin_cur = r.get("financial_currency")
        if r.get("rev_ps_trading") and r.get("revenue_fin") and r.get("shares_out") and fin_cur in fx and cur in fx:
            # Aktienzahl der gehandelten Gattung UND Gesamtzahl über alle Gattungen (Marktkap./Kurs) zulassen,
            # z.B. Alphabet: A-Aktien 5,8 Mrd., alle Gattungen 12,2 Mrd.
            ok = False
            for sh in (r["shares_out"], (r.get("market_cap") or 0) / r["price"] if r.get("price") else None):
                if sh:
                    y_rev_ps = r["revenue_fin"] / sh * fx[fin_cur] / fx[cur]
                    ok = ok or 0.6 < r["rev_ps_trading"] / y_rev_ps < 1.67
            if not ok:
                r["rev_ps_trading"] = r["owner_ps_trading"] = r["sbc_ps_trading"] = None
                r["flags"].append("historie_je_aktie_unplausibel")
        table = h.pop("hist_table", [])
        r.update(h)
        r["hist_source"] = source if h.get("hist_years", 0) >= 3 else None
        pe, peh = r.get("pe_ttm"), h.get("pe_hist_med5")
        r["pe_vs_hist"] = pe / peh - 1 if (pe and peh) else None
        r["implied_growth"] = targets.implied_growth(r.get("fcf_fin"), r.get("ev_fin"))
        for k in r.get("not_applicable") or []:
            r[k] = None
        _save(public / "px" / f"{safe_name(s)}.json", {
            "symbol": s, "currency": r["currency"],
            "d": [[i.strftime("%Y-%m-%d"), x.Open, x.High, x.Low, x.Close] for i, x in px_adj[s].iloc[-CHART_DAYS:].iterrows()],
            "hist": table, "hist_source": r["hist_source"], "hist_currency": "USD" if source == "SEC 10-K" else r.get("financial_currency"),
            # Steckbrief: Firmenprofil und Schlagzeilen (Yahoo) – nur hier, nicht in der großen Übersichtsdatei
            "profile": {k: infos[s][0].get(k) for k in ("longBusinessSummary", "fullTimeEmployees", "city", "country",
                                                        "website", "industry", "sector")},
            "news": infos[s][0].get("news") or [],
            "info_date": infos[s][1],
        })

    for r in rows:
        ed = r.get("earnings_date")
        days = (dt.date.fromisoformat(ed[:10]) - now.date()).days if ed else None
        r["earnings_in_days"] = days if days is not None and days >= 0 else None
        if days is not None and 0 <= days <= 7:
            r["flags"].append("zahlen_in_kuerze")

    df = pd.DataFrame(rows).set_index("symbol")
    sc = scoring.score(df)
    df = df.join(sc)
    df["flags"] = [f + x for f, x in zip(df["flags"], df["extra_flags"])]
    df = df.drop(columns=["extra_flags"])

    # --- Historie & Score-Veränderung ---
    hist = _load(state / "history.json", {})
    for s, v in df["score"].items():
        if v == v:
            h = [x for x in hist.get(s, []) if x[0] != today] + [[today, float(v)]]
            hist[s] = h[-HISTORY_KEEP:]
    _save(state / "history.json", hist)

    def change(s, days):
        h = hist.get(s, [])
        cutoff = (now.date() - dt.timedelta(days=days)).isoformat()
        old = [x for x in h if x[0] <= cutoff]
        return h[-1][1] - old[-1][1] if (old and h) else None

    prev_verdicts = _load(state / "verdicts.json", {})
    out_rows = []
    for s, r in df.iterrows():
        d = r.to_dict()
        d["symbol"] = s
        pct_pillars = {n: d.pop(f"p_{n}") for n in scoring.PILLARS}
        # Anzeige-Säulen: Qualität und Bewertung absolut (Qualitäts-Score, Preis-Score), übrige als Perzentil-Info
        d["pillars"] = {"Qualität": d.get("q_score"), "Bewertung": d.get("price_score"),
                        "Wachstum": (d.get("q_components") or {}).get("Wachstum"),
                        "Revisionen": pct_pillars.get("Revisionen"), "Trend": pct_pillars.get("Trend"),
                        "Analysten": pct_pillars.get("Analysten")}
        if not isinstance(d.get("sec"), dict):
            d.pop("sec", None)
        d.update(scoring.assess(d, prev_verdicts.get(s)))
        d["targets"] = None   # ersetzt durch d["valuation"] (fairer Wert, Kaufkurs, Szenarien)
        d["score_chg_1w"] = change(s, 7)
        d["score_chg_1m"] = change(s, 30)
        d["spark"] = [x[1] for x in hist.get(s, [])[-60:]]
        d.pop("composite", None)
        out_rows.append(d)

    flag_counts: dict[str, int] = {}
    for r in out_rows:
        for f in r["flags"]:
            key = "fundamentaldaten_aus_cache" if f.startswith("fundamentaldaten_vom_") else f
            flag_counts[key] = flag_counts.get(key, 0) + 1
    sec_status: dict[str, int] = {}
    for r in out_rows:
        st = (r.get("sec") or {}).get("status")
        if st:
            sec_status[st] = sec_status.get(st, 0) + 1

    _save(state / "verdicts.json", {r["symbol"]: r["verdict_code"] for r in out_rows})

    # --- Erfolgskontrolle (wöchentliche Kohorten, Rendite gegen Universum und Indizes) ---
    track = _load(state / "tracking.json", {})
    track = tracking.snapshot(track, now.date(), out_rows, scoring.MODEL_VERSION)
    _save(state / "tracking.json", track)
    track_eval = tracking.evaluate(track, {k: v["Close"] for k, v in prices.items()}, scoring.MODEL_VERSION)

    meta = {
        "generated_at": now.isoformat(timespec="seconds"),
        "runtime_s": round(time.time() - t0),
        "universe": len(symbols), "rated": int(df["score"].notna().sum()), "rows": len(out_rows),
        "failed": failed, "warnings": warnings, "flag_counts": flag_counts, "sec_status": sec_status,
        "fx_to_eur": fx,
        "tracking": track_eval,
        "watchlist": digest.load_watchlist(),
        "repo": os.environ.get("GITHUB_REPOSITORY", "alexanderlackendorf-sketch/AlexInvest"),
        "hist_sources": {src: sum(1 for r in out_rows if r.get("hist_source") == src)
                         for src in ("SEC 10-K", "Yahoo-Jahresabschlüsse")},
        "price_date_max": max((r["last_date"] for r in out_rows), default=None),
        "model": {"version": scoring.MODEL_VERSION, "w_quality": scoring.W_QUALITY, "w_price": scoring.W_PRICE,
                  "quality_weights": quality.WEIGHTS, "quality_weights_fin": quality.WEIGHTS_FIN,
                  "r_base": valuation.R_BASE, "r_fin": valuation.R_FIN, "g_max": valuation.G_MAX},
        "pillars": {n: {"weight": p["weight"], "in_score": p["in_score"],
                        "metrics": [[m, scoring.LABELS[m], hb] for m, hb in p["metrics"]]}
                    for n, p in scoring.PILLARS.items()},
        "peer_groups": sorted({r["peer_group"] for r in out_rows if isinstance(r.get("peer_group"), str)}),
        "verdicts": {c: sum(1 for r in out_rows if r["verdict_code"] == c)
                     for c in ("kandidat", "beobachten", "beobachten_teuer", "neutral", "meiden_teuer", "meiden_schwach", "meiden", "nab")},
        "sources": {
            "Kurse & Fundamentaldaten": "Yahoo Finance (via yfinance), täglich",
            "US-Abschlüsse (Gegenprüfung)": "SEC EDGAR XBRL companyfacts (10-K)",
            "Indexzusammensetzung": "Wikipedia (S&P 500, DAX)",
        },
    }
    # --- Datenqualitäts-Wächter ---
    n = max(len(out_rows), 1)
    def present(v):
        return v is not None and v == v  # NaN (aus pandas) zählt als fehlend

    meta["coverage_version"] = COVERAGE_VERSION
    meta["metric_coverage"] = {k: round(sum(1 for r in out_rows if present(r.get(k))) / n, 3) for k in WATCH_METRICS}
    alarms = [] if args.limit else quality_alarms(prev_meta, meta)  # Testläufe mit --limit nicht melden
    meta["quality_alarms"] = alarms
    if alarms:
        log.warning("Datenqualitäts-Alarm: %s", alarms)
        if args.alarm_file:
            Path(args.alarm_file).write_text(alarm_markdown(alarms, meta), encoding="utf-8")

    _save(public / "screener.json", {"meta": meta, "rows": out_rows})
    log.info("Fertig: %d Zeilen, %d bewertet, %d fehlgeschlagen, %ds", len(out_rows), meta["rated"], len(failed), meta["runtime_s"])
    if len(out_rows) < 0.5 * len(symbols):
        raise SystemExit("Weniger als 50 % der Aktien verarbeitet – Lauf als fehlgeschlagen markiert")


if __name__ == "__main__":
    main()
