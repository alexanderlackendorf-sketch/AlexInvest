"""Deutsche Zahlenformate für Texte, die in der Oberfläche erscheinen (21,7 % statt 21.7%)."""
from __future__ import annotations


def de(v, d: int = 1, pct: bool = True, sign: bool = False) -> str:
    if v is None or v != v:
        return "n/a"
    x = v * 100 if pct else v
    s = f"{x:{'+' if sign else ''},.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " %" if pct else s
