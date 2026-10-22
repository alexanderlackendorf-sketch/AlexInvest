"""End-to-End-Test der Pipeline mit synthetischen Daten (kein Netzwerk).

Die synthetischen Werte dienen nur dem Test der Logik und werden nie veröffentlicht.
Aufruf (aus dem Repo-Root): python -m unittest discover -s screener/tests -t .
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

from screener.pipeline import metrics, run, scoring, technicals, targets

SECTORS = ["Technology", "Healthcare", "Financial Services", "Industrials", "Energy"]


def fake_prices(seed, n=520, start=100.0, drift=0.0004):
    rng = np.random.default_rng(seed)
    close = start * np.exp(np.cumsum(rng.normal(drift, 0.015, n)))
    idx = pd.bdate_range(end="2026-10-21", periods=n)
    hi = close * (1 + rng.uniform(0, 0.01, n))
    lo = close * (1 - rng.uniform(0, 0.01, n))
    return pd.DataFrame({"Open": close, "High": hi, "Low": lo, "Close": close, "Volume": 1e6}, index=idx)


def fake_info(i, price):
    rng = np.random.default_rng(1000 + i)
    eps = float(rng.uniform(-1, 8))
    fin = SECTORS[i % 5] == "Financial Services"
    shares = 1e9
    return {
        "longName": f"Test {i}", "sector": SECTORS[i % 5], "currency": "USD", "financialCurrency": "USD",
        "currentPrice": price, "marketCap": price * shares, "sharesOutstanding": shares,
        "trailingEps": eps, "forwardEps": eps * float(rng.uniform(0.9, 1.3)) if eps > 0 else None,
        "trailingPE": price / eps if eps > 0 else None, "bookValue": float(rng.uniform(5, 60)),
        "totalRevenue": 2e10, "ebitda": None if fin else float(rng.uniform(1e9, 6e9)),
        "freeCashflow": float(rng.uniform(-1e9, 4e9)), "totalDebt": 5e9, "totalCash": 2e9,
        "revenueGrowth": float(rng.uniform(-0.1, 0.3)), "earningsGrowth": float(rng.uniform(-0.3, 0.5)),
        "returnOnEquity": float(rng.uniform(-0.1, 0.4)), "returnOnAssets": float(rng.uniform(0, 0.1)),
        "grossMargins": float(rng.uniform(0.2, 0.8)), "operatingMargins": float(rng.uniform(-0.05, 0.4)),
        "profitMargins": 0.1, "dividendRate": 1.0, "numberOfAnalystOpinions": 12,
        "targetMeanPrice": price * float(rng.uniform(0.9, 1.4)), "recommendationMean": float(rng.uniform(1.5, 3.5)),
    }


class PipelineTest(unittest.TestCase):
    def test_end_to_end(self):
        n = 60
        uni = [{"symbol": f"T{i}", "name": f"T{i}", "indices": ["S&P 500"], "region": "USA"} for i in range(n)]
        uni.append({"symbol": "BAD", "name": "kaputt", "indices": ["DAX"], "region": "Deutschland"})
        prices = {f"T{i}": fake_prices(i, drift=0.001 * ((i % 7) - 3)) for i in range(n)}
        infos = {f"T{i}": fake_info(i, float(prices[f"T{i}"]["Close"].iloc[-1])) for i in range(n)}

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(run.universe, "load_universe", return_value=(uni, [])), \
                mock.patch.object(run.fetch, "fetch_prices", return_value=prices), \
                mock.patch.object(run.fetch, "fetch_info", side_effect=lambda s: infos.get(s)), \
                mock.patch.object(run.fetch, "fetch_fx_to_eur", return_value={"EUR": 1.0, "USD": 0.9}):
            run.main(["--state", tmp, "--skip-sec", "--workers", "1"])
            data = json.loads((Path(tmp) / "public" / "screener.json").read_text())
            self.assertEqual(data["meta"]["failed"], ["BAD"])
            rows = data["rows"]
            self.assertEqual(len(rows), n)
            scores = [r["score"] for r in rows if r["score"] is not None]
            self.assertGreater(len(scores), n * 0.8)
            self.assertTrue(all(1 <= s <= 10 for s in scores))
            self.assertTrue((Path(tmp) / "public" / "px" / "T0.json").exists())
            # Verlustbringer haben kein KGV und keine Modell-Kursziele
            for r in rows:
                if r["loss_making"]:
                    self.assertIsNone(r["pe_ttm"])
                    self.assertIsNone(r["targets"])
            # Zweiter Lauf: Historie wächst nicht doppelt am selben Tag
            run.main(["--state", tmp, "--skip-sec", "--workers", "1"])
            hist = json.loads((Path(tmp) / "history.json").read_text())
            self.assertEqual(len(hist["T0"]), 1)


class MetricsTest(unittest.TestCase):
    def test_inconsistent_pe_is_dropped(self):
        info = {"currency": "USD", "financialCurrency": "USD", "currentPrice": 100, "trailingEps": 5, "trailingPE": 40}
        m, flags = metrics.derive(info, 100, {"EUR": 1, "USD": 0.9})
        self.assertIsNone(m["pe_ttm"])
        self.assertIn("kgv_inkonsistent", flags)

    def test_pence_and_currency_conversion(self):
        info = {"currency": "GBp", "financialCurrency": "USD", "currentPrice": 2500, "trailingEps": 2.5,
                "sharesOutstanding": 1e9}
        m, flags = metrics.derive(info, 2500, {"EUR": 1, "USD": 0.9, "GBP": 1.15, "GBp": 0.0115})
        self.assertAlmostEqual(m["price"], 25.0)
        # 25 GBP = 25*1.15/0.9 USD = 31.94 USD -> KGV 12.78
        self.assertAlmostEqual(m["pe_ttm"], 25 * 1.15 / 0.9 / 2.5, places=4)
        self.assertIn("waehrung_umgerechnet", flags)

    def test_yahoo_unconverted_mixed_currency(self):
        # Shell-Fall: Yahoo teilt GBP-Kurs durch USD-EPS ohne Umrechnung -> trotzdem bestätigt, eigener Wert gilt
        info = {"currency": "GBp", "financialCurrency": "USD", "currentPrice": 3966, "trailingEps": 3.38,
                "trailingPE": 11.7337, "sharesOutstanding": 5.688e9}
        fx = {"EUR": 1, "USD": 0.8928, "GBP": 1.1937, "GBp": 0.011937}
        m, flags = metrics.derive(info, 3966, fx)
        self.assertAlmostEqual(m["pe_ttm"], 39.66 * 1.1937 / 0.8928 / 3.38, places=3)
        self.assertNotIn("kgv_inkonsistent", flags)

    def test_missing_stays_missing(self):
        m, _ = metrics.derive({"currency": "EUR", "currentPrice": 10}, 10, {"EUR": 1})
        for k in ("pe_ttm", "pe_fwd", "ev_ebitda", "roe", "analyst_upside", "div_yield"):
            self.assertIsNone(m[k], k)


class TechnicalsTest(unittest.TestCase):
    def test_buy_zone_below_price(self):
        df = fake_prices(3, drift=0.001)
        t = technicals.compute(df)
        for z in t["buy_zones"]:
            self.assertLess(z["low"], t["last_close"] * 1.05)
        self.assertTrue(0 <= t["rsi14"] <= 100)


class TargetsTest(unittest.TestCase):
    def test_targets(self):
        t = targets.model_targets({"eps_fwd": 5, "pe_fwd": 20, "price": 100, "eps_growth_fwd": 0.10}, 20)
        self.assertAlmostEqual(t["y1"], 5 * 1.1 * 20, places=2)
        self.assertIsNone(targets.model_targets({"eps_fwd": -1, "pe_fwd": None, "price": 10}, 15))


if __name__ == "__main__":
    unittest.main()
