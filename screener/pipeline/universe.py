"""Aktienuniversum: S&P 500 + DAX (live von Wikipedia) + kuratierte Weltliste.

Fällt der Live-Abruf aus, wird das zuletzt erfolgreich geladene Universum aus dem
State verwendet, erst danach die statische Fallback-Liste aus config/universe.json.
"""
from __future__ import annotations

import json
import logging
import re
from io import StringIO
from pathlib import Path

import pandas as pd
import requests

log = logging.getLogger(__name__)

CONFIG = Path(__file__).resolve().parent.parent / "config" / "universe.json"
UA = {"User-Agent": "Mozilla/5.0 (AlexInvest-Screener; github.com/alexanderlackendorf-sketch/AlexInvest)"}
SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
DAX_URL = "https://en.wikipedia.org/wiki/DAX"


def _read_tables(url: str) -> list[pd.DataFrame]:
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    return pd.read_html(StringIO(r.text))


def yahoo_symbol_us(sym: str) -> str:
    # Wikipedia nutzt BRK.B, Yahoo BRK-B
    return sym.strip().replace(".", "-")


def fetch_sp500() -> list[dict]:
    tables = _read_tables(SP500_URL)
    df = next(t for t in tables if "Symbol" in t.columns and "GICS Sector" in t.columns)
    out = []
    for _, row in df.iterrows():
        cik = row.get("CIK")
        out.append({
            "symbol": yahoo_symbol_us(str(row["Symbol"])),
            "name": str(row["Security"]),
            "indices": ["S&P 500"],
            "region": "USA",
            "gics_sector": str(row["GICS Sector"]),
            "cik": int(cik) if pd.notna(cik) else None,
        })
    if not 480 <= len(out) <= 520:
        raise ValueError(f"S&P-500-Tabelle unplausibel: {len(out)} Einträge")
    return out


def _normalize_de_ticker(raw: str) -> str | None:
    raw = str(raw).strip()
    if not raw or raw.lower() == "nan":
        return None
    raw = raw.split(":")[-1].strip().split()[0]
    raw = re.sub(r"[^A-Za-z0-9.\-]", "", raw).upper()
    if not raw:
        return None
    return raw if "." in raw else f"{raw}.DE"


def fetch_dax() -> list[dict]:
    tables = _read_tables(DAX_URL)
    for t in tables:
        cols = [str(c) for c in t.columns]
        tcol = next((c for c in cols if re.search(r"ticker|symbol", c, re.I)), None)
        ncol = next((c for c in cols if re.search(r"company|name", c, re.I)), None)
        if tcol is None or ncol is None or not 38 <= len(t) <= 42:
            continue
        out = []
        for _, row in t.iterrows():
            sym = _normalize_de_ticker(row[tcol])
            if sym:
                out.append({"symbol": sym, "name": str(row[ncol]), "indices": ["DAX"], "region": "Deutschland"})
        if 38 <= len(out) <= 42:
            return out
    raise ValueError("DAX-Tabelle auf Wikipedia nicht gefunden")


def load_universe(state_dir: Path) -> tuple[list[dict], list[str]]:
    """Gibt (Liste der Aktien, Warnungen) zurück."""
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cache_file = state_dir / "universe_cache.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    warnings: list[str] = []

    try:
        sp = fetch_sp500()
        cache["sp500"] = sp
    except Exception as e:  # noqa: BLE001
        warnings.append(f"S&P 500 Live-Abruf fehlgeschlagen ({e}); nutze letzten Stand")
        sp = cache.get("sp500")
        if not sp:
            fallback = Path(__file__).resolve().parents[2] / "prisma" / "constituents.json"
            sp = [{"symbol": yahoo_symbol_us(x["symbol"]), "name": x["name"], "indices": ["S&P 500"],
                   "region": "USA", "cik": None} for x in json.loads(fallback.read_text())["sp500"]]

    try:
        dax = fetch_dax()
        cache["dax"] = dax
    except Exception as e:  # noqa: BLE001
        warnings.append(f"DAX Live-Abruf fehlgeschlagen ({e}); nutze letzten Stand")
        dax = cache.get("dax") or [
            {"symbol": s, "name": n, "indices": ["DAX"], "region": "Deutschland"} for s, n in cfg["dax_fallback"]
        ]

    glob = [{"symbol": s, "name": n, "indices": ["Global"], "region": r} for s, n, r in cfg["global"]]

    state_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(cache, ensure_ascii=False))

    merged: dict[str, dict] = {}
    for item in sp + dax + glob:
        if item["symbol"] in merged:
            merged[item["symbol"]]["indices"] = sorted(set(merged[item["symbol"]]["indices"]) | set(item["indices"]))
        else:
            merged[item["symbol"]] = dict(item)
    return list(merged.values()), warnings
