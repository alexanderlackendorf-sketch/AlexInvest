"""Schutz des Datenstands: Bevor der neue Stand den alten überschreibt, wird geprüft, dass nichts
Unersetzliches verloren geht (Erfolgskontrolle, Score-Historie, Vortagsurteile).

Aufruf: python -m screener.pipeline.guard --old state_prev --new state
Exit-Code 1 = Verlust erkannt -> der Workflow überschreibt den alten Stand NICHT und schlägt fehl
(GitHub verschickt dann eine Fehler-Mail).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Dateien, die sich nicht aus Quellen neu erzeugen lassen
IRREPLACEABLE = ["tracking.json", "history.json", "verdicts.json", "digest_state.json"]


def _load(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def check(old: Path, new: Path) -> list[str]:
    problems = []
    for name in IRREPLACEABLE:
        o, n = _load(old / name), _load(new / name)
        if o is None:
            continue
        if n is None:
            problems.append(f"{name}: fehlt oder ist beschädigt im neuen Stand")
            continue
        if name == "tracking.json":
            lost = set(o.get("snapshots", {})) - set(n.get("snapshots", {}))
            if lost:
                problems.append(f"tracking.json: {len(lost)} Kohorte(n) würden verloren gehen")
        elif name == "history.json":
            if len(n) < 0.8 * len(o):
                problems.append(f"history.json: nur noch {len(n)} statt {len(o)} Aktien")
            shorter = sum(1 for s, h in o.items() if s in n and len(n[s]) < min(len(h), 390))
            if shorter > 0.2 * max(len(o), 1):
                problems.append(f"history.json: Score-Verlauf bei {shorter} Aktien gekürzt")
        elif len(n) < 0.5 * len(o):
            problems.append(f"{name}: Umfang von {len(o)} auf {len(n)} Einträge gefallen")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    a = ap.parse_args(argv)
    problems = check(Path(a.old), Path(a.new))
    for p in problems:
        print("VERLUST:", p)
    if problems:
        sys.exit(1)
    print("Datenstand geprüft: keine Verluste")


if __name__ == "__main__":
    main()
