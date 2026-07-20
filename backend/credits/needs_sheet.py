"""
Feuille de besoins client → DataSource `dataio` (chantier 1 de la SPEC).

Principe 1 du module : **ce qui est scoré = ce qui est en base.** Le classeur du
client n'est plus lu en mémoire puis jeté : il est validé, ingéré en tables
génériques (`DataSource → DataTable → DataColumn → DataRecord`) et rattaché au
dossier. La simulation et le scoring lisent ensuite les `DataRecord` de la
révision courante — jamais le fichier, jamais un payload client.

Pipeline (principe 5 — valider avant d'ingérer, ingérer avant de calculer) :

    upload → structure (feuilles, colonnes, rubriques)
           → types (quantité / prix / total numériques ≥ 0)
           → cohérence interne (Σ feuille 4 par rubrique = feuille 5, TOTAL = Σ)
           → ingestion dataio (commit, nouvelle révision)
           → extraction des totaux depuis les DataRecord

Arrêt au premier étage en échec, mais TOUTES les erreurs de cet étage sont
collectées et renvoyées en 422 structuré `{code, message}` — jamais un message
générique.
"""
from __future__ import annotations

import unicodedata
from decimal import Decimal, InvalidOperation

import openpyxl

from dataio import services as dataio_services
from dataio.models import DataSource, KIND_FEUILLE_BESOINS

CENT = Decimal("0.01")

SHEET_BESOINS = "4_Besoins_Financiers"
SHEET_SYNTHESE = "5_Synthese_Besoins"
REQUIRED_SHEETS = (SHEET_BESOINS, SHEET_SYNTHESE)

#: Les 8 modules du simulateur — nomenclature canonique (cf. `NeedItem.MODULES`).
MODULE_CODES = (
    "semences", "mecanisation", "maindoeuvre", "equipements",
    "postrecolte", "logistique", "commercialisation", "reserve",
)

MODULE_LABELS = {
    "semences": "Semences & Intrants",
    "mecanisation": "Opérations mécanisées",
    "maindoeuvre": "Main d'œuvre",
    "equipements": "Équipement & petit matériel",
    "postrecolte": "Récolte & post-récolte",
    "logistique": "Logistique",
    "commercialisation": "Commercialisation",
    "reserve": "Réserve d'exploitation",
}

#: Rôles de colonne attendus en feuille 4 → fragments d'en-tête acceptés.
#: L'ordre des rôles compte : « coût unitaire » est cherché avant « total », sinon
#: « Montant total » capterait le rôle prix.
COLUMN_ROLES_F4 = (
    ("rubrique", "Rubrique", ("rubrique",)),
    ("designation", "Désignation", ("description", "designation", "libelle", "intitule")),
    ("quantite", "Quantité", ("quantite", "qte")),
    ("prix_unitaire", "Prix unitaire", ("cout unitaire", "prix unitaire", "prix/u", "cout/u")),
    ("total", "Total", ("montant total", "total")),
)

COLUMN_ROLES_F5 = (
    ("rubrique", "Rubrique", ("rubrique",)),
    ("total", "Total rubrique", ("total rubrique", "montant total", "total", "montant")),
)

#: Colonne facultative de la feuille 4 : le total ligne vaut Qté × PU × Fréquence.
FREQUENCE_FRAGMENTS = ("frequence", "nb de fois", "recurrence")


class NeedsSheetValidationError(Exception):
    """Le classeur est refusé. `errors` = liste de `{code, message}` (→ 422)."""

    def __init__(self, errors: list[dict]) -> None:
        self.errors = errors
        super().__init__("; ".join(e["message"] for e in errors))


# ── Normalisation ─────────────────────────────────────────────────────────────

def normalize(text) -> str:
    """Minuscule, sans accent, espaces compactés — base de toute comparaison."""
    if text is None:
        return ""
    s = unicodedata.normalize("NFD", str(text))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.lower().split())


#: Fragment de rubrique (normalisé) → code module. Premier fragment trouvé gagne,
#: d'où l'ordre : « equipement » avant « materiel », « mecanis » avant « operation ».
_RUBRIQUE_FRAGMENTS: tuple[tuple[str, str], ...] = (
    ("semence", "semences"),
    ("intrant", "semences"),
    ("mecanis", "mecanisation"),
    ("main", "maindoeuvre"),
    ("oeuvre", "maindoeuvre"),
    ("equipement", "equipements"),
    ("materiel", "equipements"),
    ("recolte", "postrecolte"),
    ("logistique", "logistique"),
    ("commercialisation", "commercialisation"),
    ("reserve", "reserve"),
)


