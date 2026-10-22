"""Gegenprüfung US-Fundamentaldaten gegen die offiziellen SEC-EDGAR-XBRL-Daten (10-K).

Pro Lauf wird nur ein Teil der Firmen neu geprüft (rollierend, max. 1x pro Woche je Firma),
um die SEC-Fair-Access-Regeln (max. 10 Requests/s) deutlich zu unterschreiten.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import time

import requests

from . import fetch

log = logging.getLogger(__name__)

UA = {"User-Agent": os.environ.get("SEC_USER_AGENT", "AlexInvest-Screener github.com/alexanderlackendorf-sketch/AlexInvest")}
REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
]
TOLERANCE = 0.05


def ticker_cik_map() -> dict[str, int]:
    r = requests.get("https://www.sec.gov/files/company_tickers.json", headers=UA, timeout=30)
    r.raise_for_status()
    return {v["ticker"].upper().replace(".", "-"): int(v["cik_str"]) for v in r.json().values()}


def latest_annual(facts: dict, concepts: list[str], unit: str) -> dict | None:
    """Jüngster 10-K-Jahreswert über alle angegebenen Konzepte."""
    best = None
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for c in concepts:
        for rec in gaap.get(c, {}).get("units", {}).get(unit, []):
            if not str(rec.get("form", "")).startswith("10-K") or "start" not in rec:
                continue
            days = (dt.date.fromisoformat(rec["end"]) - dt.date.fromisoformat(rec["start"])).days
            if not 340 <= days <= 380:
                continue
            key = (rec["end"], rec.get("filed", ""))
            if best is None or key > (best["end"], best.get("filed", "")):
                best = {**rec, "concept": c}
    return best


def company_facts(cik: int) -> dict:
    r = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", headers=UA, timeout=60)
    r.raise_for_status()
    return r.json()


def _yahoo_value(stmt, rows: list[str], end: str):
    if stmt is None or stmt.empty:
        return None
    target = dt.date.fromisoformat(end)
    for col in stmt.columns:
        if abs((col.date() - target).days) <= 20:
            for row in rows:
                if row in stmt.index:
                    v = stmt.at[row, col]
                    if v == v:  # nicht NaN
                        return float(v)
    return None


def _cmp(sec_val, y_val):
    if sec_val is None or y_val is None or sec_val == 0:
        return None
    return abs(y_val - sec_val) / abs(sec_val)


def verify_company(symbol: str, cik: int) -> dict:
    facts = company_facts(cik)
    rev = latest_annual(facts, REVENUE_CONCEPTS, "USD")
    ni = latest_annual(facts, ["NetIncomeLoss"], "USD")
    eps = latest_annual(facts, ["EarningsPerShareDiluted"], "USD/shares")
    anchor = ni or rev
    res = {"checked": dt.date.today().isoformat(), "cik": cik, "status": "keine_10k_daten"}
    if anchor is None:
        return res
    stmt = fetch.fetch_income_annual(symbol)
    end = anchor["end"]
    rows = {
        "revenue": (rev, ["Total Revenue", "Operating Revenue"]),
        "net_income": (ni, ["Net Income", "Net Income Common Stockholders"]),
        "eps_diluted": (eps, ["Diluted EPS"]),
    }
    devs = []
    for key, (rec, yrows) in rows.items():
        sec_val = rec["val"] if rec and rec["end"] == end else None
        y_val = _yahoo_value(stmt, yrows, end)
        d = _cmp(sec_val, y_val)
        res[key] = {"sec": sec_val, "yahoo": y_val, "dev": d}
        if d is not None:
            devs.append(d)
    res.update({
        "fy_end": end,
        "filed": anchor.get("filed"),
        "accn": anchor.get("accn"),
        "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K",
    })
    if not devs:
        res["status"] = "kein_abgleich"
    elif max(devs) <= TOLERANCE:
        res["status"] = "bestaetigt"
    else:
        res["status"] = "abweichung"
    return res


def refresh(universe: list[dict], cache: dict, max_checks: int = 120) -> dict:
    """Aktualisiert den SEC-Cache rollierend. Ändert und liefert `cache`."""
    # US-Notierungen haben bei Yahoo kein Börsensuffix (20-F-Filer liefern keine 10-K-Daten -> Status bleibt offen)
    us = [u for u in universe if "." not in u["symbol"]]
    if not us:
        return cache
    try:
        cmap = ticker_cik_map()
    except Exception as e:  # noqa: BLE001
        log.warning("SEC Tickerliste nicht abrufbar: %s", e)
        cmap = {}
    today = dt.date.today()

    def age(sym):
        c = cache.get(sym)
        return 10_000 if not c else (today - dt.date.fromisoformat(c["checked"])).days

    todo = sorted((u for u in us if age(u["symbol"]) >= 7), key=lambda u: -age(u["symbol"]))[:max_checks]
    for u in todo:
        cik = u.get("cik") or cmap.get(u["symbol"])
        if not cik:
            continue
        try:
            cache[u["symbol"]] = verify_company(u["symbol"], int(cik))
        except Exception as e:  # noqa: BLE001
            log.warning("SEC-Prüfung %s fehlgeschlagen: %s", u["symbol"], e)
        time.sleep(0.25)
    return cache
