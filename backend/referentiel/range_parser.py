"""
Parsing des valeurs du référentiel v3 (texte français) vers des nombres.

Le référentiel stocke des plages sous forme littérale, avec virgule décimale,
séparateur de milliers par espace, tiret cadratin/demi-cadratin, et parfois un
préfixe/suffixe (« IC 1,8–2,2 », « 2,5–3,5 USD/kg vif », « 600–1 200 / an »,
« 8 % »). On n'invente jamais : une valeur illisible renvoie None (→ le contrôle
concerné deviendra `NON ÉVALUABLE`, PROMPT §1/§4).
"""
from __future__ import annotations

import re

# Tirets acceptés comme séparateurs de plage : hyphen, non-breaking hyphen,
# figure dash, en dash, em dash, minus sign.
_DASHES = "-‐‑‒–—−"
_NUMBER_RE = re.compile(r"[-+]?\d[\d   ]*(?:[.,]\d+)?")


def to_number(value) -> float | None:
    """Convertit une valeur cellule (nombre déjà typé ou texte FR) en float."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    m = _NUMBER_RE.search(text)
    if not m:
        return None
    return _clean_number(m.group(0))


def _clean_number(token: str) -> float | None:
    # Retire les séparateurs de milliers (espaces, espaces insécables) puis
    # normalise la virgule décimale.
    t = token.replace(" ", "").replace(" ", "").replace(" ", "")
    t = t.replace(",", ".")
    # Un éventuel point de milliers résiduel (rare ici) : garder le dernier point.
    if t.count(".") > 1:
        head, _, tail = t.rpartition(".")
        t = head.replace(".", "") + "." + tail
    try:
        return float(t)
    except ValueError:
        return None


def to_range(value) -> tuple[float | None, float | None]:
    """
    Extrait (min, max) d'une plage textuelle. Une valeur unique donne (v, v).
    « 8 % » → (0.08, 0.08). Renvoie (None, None) si rien d'exploitable.
    """
    if value is None or value == "":
        return (None, None)
    if isinstance(value, (int, float)):
        return (float(value), float(value))

    text = str(value).strip()
    is_percent = "%" in text
    # Isole tous les nombres présents (gère préfixes « IC », suffixes « USD/kg »).
    numbers = [_clean_number(m.group(0)) for m in _NUMBER_RE.finditer(text)]
    numbers = [n for n in numbers if n is not None]
    if not numbers:
        return (None, None)

    if len(numbers) == 1:
        lo = hi = numbers[0]
    else:
        # Plage explicite « a–b » : bornes = premier et deuxième nombre.
        lo, hi = numbers[0], numbers[1]
        if lo > hi:
            lo, hi = hi, lo

    if is_percent:
        lo = lo / 100.0 if lo is not None else None
        hi = hi / 100.0 if hi is not None else None
    return (lo, hi)


def has_range_separator(value) -> bool:
    """Vrai si le texte contient un séparateur de plage (deux bornes attendues)."""
    if value is None:
        return False
    return any(d in str(value) for d in _DASHES if d != "-") or "-" in str(value)