def rubrique_to_module(rubrique) -> str | None:
    """Code module d'une rubrique du classeur, ou `None` si non reconnue."""
    low = normalize(rubrique)
    if not low or is_total_row(low):
        return None
    for fragment, code in _RUBRIQUE_FRAGMENTS:
        if fragment in low:
            return code
    return None


def is_total_row(rubrique) -> bool:
    """True pour la ligne « TOTAL GÉNÉRAL » (et ses variantes) de la feuille 5."""
    low = normalize(rubrique)
    return low.startswith("total") or "total general" in low


def to_decimal(value) -> Decimal | None:
    """Décimal d'une cellule Excel OU d'une valeur `DataRecord` (toujours du texte).

    `None` si la valeur n'est pas un nombre — le contrôle `TYPE_INVALIDE` s'appuie
    dessus. Aucun `float` n'est utilisé : principe 4.
    """
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    s = str(value).strip().replace(" ", "").replace(" ", "")
    if not s:
        return None
    # 1 234,56 → 1234.56 ; on ne devine jamais un séparateur de milliers ambigu.
    if "," in s and "." not in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _q(value: Decimal) -> Decimal:
    from decimal import ROUND_HALF_UP
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


# ── Repérage des colonnes ─────────────────────────────────────────────────────

def _map_columns(header: list[str], roles) -> dict[str, int]:
    """Rôle de colonne → index, en respectant l'ordre de priorité des rôles."""
    taken: set[int] = set()
    found: dict[str, int] = {}
    normalized = [normalize(h) for h in header]
    for role, _label, fragments in roles:
        for fragment in fragments:
            idx = next(
                (i for i, h in enumerate(normalized)
                 if i not in taken and h and fragment in h),
                None,
            )
            if idx is not None:
                found[role] = idx
                taken.add(idx)
                break
    return found


def _find_frequence(header: list[str], used: set[int]) -> int | None:
    for i, h in enumerate(header):
        if i in used:
            continue
        n = normalize(h)
        if any(f in n for f in FREQUENCE_FRAGMENTS):
            return i
    return None


def _cell(row: tuple, idx: int | None):
    if idx is None or idx >= len(row):
        return None
    return row[idx]


# ── Validation (les 6 contrôles de la SPEC) ───────────────────────────────────

def validate_needs_sheet(path: str) -> list[dict]:
    """Valide un classeur de feuille de besoins. Retourne `[]` si tout passe.

    Étages successifs : structure → types → cohérence. On s'arrête au premier
    étage en échec mais on remonte TOUTES ses erreurs (principe 5).
    """
    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except Exception as exc:  # classeur illisible / corrompu
        return [{"code": "CLASSEUR_ILLISIBLE",
                 "message": f"Le classeur n'a pas pu être ouvert : {exc}"}]
    try:
        return _validate_workbook(wb)
    finally:
        wb.close()


