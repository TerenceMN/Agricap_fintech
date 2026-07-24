"""Correspondance canonique entre les DEUX nomenclatures de filières (CLAUDE.md §6).

Le projet en porte deux depuis l'origine, sans jamais les relier :

* **numérique** `01`–`14` — `referentiel.chains.CHAINS`, alimentée par le classeur
  technico-économique v3 et par les noms de fichiers des 14 simulateurs ;
* **alphabétique** `MAIS`, `RIZ`, `MANIOC`, `HARICOT`, `CAFE_ARABICA`… —
  `reference_data.ValueChain.code`, saisie dans un classeur maker-checker.

**Ce ne sont pas deux noms du même objet, et c'est pourquoi personne ne les a fusionnées :
elles ne décrivent pas la même granularité.** `01` est une FAMILLE (« Céréales »), `MAIS` et
`RIZ` sont deux CULTURES de cette famille. La relation est N:1 et le sens canonique est
alphabétique → numérique. Une « fusion » au sens strict détruirait de l'information ; ce
module établit la correspondance, il ne prétend pas réduire les deux tables à une seule.

Conséquence directe, et c'est le bug qu'il faut avoir en tête en lisant ce module :
`credits/referentiel_loader.py` ÉCRIT un code numérique dans
`ReferentielFiliere.value_chain_code`, tandis que `credits/analyse.py` et
`credits/dataio_simulator.py` LISENT cette colonne avec un code alphabétique. La jointure
ne peut aboutir que si les deux nomenclatures coïncident — ce que seuls les tests
obtiennent, en fabriquant des `ValueChain` dont le code vaut « 01 ». En base réelle, elle
ne matche jamais. C'est ce que `numero_pour()` est fait pour réparer, côté lecteurs.

Pourquoi ici et pas en base
---------------------------
Le principe 8 (« les règles vivent en base ») vise les SEUILS MÉTIER — barèmes, tolérances,
plafonds — que le comité doit pouvoir changer sans redéploiement. Une correspondance de
nomenclature n'en est pas un : c'est une structure, elle change quand le référentiel des 14
chaînes change, c'est-à-dire jamais sans migration de données. La poser en base créerait une
table de plus à tenir synchronisée avec `chains.py` — soit une TROISIÈME nomenclature.

Comment la correspondance est établie
-------------------------------------
Sans recopier le catalogue : les 14 chaînes portent déjà, dans `referentiel/chains.py`, un
tuple `keywords` de signaux de détection (« maïs », « manioc », « ruches », « tilapia »…)
repris du PROMPT §3 — et qui n'était importé nulle part. Ce module leur donne enfin leur
emploi : le code alphabétique et son libellé sont confrontés à ces signaux.

S'y ajoute une table ÉPINGLÉE pour les filières réellement seedées aujourd'hui. Elle est
volontairement redondante avec la détection par mots-clés — un test vérifie que les deux
concordent. Son rôle est d'être un verrou : si quelqu'un retouche les `keywords` de
`chains.py` et déplace `MANIOC` des tubercules vers autre chose, le test tombe.

`common` ne dépend pas de `referentiel` à l'import : le catalogue est chargé à l'appel, pour
ne pas inverser les couches (`common` est le socle, il ne doit rien exiger des apps métier).

Ce que ce module ne fait JAMAIS
-------------------------------
Il ne devine pas. Une filière non résolue renvoie `None` / `""` — jamais une chaîne par
défaut. Substituer silencieusement un référentiel à un autre est proscrit (principe 10) :
un dossier scoré contre les plages des céréales parce que sa filière était inconnue serait
un faux plus dangereux qu'une absence de score.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

__all__ = [
    "Correspondance",
    "CORRESPONDANCES_EPINGLEES",
    "est_numero",
    "normaliser_numero",
    "numero_pour",
    "resoudre",
    "codes_par_numero",
]


#: Correspondances figées pour les filières effectivement seedées
#: (`reference_data/fixtures/value_chains_initial.py`). Verrou de non-régression, pas
#: source de vérité : le mécanisme général reste la détection par signaux.
#:
#: ⚠️ `CAFE_ARABICA` → `12` (Agroforesterie & bois) et non `07` (Cultures industrielles) :
#: c'est le classement de `referentiel/chains.py`, où « café » et « cacao » sont des signaux
#: de la chaîne agroforestière alors que « thé » relève des cultures industrielles. Cette
#: asymétrie est celle du référentiel v3, pas un arbitrage de ce module — elle mérite une
#: confirmation métier, elle ne se tranche pas dans du code.
CORRESPONDANCES_EPINGLEES: dict[str, str] = {
    "MAIS": "01",          # Céréales
    "RIZ": "01",           # Céréales
    "HARICOT": "02",       # Légumineuses
    "MANIOC": "03",        # Tubercules & racines
    "CAFE_ARABICA": "12",  # Agroforesterie & bois (cf. avertissement ci-dessus)
}


@dataclass(frozen=True)
class Correspondance:
    """Résultat d'une résolution, avec son lignage.

    `origine` et `indice` ne sont pas décoratifs : un analyste doit pouvoir dire POURQUOI un
    dossier a été rapproché de telle famille de référentiel — « chaque chiffre a une
    provenance ». Une correspondance obtenue par mot-clé n'a pas la même autorité qu'une
    correspondance épinglée, et l'appelant doit pouvoir en tenir compte.
    """

    code_numerique: str   # "01".."14"
    slug: str
    libelle: str
    specialite: str
    origine: str          # "numerique" | "slug" | "epinglee" | "mot_cle"
    indice: str           # ce qui a permis de conclure


def _catalogue():
    """Les 14 chaînes, chargées à l'appel (cf. docstring : pas d'inversion de couches)."""
    from referentiel.chains import BY_CODE, BY_SLUG, CHAINS

    return CHAINS, BY_CODE, BY_SLUG


def _normaliser(texte: str) -> str:
    """Minuscules, sans accents, ponctuation et séparateurs ramenés à des espaces.

    `CAFE_ARABICA` → `cafe arabica` ; `Tubercules & racines` → `tubercules racines`. Les
    `keywords` du catalogue subissent le même traitement, pour que « niébé » et « niebe »
    ou « maïs » et « MAIS » se rencontrent.
    """
    decompose = unicodedata.normalize("NFD", str(texte or ""))
    sans_accents = "".join(c for c in decompose if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^0-9a-zA-Z]+", " ", sans_accents)).strip().lower()


def normaliser_numero(valeur: str) -> str:
    """`"1"`, `"01"`, `" 01 "` → `"01"` si la chaîne existe, sinon `""`.

    Le zéro de tête est significatif partout ailleurs (`chain_code` est un `CharField(2)`,
    les noms de simulateurs sont numérotés `_01_`) : on l'accepte manquant en entrée, jamais
    en sortie.
    """
    brut = str(valeur or "").strip()
    if not brut.isdigit():
        return ""
    numero = brut.zfill(2)
    _, par_code, _ = _catalogue()
    return numero if numero in par_code else ""


def est_numero(valeur: str) -> bool:
    """Vrai si la valeur relève de la nomenclature numérique `01`–`14`."""
    return bool(normaliser_numero(valeur))


def _par_mots_cles(texte_normalise: str):
    """Meilleure chaîne pour ce texte, ou `None`.

    Départage, dans l'ordre : le signal le PLUS LONG l'emporte, puis le nombre de signaux,
    puis le code le plus petit (déterminisme). Le signal le plus long d'abord est ce qui
    fait qu'un « moulin à maïs » est rangé en Transformation (`moulin`, 6 lettres) et non en
    Céréales (`mais`, 4) : le signal le plus spécifique décrit mieux l'activité.
    """
    if not texte_normalise:
        return None
    aiguille = f" {texte_normalise} "
    chaines, _, _ = _catalogue()

    meilleur = None
    for chaine in chaines:
        touches = [
            mot for mot in (_normaliser(k) for k in chaine.keywords)
            if mot and f" {mot} " in aiguille
        ]
        if not touches:
            continue
        plus_long = max(touches, key=len)
        rang = (len(plus_long), len(touches), -int(chaine.code))
        if meilleur is None or rang > meilleur[0]:
            meilleur = (rang, chaine, plus_long)
    if meilleur is None:
        return None
    _, chaine, mot = meilleur
    return chaine, mot


def resoudre(code: str, *, libelle: str = "") -> Correspondance | None:
    """Rattache une filière — quelle que soit sa nomenclature — à sa chaîne `01`–`14`.

    `code` accepte aussi bien `"09"` que `"MAIS"` ou `"cereales"`. `libelle` est le libellé
    humain (`ValueChain.label`), utilisé en dernier recours : il porte souvent le signal que
    le code abrège (`code="AR_TILAPIA"`, `libelle="Tilapia en étang"`).

    Renvoie `None` si rien ne permet de conclure — l'appelant doit alors traiter la filière
    comme non rattachée, pas la ranger d'office quelque part.
    """
    _, par_code, par_slug = _catalogue()

    numero = normaliser_numero(code)
    if numero:
        chaine = par_code[numero]
        return _construire(chaine, "numerique", numero)

    brut = str(code or "").strip()
    chaine = par_slug.get(brut.lower())
    if chaine is not None:
        return _construire(chaine, "slug", brut.lower())

    epingle = CORRESPONDANCES_EPINGLEES.get(brut.upper())
    if epingle is not None:
        return _construire(par_code[epingle], "epinglee", brut.upper())

    for texte in (brut, libelle):
        trouve = _par_mots_cles(_normaliser(texte))
        if trouve is not None:
            chaine, mot = trouve
            return _construire(chaine, "mot_cle", mot)
    return None


def _construire(chaine, origine: str, indice: str) -> Correspondance:
    return Correspondance(
        code_numerique=chaine.code,
        slug=chaine.slug,
        libelle=chaine.libelle,
        specialite=chaine.specialite,
        origine=origine,
        indice=indice,
    )


def numero_pour(code: str, *, libelle: str = "") -> str:
    """Code numérique `01`–`14` d'une filière, ou `""` si non rattachée.

    C'est la fonction que doivent appeler les lecteurs de
    `ReferentielFiliere.value_chain_code` : cette colonne contient du numérique, alors
    qu'ils l'interrogent aujourd'hui avec un code alphabétique (cf. docstring du module).
    """
    correspondance = resoudre(code, libelle=libelle)
    return correspondance.code_numerique if correspondance else ""


def codes_par_numero() -> dict[str, tuple[str, ...]]:
    """Vue inverse des correspondances épinglées : `"01" → ("MAIS", "RIZ")`.

    N:1 assumé — une famille regroupe plusieurs cultures. Ne couvre que les filières
    épinglées : l'ensemble alphabétique n'est pas borné par le code (il vient d'un classeur
    uploadé), donc aucun inverse exhaustif n'est calculable hors de la base.
    """
    inverse: dict[str, list[str]] = {}
    for alphabetique, numerique in sorted(CORRESPONDANCES_EPINGLEES.items()):
        inverse.setdefault(numerique, []).append(alphabetique)
    return {numero: tuple(codes) for numero, codes in sorted(inverse.items())}
