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
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from . import fetch, metrics, scoring, sec, technicals, targets, universe

log = logging.getLogger("screener")
MAX_INFO_AGE_DAYS = 10
HISTORY_KEEP = 400


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


def safe_name(sym: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", sym)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="state")
    ap.add_argument("--limit", type=int, default=0, help="nur die ersten N Aktien (Test)")
    ap.add_argument("--skip-sec", action="store_true")
    ap.add_argument("--sec-max", type=int, default=120)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    state = Path(args.state)
    public = state / "public"
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date().isoformat()
    t0 = time.time()

    uni, warnings = universe.load_universe(state)
    if args.limit:
        uni = uni[: args.limit]
    symbols = [u["symbol"] for u in uni]
    log.info("Universum: %d Aktien", len(symbols))

    # --- Kurse ---
    prices = fetch.fetch_prices(symbols)
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

    # --- Kennzahlen + Technik ---
    rows, failed = [], []
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
        if info_date != today:
            flags.append(f"fundamentaldaten_vom_{info_date}")
        u = meta_by_sym[s]
        rows.append({
            "symbol": s,
            "name": info.get("longName") or info.get("shortName") or u["name"],
            "indices": u["indices"], "region": u["region"],
            "sector": info.get("sector") or u.get("gics_sector"),
            "industry": info.get("industry"), "country": info.get("country"),
            "website": info.get("website"),
            "fund_date": info_date,
            **m, **t, "flags": flags,
        })
        _save(public / "px" / f"{safe_name(s)}.json", {
            "symbol": s, "currency": m["currency"],
            "d": [[i.strftime("%Y-%m-%d"), r.Open, r.High, r.Low, r.Close] for i, r in px.iterrows()],
        })

    df = pd.DataFrame(rows).set_index("symbol")
    sc = scoring.score(df)
    df = df.join(sc)
    sector_pe = df.groupby("sector")["pe_fwd"].median().to_dict()

    # --- SEC-Abgleich (US) ---
    sec_cache = _load(state / "sec_cache.json", {})
    if not args.skip_sec:
        sec_cache = sec.refresh(uni, sec_cache, max_checks=args.sec_max)
        _save(state / "sec_cache.json", sec_cache)

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

    out_rows = []
    for s, r in df.iterrows():
        d = r.to_dict()
        d["symbol"] = s
        d["pillars"] = {n: d.pop(f"p_{n}") for n in scoring.PILLARS}
        d["targets"] = targets.model_targets(d, sector_pe.get(d.get("sector")))
        d["verdict"] = scoring.verdict(d.get("score"), d.get("in_buy_zone"), d.get("trend"))
        d["score_chg_1w"] = change(s, 7)
        d["score_chg_1m"] = change(s, 30)
        d["spark"] = [x[1] for x in hist.get(s, [])[-60:]]
        if s in sec_cache:
            d["sec"] = sec_cache[s]
            if sec_cache[s].get("status") == "abweichung":
                d["flags"] = d["flags"] + ["sec_abweichung"]
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

    meta = {
        "generated_at": now.isoformat(timespec="seconds"),
        "runtime_s": round(time.time() - t0),
        "universe": len(symbols), "rated": int(df["score"].notna().sum()), "rows": len(out_rows),
        "failed": failed, "warnings": warnings, "flag_counts": flag_counts, "sec_status": sec_status,
        "fx_to_eur": fx,
        "price_date_max": max((r["last_date"] for r in out_rows), default=None),
        "pillars": {n: {"weight": p["weight"], "metrics": [[m, scoring.LABELS[m], hb] for m, hb in p["metrics"]]}
                    for n, p in scoring.PILLARS.items()},
        "sources": {
            "Kurse & Fundamentaldaten": "Yahoo Finance (via yfinance), täglich",
            "US-Abschlüsse (Gegenprüfung)": "SEC EDGAR XBRL companyfacts (10-K)",
            "Indexzusammensetzung": "Wikipedia (S&P 500, DAX)",
        },
    }
    _save(public / "screener.json", {"meta": meta, "rows": out_rows})
    log.info("Fertig: %d Zeilen, %d bewertet, %d fehlgeschlagen, %ds", len(out_rows), meta["rated"], len(failed), meta["runtime_s"])
    if len(out_rows) < 0.5 * len(symbols):
        raise SystemExit("Weniger als 50 % der Aktien verarbeitet – Lauf als fehlgeschlagen markiert")


if __name__ == "__main__":
    main()