def _validate_workbook(wb) -> list[dict]:
    # ── Étage 1 : feuilles présentes ─────────────────────────────────────────
    sheets = {normalize(n): n for n in wb.sheetnames}
    missing = [s for s in REQUIRED_SHEETS if normalize(s) not in sheets]
    if missing:
        return [{
            "code": "FEUILLE_MANQUANTE",
            "message": (f"La feuille « {s} » est absente du classeur. "
                        f"Utilisez le modèle officiel AGRICAP sans renommer les feuilles."),
        } for s in missing]

    ws4 = wb[sheets[normalize(SHEET_BESOINS)]]
    ws5 = wb[sheets[normalize(SHEET_SYNTHESE)]]
    header4, rows4 = dataio_services.sheet_rows(ws4)
    header5, rows5 = dataio_services.sheet_rows(ws5)

    cols4 = _map_columns(header4, COLUMN_ROLES_F4)
    cols5 = _map_columns(header5, COLUMN_ROLES_F5)

    # ── Étage 2 : colonnes et rubriques ──────────────────────────────────────
    errors: list[dict] = []
    for role, label, _frag in COLUMN_ROLES_F4:
        if role not in cols4:
            errors.append({
                "code": "COLONNE_MANQUANTE",
                "message": (f"Feuille « {SHEET_BESOINS} » : colonne « {label} » introuvable. "
                            f"En-têtes lus : {', '.join(h for h in header4 if h) or '(aucun)'}."),
            })
    if "rubrique" not in cols5 or "total" not in cols5:
        errors.append({
            "code": "COLONNE_MANQUANTE",
            "message": (f"Feuille « {SHEET_SYNTHESE} » : les colonnes « Rubrique » et "
                        f"« Total rubrique » sont requises. "
                        f"En-têtes lus : {', '.join(h for h in header5 if h) or '(aucun)'}."),
        })
    if errors:
        return errors

    # Rubriques de la feuille 5 : les 8 modules + TOTAL GÉNÉRAL.
    seen_modules: set[str] = set()
    has_grand_total = False
    for row in rows5:
        raw = _cell(row, cols5["rubrique"])
        if is_total_row(raw):
            has_grand_total = True
            continue
        code = rubrique_to_module(raw)
        if code:
            seen_modules.add(code)

    for code in MODULE_CODES:
        if code not in seen_modules:
            errors.append({
                "code": "RUBRIQUE_MANQUANTE",
                "message": (f"Feuille « {SHEET_SYNTHESE} » : la rubrique "
                            f"« {MODULE_LABELS[code]} » est absente. Les 8 rubriques "
                            f"doivent figurer, même à 0."),
            })
    if not has_grand_total:
        errors.append({
            "code": "RUBRIQUE_MANQUANTE",
            "message": (f"Feuille « {SHEET_SYNTHESE} » : la ligne « TOTAL GÉNÉRAL » "
                        f"est absente."),
        })
    if errors:
        return errors

    # ── Étage 3 : types ──────────────────────────────────────────────────────
    freq_idx = _find_frequence(header4, set(cols4.values()))
    parsed4: list[tuple[str, Decimal]] = []   # (module, total ligne)
    for n, row in enumerate(rows4, start=1):
        raw_rubrique = _cell(row, cols4["rubrique"])
        cells = {role: _cell(row, idx) for role, idx in cols4.items()}
        empty = all(c in (None, "") for c in cells.values())
        if empty:
            continue
        # Ligne de sous-total du classeur (« TOTAL BESOINS DU CYCLE ») : elle n'est
        # pas un besoin, et l'additionner doublerait la rubrique correspondante.
        if is_total_row(raw_rubrique):
            continue
        module = rubrique_to_module(raw_rubrique)
        if module is None:
            errors.append({
                "code": "RUBRIQUE_INCONNUE",
                "message": (f"Feuille « {SHEET_BESOINS} », ligne {n} : rubrique "
                            f"« {raw_rubrique or '(vide)'} » non reconnue. Utilisez la "
                            f"liste déroulante des 8 rubriques officielles."),
            })
            continue
        for role, label in (("quantite", "Quantité"), ("prix_unitaire", "Prix unitaire"),
                            ("total", "Total")):
            value = to_decimal(cells.get(role))
            if value is None:
                errors.append({
                    "code": "TYPE_INVALIDE",
                    "message": (f"Feuille « {SHEET_BESOINS} », ligne {n} "
                                f"(« {raw_rubrique} ») : « {label} » doit être un nombre, "
                                f"valeur lue « {cells.get(role)} »."),
                })
            elif value < 0:
                errors.append({
                    "code": "TYPE_INVALIDE",
                    "message": (f"Feuille « {SHEET_BESOINS} », ligne {n} "
                                f"(« {raw_rubrique} ») : « {label} » ne peut pas être "
                                f"négatif ({value})."),
                })
        total = to_decimal(cells.get("total"))
        if total is not None and total >= 0:
            parsed4.append((module, total))

    totals5: dict[str, Decimal] = {}
    grand_total_declared: Decimal | None = None
    for n, row in enumerate(rows5, start=1):
        raw = _cell(row, cols5["rubrique"])
        value = to_decimal(_cell(row, cols5["total"]))
        if is_total_row(raw):
            if value is None:
                errors.append({
                    "code": "TYPE_INVALIDE",
                    "message": (f"Feuille « {SHEET_SYNTHESE} » : « TOTAL GÉNÉRAL » doit "
                                f"être un nombre, valeur lue « {_cell(row, cols5['total'])} »."),
                })
            else:
                grand_total_declared = value
            continue
        code = rubrique_to_module(raw)
        if code is None:
            continue
        if value is None:
            errors.append({
                "code": "TYPE_INVALIDE",
                "message": (f"Feuille « {SHEET_SYNTHESE} », rubrique « {raw} » : le total "
                            f"doit être un nombre, valeur lue "
                            f"« {_cell(row, cols5['total'])} »."),
            })
        elif value < 0:
            errors.append({
                "code": "TYPE_INVALIDE",
                "message": (f"Feuille « {SHEET_SYNTHESE} », rubrique « {raw} » : le total "
                            f"ne peut pas être négatif ({value})."),
            })
        else:
            totals5[code] = totals5.get(code, Decimal("0")) + value
    if errors:
        return errors

    # ── Étage 4 : cohérence interne ──────────────────────────────────────────
    sums4: dict[str, Decimal] = {code: Decimal("0") for code in MODULE_CODES}
    for module, total in parsed4:
        sums4[module] = sums4.get(module, Decimal("0")) + total

    for code in MODULE_CODES:
        detail = _q(sums4.get(code, Decimal("0")))
        synthese = _q(totals5.get(code, Decimal("0")))
        if abs(detail - synthese) > CENT:
            errors.append({
                "code": "INCOHERENCE_INTERNE",
                "message": (
                    f"Rubrique « {MODULE_LABELS[code]} » : la feuille "
                    f"« {SHEET_SYNTHESE} » annonce {synthese} alors que la somme des "
                    f"lignes de « {SHEET_BESOINS} » vaut {detail} "
                    f"(écart {_q(synthese - detail)}). La synthèse doit se calculer "
                    f"depuis le détail — ne saisissez rien directement en feuille 5."
                ),
            })

    total_rubriques = _q(sum(totals5.values(), Decimal("0")))
    if grand_total_declared is not None:
        declared = _q(grand_total_declared)
        if abs(declared - total_rubriques) > CENT:
            errors.append({
                "code": "TOTAL_INCOHERENT",
                "message": (
                    f"« TOTAL GÉNÉRAL » annoncé {declared} ≠ somme des 8 rubriques "
                    f"{total_rubriques} (écart {_q(declared - total_rubriques)})."
                ),
            })
    return errors


