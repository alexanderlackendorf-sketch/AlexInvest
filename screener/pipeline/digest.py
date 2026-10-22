"""Wochen-Digest als Markdown (wird vom Workflow als Kommentar in ein GitHub-Issue gepostet;
GitHub verschickt daraus die E-Mail-Benachrichtigung).

Aufruf: python -m screener.pipeline.digest --state state --out digest.md --site URL --mention USER
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

WATCHLIST = Path(__file__).resolve().parent.parent / "config" / "watchlist.json"
AMPEL = {"gruen": "🟢", "gelb": "🟡", "rot": "🔴", "grau": "⚪"}
AMPEL_KEYS = ["Qualität", "Bewertung", "Wachstum", "Daten", "Einstieg"]
IDEA_CODES = ("kandidat", "beobachten")
VERDICT_SHORT = {"kandidat": "Kandidat", "beobachten": "Beobachten", "beobachten_teuer": "gut, aber zu teuer",
                 "neutral": "kein Vorteil", "meiden_teuer": "Meiden – zu teuer", "meiden_schwach": "Meiden – schwach",
                 "meiden": "Meiden", "nab": "nicht beurteilbar"}


def _p(v, d=0, sign=True):
    if v is None:
        return "–"
    s = f"{v * 100:+.{d}f} %" if sign else f"{v * 100:.{d}f} %"
    return s.replace(".", ",")


def _n(v, d=1):
    return "–" if v is None else f"{v:.{d}f}".replace(".", ",")


def ampeln(r) -> str:
    a = r.get("ampeln") or {}
    return "".join(AMPEL[a.get(k, "grau")] for k in AMPEL_KEYS)


def why(r) -> str:
    """Kurzbegründung aus den stärksten belegten Kennzahlen."""
    parts = []
    if r.get("roic_med5") is not None:
        parts.append(f"ROIC 5J {_p(r['roic_med5'], 0, False)}")
    if r.get("pe_fwd") is not None:
        h = f" ({_p(r['pe_vs_hist'])} vs. Historie)" if r.get("pe_vs_hist") is not None else ""
        parts.append(f"KGV fwd {_n(r['pe_fwd'])}{h}")
    if r.get("rev_cagr") is not None:
        parts.append(f"Umsatz 5J {_p(r['rev_cagr'], 0)} p.a.")
    if r.get("rev_eps_90d") is not None:
        parts.append(f"Revision 90T {_p(r['rev_eps_90d'], 1)}")
    t = r.get("targets") or {}
    if t.get("margin_of_safety") is not None:
        parts.append(f"Sicherheitsmarge {_p(t['margin_of_safety'], 0)}")
    return " · ".join(parts[:4]) or "–"


def line(r, site) -> str:
    return f"[**{r['symbol']}**]({site}#{r['symbol']}) {r['name'][:32]}"


def table(rows, site, third) -> list[str]:
    out = ["| Aktie | Score & Ampeln (Q B W D E) | " + third[0] + " |", "|---|---|---|"]
    for r in rows:
        sc = _n(r.get("score")) if r.get("score") is not None else "–"
        out.append(f"| {line(r, site)} | {sc} {ampeln(r)} | {third[1](r)} |")
    return out


def build(data: dict, prev: dict, watch: list[str], site: str, mention: str | None, today: dt.date) -> tuple[str, dict]:
    rows = {r["symbol"]: r for r in data["rows"]}
    meta = data["meta"]
    pv = prev.get("verdicts", {})
    pzone = set(prev.get("zone", []))
    first = not pv
    cand = sorted((r for r in rows.values() if r["verdict_code"] == "kandidat"), key=lambda r: -(r["score"] or 0))
    new_c = [r for r in cand if pv.get(r["symbol"]) != "kandidat"]
    lost_c = [rows[s] for s, c in pv.items() if c == "kandidat" and s in rows and rows[s]["verdict_code"] != "kandidat"]
    zone_now = {s for s, r in rows.items() if r["verdict_code"] in IDEA_CODES and r.get("in_buy_zone")}
    new_zone = sorted((rows[s] for s in zone_now - pzone), key=lambda r: -(r["score"] or 0))
    soon = sorted((r for r in rows.values() if r.get("earnings_in_days") is not None and r["earnings_in_days"] <= 7
                   and (r["verdict_code"] == "kandidat" or r["symbol"] in watch)),
                  key=lambda r: r["earnings_in_days"])

    kw = today.isocalendar()[1]
    md = [f"## 📬 Screener-Digest KW {kw} · {today.strftime('%d.%m.%Y')}", ""]
    if mention:
        md += [f"@{mention}", ""]
    md += [f"Datenstand {meta['generated_at'][:16].replace('T', ' ')} UTC · Kurse bis {meta.get('price_date_max')} · "
           f"{meta['rated']} bewertete Aktien · [Screener öffnen]({site})", ""]

    md += [f"### 🆕 Neue Kandidaten für Einzelanalyse ({len(new_c)})" if not first
           else f"### Kandidaten für Einzelanalyse ({len(cand)}) – erster Digest", ""]
    sel = cand if first else new_c
    md += (table(sel[:15], site, ("Warum interessant", why)) if sel else ["Keine neuen Kandidaten diese Woche."]) + [""]

    if not first:
        md += [f"### ↘️ Nicht mehr Kandidat ({len(lost_c)})", ""]
        md += (table(lost_c[:15], site, ("Neues Urteil", lambda r: r["verdict"])) if lost_c else ["Keine."]) + [""]

    md += [f"### 🎯 Neu in Buy-Zone 1 (Kandidat/Beobachten, {len(new_zone)})", ""]
    md += (table(new_zone[:15], site, ("Urteil", lambda r: r["verdict"])) if new_zone else ["Keine."]) + [""]

    md += ["### 👁 Watchlist", ""]
    if not watch:
        md += ["Noch keine Watchlist im Repo. Im Screener unter *Watchlist → Für den Wochen-Digest übernehmen* eintragen.", ""]
    else:
        wl = [rows[s] for s in watch if s in rows]
        changed = [r for r in wl if pv.get(r["symbol"]) not in (None, r["verdict_code"])]
        md += [f"{len(wl)} Werte · Urteilswechsel seit letzter Woche: {len(changed)}", ""]
        md += table(wl, site, ("Urteil (vorher)", lambda r: r["verdict"] + (
            f" *(vorher: {VERDICT_SHORT.get(pv.get(r['symbol']), pv.get(r['symbol']))})*" if pv.get(r["symbol"]) not in (None, r["verdict_code"]) else ""))) + [""]

    md += ["### 📅 Quartalszahlen in den nächsten 7 Tagen (Kandidaten & Watchlist)", ""]
    md += ([f"- {line(r, site)}: {dt.date.fromisoformat(r['earnings_date'][:10]).strftime('%d.%m.')} · {r['verdict']}"
            for r in soon] or ["Keine."]) + [""]

    if not first:
        md += ["### 🏆 Top 10 Kandidaten aktuell", ""]
        md += table(cand[:10], site, ("Warum interessant", why)) + [""]

    t = (meta.get("tracking") or {}).get("horizons", {})
    done = {h: v for h, v in t.items() if v.get("cohorts")}
    md += ["### 📊 Erfolgskontrolle", ""]
    if done:
        md += [" · ".join(f"{h}: Kandidaten {_p(v.get('kandidat'), 1)} vs. Universum {_p(v.get('universe'), 1)} "
                          f"({v['cohorts']} Kohorten)" for h, v in done.items()), ""]
    else:
        md += [f"Noch kein Horizont abgeschlossen (Start {meta.get('tracking', {}).get('since')}).", ""]
    md += ["---", "<sub>Regelbasierter Screener, keine Anlageberatung. „Kandidat“ heißt: lohnt eine Einzelanalyse "
           "nach den Projekt-Regeln, nicht „kaufen“.</sub>"]

    state = {"date": today.isoformat(), "verdicts": {s: r["verdict_code"] for s, r in rows.items()},
             "zone": sorted(zone_now)}
    return "\n".join(md), state


def load_watchlist() -> list[str]:
    try:
        return [s.strip() for s in json.loads(WATCHLIST.read_text(encoding="utf-8")).get("symbols", []) if s.strip()]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="state")
    ap.add_argument("--out", default="digest.md")
    ap.add_argument("--site", default="")
    ap.add_argument("--mention", default=None)
    a = ap.parse_args(argv)
    state = Path(a.state)
    data = json.loads((state / "public" / "screener.json").read_text(encoding="utf-8"))
    prev_file = state / "digest_state.json"
    prev = json.loads(prev_file.read_text()) if prev_file.exists() else {}
    md, new_state = build(data, prev, load_watchlist(), a.site.rstrip("/") + "/", a.mention, dt.date.today())
    Path(a.out).write_text(md, encoding="utf-8")
    prev_file.write_text(json.dumps(new_state), encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
