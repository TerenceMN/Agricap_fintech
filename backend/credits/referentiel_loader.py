"""Construit un `ReferentielFiliere` depuis un simulateur déjà ingéré dans `dataio`.

Pourquoi ce module existe — le seed du moteur portait des coûts par module
**inventés**, répartis à la main pour retomber sur le total de 9 111 USD du
classeur maïs. Le total était juste, la répartition ne l'était pas : 850 USD/ha
de semences là où le classeur en donne 126,60. Un facteur 6,7 sur un poste qui
pèse dans le critère de fiabilité technique, soit 25 % du score.

Le principe 1 vaut pour le référentiel comme pour le dossier : **ce qui sert à
scorer vient de la base, pas d'une estimation**. Les simulateurs
`AGRICAP_FIN_SIM_NN_Famille_Culture.xlsx` sont ingérés en tables versionnées ;
c'est la seule source légitime.

Ce que le classeur donne et qu'on lit :
  - `2_Identification_Projet` → superficie de référence, production principale
  - `5_Synthese_Besoins`      → total par rubrique, pour le cycle entier
  - `3_Parametres_Techniques` → rendement attendu et prix prévu

Ce que le classeur ne donne PAS et qui reste institutionnel : les tolérances
par module. Elles expriment la marge qu'AGRICAP accepte autour de la référence,
pas une donnée agronomique — elles n'ont donc rien à faire dans un simulateur.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from credits.needs_sheet import rubrique_to_module

#: `AGRICAP_FIN_SIM_01_Cereales_Mais.xlsx` → ("01", "Cereales", "Mais")
_NOM_SIMULATEUR = re.compile(
    r"AGRICAP_FIN_SIM_(?P<numero>\d{2})_(?P<famille>[^_]+)_(?P<culture>[^.]+)\.xlsx",
    re.IGNORECASE,
)

#: Tolérances par défaut — asymétriques et volontairement ainsi : sous-estimer un
#: poste (`tol_inf`) est plus souvent une omission de bonne foi, le sur-estimer
#: (`tol_sup`) plus souvent une inflation. Ces valeurs sont institutionnelles ;
#: elles descendront dans `InstitutionConfig` (principe 8).
TOLERANCE_DEFAUT = {"tol_inf": "0.30", "tol_sup": "0.40"}
#: L'équipement et la réserve tolèrent mieux l'absence : un dossier peut
#: légitimement n'avoir ni l'un ni l'autre.
TOLERANCES_PAR_MODULE = {
    "equipements": {"tol_inf": "0.40", "tol_sup": "0.40"},
    "reserve": {"tol_inf": "0.50", "tol_sup": "0.40"},
}


class ReferentielIntrouvable(Exception):
    """Le simulateur ne porte pas les tables ou les valeurs attendues."""


def _decimal(valeur) -> Decimal | None:
    """Nombre depuis une cellule, ou `None` — jamais une valeur inventée."""
    if valeur is None:
        return None
    texte = str(valeur).strip().replace(" ", "").replace(" ", "").replace(",", ".")
    if not texte:
        return None
    try:
        return Decimal(texte)
    except InvalidOperation:
        return None


def _lignes(source, nom_table: str) -> list[dict]:
    table = source.tables.filter(name=nom_table).first()
    if table is None:
        raise ReferentielIntrouvable(
            f"Le simulateur « {source.original_name} » n'a pas de table "
            f"« {nom_table} » — classeur incomplet ou mal ingéré."
        )
    return [r.values for r in table.records.order_by("row_index")]


def _valeur_par_rubrique(lignes: list[dict], fragment: str,
                         col_cle="Rubrique", col_val="Valeur") -> str | None:
    """Première valeur dont la rubrique contient `fragment` (sans accents)."""
    from credits.needs_sheet import normalize
    cible = normalize(fragment)
    for ligne in lignes:
        if cible in normalize(ligne.get(col_cle)):
            return ligne.get(col_val)
    return None


def charger_depuis_simulateur(source) -> dict:
    """Données d'un `ReferentielFiliere`, lues dans un simulateur ingéré.

    Lève `ReferentielIntrouvable` plutôt que de compléter ce qui manque : un
    référentiel partiellement inventé est pire qu'un référentiel absent, parce
    qu'il score sans le dire.
    """
    nom = re.search(_NOM_SIMULATEUR, source.original_name or "")
    if nom is None:
        raise ReferentielIntrouvable(
            f"« {source.original_name} » ne suit pas la convention "
            "AGRICAP_FIN_SIM_NN_Famille_Culture.xlsx."
        )

    identification = _lignes(source, "2_Identification_Projet")
    superficie = _decimal(_valeur_par_rubrique(identification, "superficie"))
    if not superficie or superficie <= 0:
        raise ReferentielIntrouvable(
            f"Superficie de référence absente ou nulle dans « {source.original_name} ». "
            "Sans elle, les coûts du cycle ne se ramènent pas à l'hectare."
        )

    # ── Coûts par module, ramenés à l'unité de surface ───────────────────────
    couts: dict[str, dict[str, str]] = {}
    total_lu = Decimal(0)
    for ligne in _lignes(source, "5_Synthese_Besoins"):
        module = rubrique_to_module(ligne.get("Rubrique"))
        if module is None:          # ligne TOTAL, ou rubrique non reconnue
            continue
        montant = _decimal(ligne.get("Total rubrique"))
        if montant is None:
            continue
        total_lu += montant
        couts[module] = {
            "ref": str((montant / superficie).quantize(Decimal("0.01"))),
            **TOLERANCES_PAR_MODULE.get(module, TOLERANCE_DEFAUT),
        }

    if not couts:
        raise ReferentielIntrouvable(
            f"Aucune rubrique exploitable dans « {source.original_name} » : "
            "vérifier la feuille 5_Synthese_Besoins."
        )

    # ── Rendement de référence ───────────────────────────────────────────────
    rendement = {}
    for ligne in _lignes(source, "3_Parametres_Techniques"):
        qte = _decimal(ligne.get("Rendement attendu"))
        prix = _decimal(ligne.get("Prix prévu"))
        if qte and prix:
            rendement = {
                "qte_unite": str((qte / superficie).quantize(Decimal("0.001"))),
                "prix_unitaire": str(prix),
                "unite": (ligne.get("Unité") or "t").strip(),
            }
            break

    production = _valeur_par_rubrique(identification, "production principale")
    famille = nom.group("famille").replace("-", " ")

    return {
        "code": (source.original_name or "").removesuffix(".xlsx"),
        "filiere": f"{famille} — {production}" if production else famille,
        "value_chain_code": nom.group("numero"),
        "unite_reference": "ha",
        "devise": "USD",
        "couts_modules": couts,
        "rendement_ref": rendement,
        "n_cas_reels": 0,
        # `indicatif` tant qu'aucun dossier réel n'a alimenté la boucle
        # d'apprentissage : une plage issue d'un simulateur n'a pas l'autorité
        # d'une plage apprise sur 30 dossiers (principe 10).
        "source": "indicatif",
        # Traçabilité : quel classeur, quelle révision, quel total lu.
        "_lignage": {
            "dataSourceId": source.pk,
            "revision": source.revision,
            "superficieReference": str(superficie),
            "totalCycleLu": str(total_lu),
        },
    }


def simulateurs_disponibles():
    """Les simulateurs courants ingérés, triés par numéro de filière."""
    from dataio.models import DataSource
    sources = DataSource.objects.filter(kind="SIMULATEUR", is_current=True)
    retenus = [s for s in sources if re.search(_NOM_SIMULATEUR, s.original_name or "")]
    return sorted(retenus, key=lambda s: s.original_name or "")