# ── Ingestion ─────────────────────────────────────────────────────────────────

def dataset_key_for(application) -> str:
    """Une lignée versionnée par dossier : 1 dossier = 1 `dataset_key`."""
    return f"fb__{application.code}"


def parse_and_ingest(file, application, uploaded_by: str = "") -> dict:
    """Valide puis ingère la feuille de besoins d'un dossier.

    Lève `NeedsSheetValidationError` (→ 422 structuré) si un contrôle échoue ; la
    source refusée reste en base au statut STAGED, rattachée au dossier : la
    trajectoire des tentatives est elle-même une donnée d'analyse (principe 4.3).

    Retourne `{needs_source_id, revision, sha256, totals, grand_total}`.
    """
    source = DataSource(
        original_name=file.name[:255],
        dataset_key=dataset_key_for(application),
        credit_application=application,
        uploaded_by=uploaded_by or "",
    )
    source.file = file
    source.save()

    dataio_services.inspect(source)   # pose kind + sha256, n'écrit aucune ligne

    if source.kind != KIND_FEUILLE_BESOINS:
        raise NeedsSheetValidationError([{
            "code": "CLASSEUR_NON_RECONNU",
            "message": (
                "Ce classeur n'est pas une feuille de besoins AGRICAP : les feuilles "
                f"« {SHEET_BESOINS} » et « {SHEET_SYNTHESE} » doivent être présentes "
                "dans un classeur d'au plus 10 feuilles. Téléchargez le modèle officiel "
                "via GET /api/credits/needs-sheet-template/."
            ),
        }])

    errors = validate_needs_sheet(source.file.path)
    if errors:
        raise NeedsSheetValidationError(errors)

    dataio_services.commit(source, by=uploaded_by or "",
                           sheets=list(dataio_services.FEUILLE_BESOINS_SHEETS))

    application.needs_source = source
    application.save(update_fields=["needs_source", "updated_at"])

    totals = extract_module_totals(source)
    return {
        "needs_source_id": source.pk,
        "revision": source.revision,
        "sha256": source.sha256,
        "totals": {k: str(v) for k, v in totals.items()},
        "grand_total": str(_q(sum(totals.values(), Decimal("0")))),
    }


def extract_module_totals(source: DataSource) -> dict[str, Decimal]:
    """Totaux par module, lus dans les `DataRecord` — jamais dans le fichier.

    Calque ligne à ligne : chaque ligne de `5_Synthese_Besoins` alimente exactement
    un module. Les 8 codes sont toujours présents (0 si la rubrique est à 0).
    """
    totals = {code: Decimal("0") for code in MODULE_CODES}
    table = source.tables.filter(name=SHEET_SYNTHESE).first()
    if table is None:
        return totals

    columns = [c.name for c in table.columns.all()]
    cols = _map_columns(columns, COLUMN_ROLES_F5)
    if "rubrique" not in cols or "total" not in cols:
        return totals
    name_rubrique = columns[cols["rubrique"]]
    name_total = columns[cols["total"]]

    for record in table.records.all():
        code = rubrique_to_module(record.values.get(name_rubrique))
        if not code:
            continue
        value = to_decimal(record.values.get(name_total))
        if value is not None:
            totals[code] = _q(totals[code] + value)
    return totals


def needs_source_lineage(source: DataSource | None) -> dict:
    """Traçabilité minimale d'une analyse : de quoi la rejouer à l'identique."""
    if source is None:
        return {}
    return {
        "needs_source_id": source.pk,
        "revision": source.revision,
        "sha256": source.sha256,
        "dataset_key": source.dataset_key,
        "committed_at": source.committed_at.isoformat() if source.committed_at else None,
    }
