"""
Moteur d'analyse technico-économique — étape 2bis du pipeline (SPEC Moteur §4).

Cinq critères pondérés produisent un score global et une **recommandation**.
Le moteur ne décide rien : `recommander()` renvoie une chaîne que l'analyste lit,
jamais une transition de la machine à états (principe 2). Un dossier reste dans
son statut après une analyse, quelle que soit sa note.

Discipline de calcul (principe 4) — `Decimal` partout, `float` nulle part :
  - montants  → quantize `0.01`
  - ratios    → quantize `0.001`
  - scores et points → quantize `0.1`
  - arrondi   → `ROUND_HALF_UP` systématique

Le pseudo-code de la SPEC utilise `float` (`bareme.evaluer(float(dscr))`,
`float(val)` dans les détails, lignes d'échéancier en `float`) : c'est l'erreur
que ce module corrige. Un seul `float` dans la chaîne suffit à faire diverger un
score de 0,1 point, et 0,1 point autour de 45,0 change la recommandation.

Sources de données (principe 1) — rien n'est lu dans un fichier ni dans un payload :
  - coûts par module  → `DataRecord` de `application.needs_source` (lot 2)
  - garanties         → `CreditGuarantee.retained_coverage` (décote déjà appliquée)
  - comportement      → `portfolio.Loan` du client
  - barèmes et poids  → `BaremeScore` / `referentiel.InstitutionConfig` (principe 8)

ÉCARTS SIGNALÉS AVEC LA SPEC — voir `docs/status-fragments/moteur-backend.md` :
  1. `DemandeCredit` / `PlanFinancierUpload` n'existent pas → `CreditApplication`
     et `application.needs_source`.
  2. La SPEC lit les cash-flows dans une feuille « Tresorerie » du template. Cette
     feuille n'existe pas : le classeur ingéré ne contient que
     `4_Besoins_Financiers` et `5_Synthese_Besoins`. Les cash-flows sont donc
     PROJETÉS depuis `ReferentielFiliere.rendement_ref` — hypothèse explicite,
     restituée dans les détails du critère, jamais silencieuse.
  3. Les scores de l'exemple de référence (DSCR 19,1 ; stress 14,3) ne se
     déduisent pas des barèmes de la SPEC §5 (ils donnent 19,7 et 6,4 pour
     DSCR 0,636 / 0,477). Écart documenté et testé tel quel.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from credits.echeancier import (
    MODE_INTERETS_SEULS,
    MODES,
    EcheancierError,
    construire_echeancier,
    serialiser_echeancier,
    totaux_echeancier,
)
from credits.models import AnalyseCredit, BaremeScore, ReferentielFiliere
from credits.needs_sheet import MODULE_CODES, extract_module_totals

logger = logging.getLogger(__name__)

VERSION_MOTEUR = "4.0"

CENT = Decimal("0.01")      # montants
MILLE = Decimal("0.001")    # ratios (DSCR, couverture, écarts)
DIXIEME = Decimal("0.1")    # scores et points
ZERO = Decimal("0")

#: Ordre canonique des critères — c'est celui du contrat front (`CreditAnalyse.criteres`).
CRITERES = ("technique", "dscr", "stress", "comportemental", "garanties")

#: Poids de secours (principe 8, exception « valeurs par défaut de secours ») :
#: appliqués UNIQUEMENT si `InstitutionConfig` est absent ou incohérent, et
#: toujours avec un warning loggé.
POIDS_DEFAUT = {
    "technique": Decimal("25"), "dscr": Decimal("20"), "stress": Decimal("10"),
    "comportemental": Decimal("30"), "garanties": Decimal("15"),
}

#: Règles de décision de secours — miroir de la SPEC §4 `recommander()`.
REGLES_DECISION_DEFAUT = {
    "approbation": {"score_min": "75", "dscr_min": "1.2", "sans_hors_plage": True},
    "approbation_cond": {"score_min": "60", "dscr_min": "1.0"},
    "revue": {"score_min": "45"},
    "choc_revenus": "0.25",
}

#: Un DSCR sous ce plancher interdit toute forme d'approbation, quel que soit le
#: score. Règle de sûreté, pas un seuil de barème : elle ne se recalibre pas.
DSCR_PLANCHER_APPROBATION = Decimal("1.0")

CODES_BAREMES = ("ECART_TECHNIQUE", "DSCR", "COUVERTURE_GARANTIES", "DECISION")


# ── Exceptions (convention `credits.workflow`) ───────────────────────────────

class AnalyseError(Exception):
    """Le moteur refuse d'analyser. `code` et `http_status` portés par la classe.

    Même contrat que `credits.workflow.WorkflowError` : c'est le `code` que le
    front consomme, jamais la formulation du message, et `as_errors()` détaille
    cause par cause (principe 5 — jamais un message générique).
    """

    code = "ANALYSE_ERROR"
    http_status = 422

    def __init__(self, message: str, errors: list[dict] | None = None) -> None:
        super().__init__(message)
        self.errors = errors or []

    def as_errors(self) -> list[dict]:
        return self.errors or [{"code": self.code, "message": str(self)}]


class SourceBesoinsAbsente(AnalyseError):
    """Aucune feuille de besoins ingérée : rien à scorer (principe 1)."""

    code = "SOURCE_BESOINS_ABSENTE"


class ReferentielAbsent(AnalyseError):
    """Aucun référentiel actif pour la filière du dossier.

    On refuse plutôt que de scorer contre un référentiel de repli : un score
    technique de 0 imputé à une absence de configuration serait un refus de
    crédit fabriqué par l'outil, pas par le dossier.
    """

    code = "REFERENTIEL_ABSENT"


class BaremeAbsent(AnalyseError):
    """Un barème indispensable manque en base — le comité doit le seeder."""

    code = "BAREME_ABSENT"


class ParametresInvalides(AnalyseError):
    """Durée / différé / taux inexploitables (relaie `EcheancierError`)."""

    code = "PARAMETRES_INVALIDES"


# ── Quantize ─────────────────────────────────────────────────────────────────

def q2(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def q3(value) -> Decimal:
    return Decimal(str(value)).quantize(MILLE, rounding=ROUND_HALF_UP)


def q1(value) -> Decimal:
    return Decimal(str(value)).quantize(DIXIEME, rounding=ROUND_HALF_UP)


def _points(score: Decimal, poids: Decimal) -> Decimal:
    """`points = score × poids / 100`, arrondi au dixième.

    L'arrondi se fait ICI, critère par critère, et le score global est la somme
    des points arrondis — pas l'arrondi de la somme. C'est ce que l'analyste voit
    à l'écran : une colonne « points » dont le total doit tomber juste. L'exemple
    de la SPEC §2 en dépend (3,82 + 1,43 + 15 + 9 = 29,25 → 29,3 si on arrondit
    à la fin, mais 3,8 + 1,4 + 15,0 + 9,0 = 29,2 comme annoncé).
    """
    return q1(score * poids / Decimal(100))


# ── Chargement des règles (principe 8) ───────────────────────────────────────

def charger_baremes() -> dict[str, BaremeScore]:
    """Barèmes actifs indexés par code. Lève `BaremeAbsent` si l'un manque."""
    baremes = {b.code: b for b in BaremeScore.objects.filter(actif=True)}
    manquants = [c for c in CODES_BAREMES if c not in baremes]
    if manquants:
        raise BaremeAbsent(
            "Barèmes de score absents de la base : "
            f"{', '.join(manquants)}. Exécutez « manage.py seed_analyse » "
            "ou faites-les créer par le comité de crédit.",
            errors=[{"code": "BAREME_ABSENT",
                     "message": f"Le barème « {c} » n'existe pas ou est inactif."}
                    for c in manquants],
        )
    return baremes


def poids_effectifs() -> dict[str, Decimal]:
    """Pondération des 5 critères, lue dans `InstitutionConfig` (principe 8).

    Repli sur `POIDS_DEFAUT` avec warning loggé si la config est absente ou si la
    somme n'est pas 100 : une pondération qui ne somme pas à 100 rendrait le
    score global inintelligible (« 87/100 » sur une base de 92).
    """
    try:
        from referentiel.models import InstitutionConfig
        cfg = InstitutionConfig.active()
        poids = {
            "technique": Decimal(str(cfg.poids_technique)),
            "dscr": Decimal(str(cfg.poids_financier)),
            "stress": Decimal(str(cfg.poids_stress)),
            "comportemental": Decimal(str(cfg.poids_comportemental)),
            "garanties": Decimal(str(cfg.poids_garanties)),
        }
    except Exception as exc:  # noqa: BLE001 — la config ne doit jamais casser l'analyse
        logger.warning(
            "Pondération : InstitutionConfig illisible (%s) — repli sur les poids "
            "par défaut %s.", exc, POIDS_DEFAUT)
        return dict(POIDS_DEFAUT)

    total = sum(poids.values(), ZERO)
    if total != Decimal(100):
        logger.warning(
            "Pondération : la somme des poids d'InstitutionConfig vaut %s et non "
            "100 — repli sur les poids par défaut.", total)
        return dict(POIDS_DEFAUT)
    return poids


def regles_decision(bareme: BaremeScore | None) -> dict:
    """Règles du barème de décision à 4 niveaux, avec repli loggé."""
    params = (bareme.parametres if bareme else None) or {}
    if not params:
        logger.warning(
            "Barème DECISION vide — repli sur les règles par défaut (SPEC §4).")
        return dict(REGLES_DECISION_DEFAUT)
    return params


def choc_stress(regles: dict) -> Decimal:
    """Amplitude du choc de revenus du stress test, en fraction (0,25 = −25 %)."""
    brut = regles.get("choc_revenus", REGLES_DECISION_DEFAUT["choc_revenus"])
    try:
        choc = Decimal(str(brut))
    except Exception:  # noqa: BLE001
        choc = Decimal(REGLES_DECISION_DEFAUT["choc_revenus"])
    if not (ZERO <= choc < Decimal(1)):
        logger.warning("Choc de stress hors [0, 1[ : %s — repli sur 0.25.", choc)
        choc = Decimal("0.25")
    return choc


# ── C1 — Fiabilité technique (25 %) ──────────────────────────────────────────

def scorer_technique(totaux_modules: dict, referentiel: ReferentielFiliere,
                     superficie: Decimal, bareme: BaremeScore,
                     poids: Decimal) -> dict:
    """Compare chaque module du plan au référentiel filière, à l'unité de surface.

    Le score dépend de l'écart absolu MOYEN ; les écarts hors tolérance
    alimentent le canal de justification. Deux précisions par rapport à la SPEC :

      - un module absent du plan compte comme un écart de −100 %, pas comme une
        donnée manquante : ne rien prévoir pour la main-d'œuvre sur 5 ha est une
        information, pas un trou (CLAUDE.md §4.4, « l'absence est une donnée ») ;
      - une superficie nulle ou absente rend la comparaison impossible ; on le dit
        au lieu de comparer un plan à un référentiel de 0.
    """
    couts = referentiel.couts_modules or {}
    superficie = Decimal(str(superficie or 0))

    if superficie <= 0:
        return {
            "score": Decimal("0.0"), "poids": poids, "points": Decimal("0.0"),
            "details": {
                "commentaire": ("Superficie absente du dossier : la comparaison au "
                                "référentiel n'est pas calculable."),
                "referentiel": referentiel.code,
                "superficieHa": None,
                "ecartsHorsPlage": [],
            },
            "hors_plage": [],
        }

    ecarts: list[Decimal] = []
    hors_plage: list[dict] = []
    total_plan = ZERO
    total_ref = ZERO
    par_module: list[dict] = []

    for module, cfg in couts.items():
        ref = q2(Decimal(str(cfg.get("ref", 0))) * superficie)
        val = q2(totaux_modules.get(module, ZERO))
        total_plan += val
        total_ref += ref

        ecart_rel = q3((val - ref) / ref) if ref else ZERO
        ecarts.append(abs(ecart_rel))

        tol_inf = Decimal(str(cfg.get("tol_inf", "0.30")))
        tol_sup = Decimal(str(cfg.get("tol_sup", "0.40")))
        depasse = ecart_rel < -tol_inf or ecart_rel > tol_sup

        ecart_pct = q1(ecart_rel * Decimal(100))
        ligne = {
            "indicateur": f"cout_module:{module}",
            "module": module,
            "valeur": float(val),
            "reference": float(ref),
            "ecartPct": float(ecart_pct),
            "message": f"{module} : {ecart_pct:+} % vs référentiel",
        }
        par_module.append({**ligne, "horsPlage": depasse})
        if depasse:
            hors_plage.append(ligne)

    ecart_moyen = q3(sum(ecarts, ZERO) / Decimal(len(ecarts))) if ecarts else Decimal(1)
    score = bareme.evaluer(ecart_moyen)

    # Dépenses du plan sur des modules que le référentiel ne couvre pas : elles
    # n'entrent dans aucun écart, donc dans aucun score. Le taire reviendrait à
    # scorer un plan amputé sans que personne ne le sache.
    non_references = [
        {"module": m, "montant": float(q2(totaux_modules.get(m, ZERO)))}
        for m in MODULE_CODES
        if m not in couts and q2(totaux_modules.get(m, ZERO)) > 0
    ]

    commentaire = ""
    if total_ref and total_plan < total_ref / Decimal(2):
        commentaire = (
            f"Total de la feuille de besoins ({total_plan}) nettement inférieur au "
            f"référentiel ({total_ref}) : le plan ne couvre pas le cycle décrit.")
    if referentiel.est_indicatif:
        commentaire = (commentaire + " " if commentaire else "") + (
            f"Comparaison faite contre un référentiel indicatif "
            f"(N = {referentiel.n_cas_reels} dossiers réels) — fiabilité limitée.")

    return {
        "score": score, "poids": poids, "points": _points(score, poids),
        "details": {
            "totalPlan": float(total_plan),
            "totalReferentiel": float(total_ref),
            "ecartMoyenPct": float(q1(ecart_moyen * Decimal(100))),
            "referentiel": referentiel.code,
            "referentielSource": referentiel.source,
            "superficieHa": float(superficie),
            "uniteReference": referentiel.unite_reference,
            "parModule": par_module,
            "modulesNonReferences": non_references,
            "ecartsHorsPlage": hors_plage,
            "commentaire": commentaire,
        },
        "hors_plage": hors_plage,
    }


# ── C2 — Capacité financière / DSCR (20 %) ───────────────────────────────────

def calculer_dscr(cash_flows: list[Decimal], echeancier: list[dict]) -> Decimal:
    """DSCR global = Σ cash-flows disponibles ÷ Σ service de la dette.

    Service nul (impossible avec `construire_echeancier`, mais un appelant peut
    passer une liste vide) → 0, jamais une division par zéro déguisée en DSCR
    infini.
    """
    service = totaux_echeancier(echeancier)["service_dette"] if echeancier else ZERO
    if service <= 0:
        return ZERO
    total_cf = sum((Decimal(str(cf)) for cf in cash_flows), ZERO)
    return q3(total_cf / service)


def dscr_mensuel_minimum(cash_flows: list[Decimal], echeancier: list[dict]) -> dict:
    """Le mois le plus tendu : un DSCR global sain peut cacher un mois à 0,2.

    C'est le diagnostic qui manque le plus souvent à l'analyste — le différé
    concentre le capital sur les derniers mois, et c'est là que le dossier casse
    (SPEC §9.3).
    """
    pire = None
    for i, ligne in enumerate(echeancier):
        echeance = Decimal(str(ligne["echeance"]))
        if echeance <= 0:
            continue
        cf = Decimal(str(cash_flows[i])) if i < len(cash_flows) else ZERO
        ratio = q3(cf / echeance)
        if pire is None or ratio < pire["dscr"]:
            pire = {"mois": ligne["mois"], "dscr": ratio,
                    "echeance": q2(echeance), "cashFlow": q2(cf)}
    return pire or {}


def diagnostiquer_levier(capital: Decimal, taux_annuel: Decimal, duree_mois: int,
                         differe_mois: int, mode_differe: str,
                         cash_flows: list[Decimal]) -> tuple[str, list[dict]]:
    """Levier chiffré : « un différé de 3 mois porterait le DSCR à X ».

    CLAUDE.md §4.6 — un DSCR de 0,64 ne se livre jamais seul : il se livre avec
    son facteur dominant et son levier. Ici le levier se calcule pour de vrai,
    en reconstruisant l'échéancier à différé réduit sur les MÊMES cash-flows.
    C'est un calcul, pas une approximation d'écran : le front ne doit rien
    recalculer (standard front, « zéro chiffre métier calculé côté client »).

    Le total des cash-flows est conservé (on ne réécrit pas la trésorerie du
    client) mais leur calendrier suit la nouvelle phase d'amortissement, sinon
    la comparaison serait faussée par un simple décalage de dates.
    """
    total_cf = sum((Decimal(str(cf)) for cf in cash_flows), ZERO)
    alternatives: list[dict] = []

    for candidat in sorted({0, max(differe_mois - 2, 0), max(differe_mois - 3, 0)}):
        if candidat == differe_mois or candidat >= duree_mois:
            continue
        try:
            lignes = construire_echeancier(
                capital, taux_annuel, duree_mois, candidat, mode_differe)
        except EcheancierError:
            continue
        n_amort = duree_mois - candidat
        mensuel = q2(total_cf / Decimal(n_amort)) if total_cf > 0 else ZERO
        flux = ([ZERO] * candidat + [mensuel] * n_amort)[:duree_mois]
        alternatives.append({
            "differeMois": candidat,
            "dscr": float(calculer_dscr(flux, lignes)),
            "serviceDette": float(totaux_echeancier(lignes)["service_dette"]),
        })

    if not alternatives:
        return "", []

    meilleur = max(alternatives, key=lambda a: a["dscr"])
    phrase = (f"Un différé de {meilleur['differeMois']} mois au lieu de "
              f"{differe_mois} porterait le DSCR à {meilleur['dscr']:.3f} "
              f"(service de la dette étalé sur {duree_mois - meilleur['differeMois']} "
              f"mois au lieu de {duree_mois - differe_mois}).")
    return phrase, alternatives


def scorer_dscr(dscr: Decimal, bareme: BaremeScore, poids: Decimal,
                diagnostic: dict | None = None) -> dict:
    score = bareme.evaluer(dscr)
    qualif = ("solide" if dscr >= Decimal("1.3")
              else "acceptable" if dscr >= Decimal("1.0")
              else "insuffisante")
    details = {
        "dscr": float(dscr),
        "commentaire": f"DSCR = {q2(dscr)} ({qualif})",
    }
    if diagnostic:
        # `facteurDominant` et `levier` sont remontés à la racine des détails :
        # ce sont les deux phrases que l'analyste lit en premier, pas des
        # sous-champs d'un bloc technique (contrat front `moteur-front-analyse`).
        details["facteurDominant"] = diagnostic.pop("facteurDominant", "")
        details["levier"] = diagnostic.pop("levier", "")
        details["diagnostic"] = diagnostic
    return {"score": score, "poids": poids, "points": _points(score, poids),
            "details": details}


# ── C3 — Résilience au stress (10 %) ─────────────────────────────────────────

def scorer_stress(cash_flows: list[Decimal], echeancier: list[dict],
                  bareme: BaremeScore, poids: Decimal, choc: Decimal) -> dict:
    """DSCR recalculé sous choc de revenus (−25 % par défaut, paramétrable)."""
    facteur = Decimal(1) - choc
    cf_stress = [q2(Decimal(str(cf)) * facteur) for cf in cash_flows]
    dscr_s = calculer_dscr(cf_stress, echeancier)
    score = bareme.evaluer(dscr_s)
    return {
        "score": score, "poids": poids, "points": _points(score, poids),
        "details": {
            "dscrStress": float(dscr_s),
            "chocPct": float(q1(choc * Decimal(100))),
            "commentaire": f"Stress test −{q1(choc * Decimal(100))} % sur les revenus "
                           f"→ DSCR = {q2(dscr_s)}",
        },
        "dscr_stress": dscr_s,
    }


# ── C4 — Historique comportemental (30 %) ────────────────────────────────────

def _charger_historique(client) -> dict | None:
    """Indicateurs comportementaux du client, ou `None` si aucun historique.

    Source : `portfolio.Loan` — les crédits déjà gérés par l'institution. La SPEC
    prévoyait « Wallet / Transactions » ; le module `transactions` n'expose pas
    encore d'historique de flux exploitable, ce qui est signalé plutôt que simulé.
    """
    try:
        from portfolio.models import Loan
    except Exception:  # noqa: BLE001
        return None

    sub = str(getattr(client, "pk", "") or "")
    prets = list(Loan.objects.filter(borrower_sub=sub)) if sub else []
    if not prets:
        return None

    total = len(prets)
    defauts = sum(1 for p in prets if p.status == Loan.Status.DEFAUT)
    clotures = sum(1 for p in prets if p.status == Loan.Status.CLOTURE)
    suspendus = sum(1 for p in prets if p.status in (Loan.Status.SUSPENDU, Loan.Status.BLOQUE))

    engage = sum((p.amount_approved or p.amount_requested or ZERO) for p in prets)
    rembourse = sum((p.repaid or ZERO) for p in prets)
    taux_remb = q3(rembourse / engage) if engage else ZERO

    return {
        "nbCredits": total,
        "nbClotures": clotures,
        "nbDefauts": defauts,
        "nbSuspendus": suspendus,
        "tauxRemboursement": float(taux_remb),
        "_taux_remb": taux_remb,
        "_incidents": defauts + suspendus,
        "_clotures": clotures,
        "_total": total,
    }


def scorer_comportemental(client, bareme: BaremeScore | None, poids: Decimal) -> dict:
    """Score 50/100 NEUTRE et explicitement mentionné si aucun historique.

    Le silence sur ce point serait le pire des défauts : 30 % du score global
    reposerait sur une valeur inventée sans que l'analyste le sache. La mention
    est donc obligatoire, et `historiqueDisponible` est un champ à part entière
    du contrat — pas une phrase à interpréter.
    """
    historique = _charger_historique(client)

    if historique is None:
        score = Decimal("50.0")
        return {
            "score": score, "poids": poids, "points": _points(score, poids),
            "details": {
                "historiqueDisponible": False,
                "commentaire": ("Historique comportemental non disponible : aucun "
                                "crédit antérieur au nom de ce client. Score neutre "
                                "de 50/100 appliqué — ce critère pèse "
                                f"{poids} % du score global sans être documenté."),
            },
        }

    # Part de crédits soldés + régularité du remboursement, moins les incidents.
    part_cloture = (Decimal(historique["_clotures"]) / Decimal(historique["_total"])
                    if historique["_total"] else ZERO)
    brut = (min(historique["_taux_remb"], Decimal(1)) * Decimal("60")
            + part_cloture * Decimal("40"))
    brut -= Decimal(historique["_incidents"]) * Decimal(20)
    score = q1(max(ZERO, min(Decimal(100), brut)))

    details = {k: v for k, v in historique.items() if not k.startswith("_")}
    details["historiqueDisponible"] = True
    details["commentaire"] = (
        f"{historique['nbCredits']} crédit(s) antérieur(s), "
        f"{historique['nbClotures']} soldé(s), {historique['nbDefauts']} en défaut.")
    return {"score": score, "poids": poids, "points": _points(score, poids),
            "details": details}


# ── C5 — Garanties & domiciliation (15 %) ────────────────────────────────────

def scorer_garanties(application, bareme: BaremeScore, poids: Decimal) -> dict:
    """Ratio de couverture = Σ valeurs RETENUES ÷ montant financé.

    La SPEC embarquait une table de décotes en dur dans le code (`DECOTES = {...}`),
    ce que le principe 8 interdit et que le principe 9 rend inutile :
    `CreditGuarantee.retained_coverage` applique déjà la décote de la garantie —
    valeur retenue après vérification pour un actif, montant bloqué pour l'épargne,
    pondération `decote_caution_morale` d'`InstitutionConfig` pour une caution.
    Deux tables de décotes auraient donné deux ratios de couverture différents
    pour un même dossier selon l'écran consulté.
    """
    from credits.models import CreditGuarantee

    montant = Decimal(str(application.amount_approved or application.amount_requested or 0))
    garanties = list(
        application.guarantees.exclude(
            status__in=(CreditGuarantee.Status.DECLINED,
                        CreditGuarantee.Status.RELEASED,
                        CreditGuarantee.Status.EXPIRED)
        )
    )

    couverture = ZERO
    detail_lignes = []
    constituees = bool(garanties)
    for g in garanties:
        retenue = q2(g.retained_coverage or 0)
        couverture += retenue
        active = g.status == CreditGuarantee.Status.ACTIVE
        if not active:
            constituees = False
        detail_lignes.append({
            "type": g.guarantee_type, "statut": g.status,
            "valeurRetenue": float(retenue), "constituee": active,
        })

    ratio = q3(couverture / montant) if montant else ZERO
    score = bareme.evaluer(ratio)

    commentaire = ""
    plafond = Decimal(str((bareme.parametres or {}).get("plafond_non_constituees", "60")))
    if not garanties:
        # Aucune garantie déclarée : la SPEC prévoit 60/100 « indicatif ». Ce n'est
        # pas la même chose qu'une garantie déclarée mais pas encore constituée —
        # ici il n'y a rien à constituer.
        score = min(score, plafond)
        commentaire = ("Aucune garantie déclarée — score indicatif plafonné en "
                       "attente de constitution.")
    elif not constituees:
        score = min(score, plafond)
        commentaire = "Garanties déclarées mais non encore constituées — score indicatif."

    return {
        "score": q1(score), "poids": poids, "points": _points(q1(score), poids),
        "details": {
            "ratioCouverture": float(ratio),
            "couvertureRetenue": float(q2(couverture)),
            "montantFinance": float(q2(montant)),
            "constituees": constituees,
            "garanties": detail_lignes,
            "commentaire": commentaire,
        },
    }


# ── Cash-flows prévisionnels ─────────────────────────────────────────────────

def projeter_cash_flows(referentiel: ReferentielFiliere, superficie: Decimal,
                        total_plan: Decimal, duree_mois: int,
                        differe_mois: int) -> tuple[list[Decimal], dict]:
    """Cash-flows mensuels disponibles pour le service de la dette.

    ⚠ HYPOTHÈSE EXPLICITE — la SPEC lit ces flux dans une feuille « Tresorerie »
    du template qui n'existe pas : le classeur ingéré ne porte que les feuilles 4
    et 5. Faute de trésorerie prévisionnelle déclarée, on la PROJETTE :

        revenu brut = rendement_ref.qte_unite × prix_unitaire × superficie
        marge nette du cycle = revenu brut − coûts du plan
        disponible mensuel = marge ÷ nombre de mois d'amortissement

    La marge est portée sur les mois d'AMORTISSEMENT et non sur toute la durée :
    le produit de la vente arrive après la récolte, c'est précisément la raison
    d'être du différé. Cette hypothèse est restituée dans les détails du critère
    DSCR, avec ses trois termes, pour que l'analyste puisse la contester.

    Quand le référentiel n'a pas de rendement, on renvoie des flux nuls et on le
    dit : un DSCR de 0 dû à un référentiel incomplet doit être lisible comme tel.
    """
    rendement = referentiel.rendement_ref or {}
    qte = Decimal(str(rendement.get("qte_unite", 0) or 0))
    prix = Decimal(str(rendement.get("prix_unitaire", 0) or 0))
    superficie = Decimal(str(superficie or 0))

    revenu_brut = q2(qte * prix * superficie)
    marge = q2(revenu_brut - Decimal(str(total_plan or 0)))
    n_amort = max(duree_mois - differe_mois, 1)

    hypothese = {
        "origine": "projection_referentiel",
        "referentiel": referentiel.code,
        "referentielSource": referentiel.source,
        "rendementUnitaire": float(qte),
        "prixUnitaire": float(prix),
        "uniteRendement": rendement.get("unite", ""),
        "superficieHa": float(superficie),
        "revenuBrut": float(revenu_brut),
        "chargesPlan": float(q2(total_plan or 0)),
        "margeNetteCycle": float(marge),
        "moisAmortissement": n_amort,
        "commentaire": (
            "Cash-flows PROJETÉS depuis le référentiel filière : le classeur "
            "ingéré ne comporte pas de trésorerie prévisionnelle déclarée "
            "(feuilles 4 et 5 uniquement). Hypothèse à valider avec le client."),
    }

    if qte <= 0 or prix <= 0:
        hypothese["commentaire"] = (
            f"Le référentiel « {referentiel.code} » ne porte pas de rendement de "
            "référence : les cash-flows ne sont pas projetables et le DSCR est "
            "calculé sur des flux nuls. Complétez le référentiel avant de "
            "conclure sur ce critère.")
        return [ZERO] * duree_mois, hypothese

    mensuel = q2(marge / Decimal(n_amort)) if marge > 0 else ZERO
    flux = [ZERO] * differe_mois + [mensuel] * n_amort
    return flux[:duree_mois], hypothese


# ── Barème de décision — 4 niveaux ───────────────────────────────────────────

def recommander(score_global: Decimal, dscr: Decimal, hors_plage: list,
                regles: dict | None = None) -> str:
    """Recommandation du moteur — **jamais une transition** (principe 2).

    Règle de sûreté prioritaire sur le score : un DSCR sous
    `DSCR_PLANCHER_APPROBATION` ne peut donner NI `approbation` NI
    `approbation_cond`, quel que soit le score global. Un dossier qui ne dégage
    pas de quoi payer ses échéances ne s'approuve pas parce qu'il a un bon
    historique — les 30 % du critère comportemental peuvent à eux seuls porter un
    dossier à 60, et c'est exactement le trou que ce garde-fou ferme.
    """
    regles = regles or REGLES_DECISION_DEFAUT
    score = Decimal(str(score_global))
    dscr = Decimal(str(dscr or 0))

    approbation = regles.get("approbation", REGLES_DECISION_DEFAUT["approbation"])
    cond = regles.get("approbation_cond", REGLES_DECISION_DEFAUT["approbation_cond"])
    revue = regles.get("revue", REGLES_DECISION_DEFAUT["revue"])

    if dscr >= DSCR_PLANCHER_APPROBATION:
        if (score >= Decimal(str(approbation.get("score_min", 75)))
                and dscr >= Decimal(str(approbation.get("dscr_min", "1.2")))
                and not (approbation.get("sans_hors_plage", True) and hors_plage)):
            return AnalyseCredit.Recommandation.APPROBATION
        if (score >= Decimal(str(cond.get("score_min", 60)))
                and dscr >= Decimal(str(cond.get("dscr_min", "1.0")))):
            return AnalyseCredit.Recommandation.APPROBATION_COND

    if score >= Decimal(str(revue.get("score_min", 45))):
        return AnalyseCredit.Recommandation.REVUE
    return AnalyseCredit.Recommandation.REFUS


#: Grille lettre de secours — bornes de la SPEC §6.
LETTRES_DEFAUT = [{"lettre": "A", "min": "85"}, {"lettre": "B", "min": "70"},
                  {"lettre": "C", "min": "50"}, {"lettre": "D", "min": "0"}]


def score_lettre(score_global, regles: dict | None = None) -> str:
    """A/B/C/D — la seule note que le client voit (SPEC §6).

    La grille vit en base (`BaremeScore.DECISION.parametres.lettres`, principe 8)
    et **le serveur seul l'applique**. Trois fichiers du front la recopiaient à la
    main : c'était un barème dans le navigateur, que le comité ne pouvait pas
    recalibrer sans un déploiement, et dont la version client (`scoreLetterOf`)
    apprenait au demandeur qu'à 70,1 il passe de C à B — le fragment de barème
    exact que le principe 7 doit retenir. La lettre est donc servie, la grille
    jamais.

    Bornes STRICTES (`>`) : ce sont celles de la SPEC §6, conservées telles quelles
    pour ne pas déplacer silencieusement la frontière d'un dossier à 85,0.
    """
    grille = (regles or {}).get("lettres") or LETTRES_DEFAUT
    score = Decimal(str(score_global))
    for palier in sorted(grille, key=lambda p: Decimal(str(p["min"])), reverse=True):
        borne = Decimal(str(palier["min"]))
        if score > borne or borne == 0:
            return palier["lettre"]
    return "D"


# ── Orchestration ────────────────────────────────────────────────────────────

def resoudre_referentiel(application) -> ReferentielFiliere:
    """Référentiel actif de la filière du dossier.

    Trois clés d'accès, de la plus précise à la plus lâche : code `ValueChain`,
    puis libellé de filière. La SPEC filtre sur `demande.culture`, champ qui
    n'existe pas sur `CreditApplication`.
    """
    chain = application.value_chain
    qs = ReferentielFiliere.objects.filter(actif=True)

    if chain is not None:
        ref = qs.filter(value_chain_code=chain.code).first()
        if ref:
            return ref
        ref = qs.filter(filiere__iexact=chain.label).first()
        if ref:
            return ref

    raise ReferentielAbsent(
        "Aucun référentiel technico-économique actif pour la filière "
        f"« {chain.label if chain else '(non renseignée)'} » de ce dossier. "
        "L'analyse est refusée plutôt que faite contre un référentiel de repli : "
        "un score technique nul imputable à une configuration manquante serait "
        "un refus fabriqué par l'outil."
    )


@transaction.atomic
def executer_analyse(application, *, duree_mois: int, differe_mois: int = 0,
                     taux_annuel=None, mode_differe: str = MODE_INTERETS_SEULS,
                     execute_par: str = "",
                     cash_flows: list[Decimal] | None = None) -> AnalyseCredit:
    """Exécute le moteur et persiste une NOUVELLE `AnalyseCredit`.

    Atomique avec sa journalisation d'audit : une analyse dont l'entrée de journal
    manque ne prouve rien, et un journal qui référence une analyse absente est
    pire encore.

    `cash_flows` permet d'injecter une trésorerie prévisionnelle connue (test de
    référence, ou future feuille de trésorerie du template) ; à défaut, elle est
    projetée depuis le référentiel — cf. `projeter_cash_flows`.
    """
    source = application.needs_source
    if source is None:
        raise SourceBesoinsAbsente(
            "Aucune feuille de besoins ingérée pour ce dossier : il n'y a rien à "
            "scorer. Ce qui est scoré est ce qui est en base (principe 1) — "
            "l'analyse ne lit ni fichier ni formulaire.")

    referentiel = resoudre_referentiel(application)
    baremes = charger_baremes()
    poids = poids_effectifs()
    regles = regles_decision(baremes.get("DECISION"))

    capital = Decimal(str(application.amount_approved or application.amount_requested or 0))
    if capital <= 0:
        raise ParametresInvalides(
            "Le dossier ne porte aucun montant : ni montant approuvé ni montant "
            "demandé. L'échéancier n'est pas constructible.")

    if taux_annuel is None:
        chain = application.value_chain
        taux_annuel = Decimal(str(chain.base_rate)) if chain and chain.base_rate else Decimal("18")
    taux_annuel = Decimal(str(taux_annuel))

    if mode_differe not in MODES:
        raise ParametresInvalides(
            f"Mode de différé « {mode_differe} » inconnu (attendu : {', '.join(MODES)}).")

    try:
        lignes = construire_echeancier(
            capital, taux_annuel, int(duree_mois), int(differe_mois), mode_differe)
    except EcheancierError as exc:
        raise ParametresInvalides(
            exc.message, errors=[{"code": exc.code, "message": exc.message}]) from exc

    # ── Données scorées : DataRecord de la révision courante (principe 1) ─────
    totaux = extract_module_totals(source)
    total_plan = q2(sum(totaux.values(), ZERO))
    superficie = application.area_ha

    c1 = scorer_technique(totaux, referentiel, superficie,
                          baremes["ECART_TECHNIQUE"], poids["technique"])

    if cash_flows is None:
        cash_flows, hypothese_cf = projeter_cash_flows(
            referentiel, superficie, total_plan, int(duree_mois), int(differe_mois))
    else:
        cash_flows = [Decimal(str(cf)) for cf in cash_flows]
        hypothese_cf = {"origine": "fourni",
                        "commentaire": "Cash-flows fournis à l'appel du moteur."}

    dscr = calculer_dscr(cash_flows, lignes)
    diagnostic = {
        "hypotheseCashFlows": hypothese_cf,
        "moisLePlusTendu": _jsonifier(dscr_mensuel_minimum(cash_flows, lignes)),
        "serviceDette": float(totaux_echeancier(lignes)["service_dette"]),
        "cashFlowTotal": float(q2(sum(cash_flows, ZERO))),
    }
    if differe_mois:
        diagnostic["facteurDominant"] = (
            f"Différé de {differe_mois} mois sur {duree_mois} : le capital "
            f"s'amortit sur {duree_mois - differe_mois} mois, ce qui concentre le "
            f"service de la dette et dégrade mécaniquement le DSCR.")
        levier, alternatives = diagnostiquer_levier(
            capital, taux_annuel, int(duree_mois), int(differe_mois),
            mode_differe, cash_flows)
        diagnostic["levier"] = levier
        diagnostic["alternativesDiffere"] = alternatives
    elif dscr < Decimal("1.0"):
        diagnostic["facteurDominant"] = (
            "Sans différé, l'écart vient du niveau des revenus attendus au regard "
            "du montant demandé, pas du calendrier de remboursement.")
        diagnostic["levier"] = ""

    c2 = scorer_dscr(dscr, baremes["DSCR"], poids["dscr"], diagnostic)
    c3 = scorer_stress(cash_flows, lignes, baremes["DSCR"], poids["stress"],
                       choc_stress(regles))
    c4 = scorer_comportemental(application.client, baremes.get("COMPORTEMENTAL"),
                               poids["comportemental"])
    c5 = scorer_garanties(application, baremes["COUVERTURE_GARANTIES"], poids["garanties"])

    criteres = {"technique": c1, "dscr": c2, "stress": c3,
                "comportemental": c4, "garanties": c5}
    score_global = q1(sum((c["points"] for c in criteres.values()), ZERO))
    hors_plage = c1.get("hors_plage", [])
    reco = recommander(score_global, dscr, hors_plage, regles)

    analyse = AnalyseCredit.objects.create(
        application=application,
        needs_source=source,
        needs_source_revision=source.revision,
        needs_source_sha256=source.sha256 or "",
        referentiel=referentiel,
        duree_mois=int(duree_mois), differe_mois=int(differe_mois),
        mode_differe=mode_differe, taux_annuel=taux_annuel,
        capital=q2(capital), devise=application.currency or "USD",
        criteres=_jsonifier(criteres),
        dscr=dscr, dscr_stress=c3["dscr_stress"],
        score_global=score_global, recommandation=reco,
        indicateurs_hors_plage=_jsonifier(hors_plage),
        echeancier=serialiser_echeancier(lignes),
        poids_appliques={k: str(v) for k, v in poids.items()},
        # `_regles` fige la grille de décision ET la grille de lettres appliquées :
        # un recalibrage du comité ne doit pas rendre une analyse passée
        # inexplicable, ni changer rétroactivement la lettre affichée au client.
        baremes_appliques={
            **{c: {"id": b.pk, "version": b.version} for c, b in baremes.items()},
            "_regles": regles,
        },
        execute_par=execute_par or "",
        version_moteur=VERSION_MOTEUR,
    )

    from audit.services import record as audit_record
    audit_record(
        actor=execute_par or "", action="credits.analyse.execute",
        entity_type="AnalyseCredit", entity_id=str(analyse.pk),
        details={
            "applicationCode": application.code,
            "scoreGlobal": str(score_global),
            "recommandation": reco,
            "dscr": str(dscr),
            "dscrStress": str(c3["dscr_stress"]),
            "needsSourceId": source.pk,
            "needsSourceRevision": source.revision,
            "needsSourceSha256": source.sha256 or "",
            "referentiel": referentiel.code,
            "versionMoteur": VERSION_MOTEUR,
        },
    )
    return analyse


@transaction.atomic
def justifier_indicateur(analyse: AnalyseCredit, *, indicateur: str,
                         justification: str, agent: str) -> AnalyseCredit:
    """Ajoute une justification d'analyste — append only (principe 3).

    L'indicateur doit figurer parmi les indicateurs hors plage de CETTE analyse :
    justifier un écart que le moteur n'a pas relevé n'aurait aucun destinataire,
    et laisserait croire qu'un point a été traité.
    """
    indicateur = (indicateur or "").strip()
    justification = (justification or "").strip()

    erreurs = []
    if not indicateur:
        erreurs.append({"code": "INDICATEUR_REQUIS",
                        "message": "L'indicateur à justifier est obligatoire."})
    if not justification:
        erreurs.append({"code": "JUSTIFICATION_REQUISE",
                        "message": "La justification ne peut pas être vide : c'est "
                                   "elle qui sera relue par le comité."})
    if erreurs:
        raise AnalyseError("Justification incomplète.", errors=erreurs)

    connus = {i.get("indicateur") for i in (analyse.indicateurs_hors_plage or [])}
    if indicateur not in connus:
        raise AnalyseError(
            f"L'indicateur « {indicateur} » ne fait pas partie des écarts relevés "
            f"par cette analyse ({', '.join(sorted(c for c in connus if c)) or 'aucun'}).",
            errors=[{"code": "INDICATEUR_INCONNU",
                     "message": f"Indicateur « {indicateur} » hors du périmètre de "
                                f"l'analyse #{analyse.pk}."}],
        )

    analyse.justifications = list(analyse.justifications or []) + [{
        "indicateur": indicateur,
        "justification": justification,
        "agent": agent or "",
        "date": timezone.now().isoformat(),
    }]
    analyse.save(update_fields=["justifications"])

    from audit.services import record as audit_record
    audit_record(
        actor=agent or "", action="credits.analyse.justifier",
        entity_type="AnalyseCredit", entity_id=str(analyse.pk),
        details={"applicationCode": analyse.application.code,
                 "indicateur": indicateur, "justification": justification},
    )
    return analyse


def _jsonifier(value):
    """`Decimal` → `float` pour le stockage JSON des blocs de détail.

    Le calcul est terminé quand cette fonction s'exécute : les scores et points
    sont déjà quantizés, aucune arithmétique ne se fait plus dessus. Les montants
    de l'échéancier, eux, restent des CHAÎNES (`serialiser_echeancier`) — ce sont
    les seuls chiffres que quelqu'un pourrait vouloir re-sommer.
    """
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _jsonifier(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonifier(v) for v in value]
    return value


# ── Sérialisation API ────────────────────────────────────────────────────────
#
# Le contrat est FIGÉ dans `src/types/api.ts` (`CreditAnalyse`,
# `CreditAnalyseCritere`, `CreditEcheancierLigne`, `CreditAnalyseResume`) et deux
# agents front sont typés dessus. Clés en camelCase, montants en `number`.

#: Le contrat front type `phase` en `'différé' | 'amortissement' | 'franchise'`
#: alors que `echeancier.py` produit `'differe'` / `'amortissement'` (sans accent,
#: identifiants de stockage). La traduction se fait ICI, à la frontière HTTP :
#: la valeur stockée reste un identifiant stable, l'affichage reste le contrat.
_PHASES_API = {
    ("differe", MODE_INTERETS_SEULS): "différé",
    ("differe", "franchise_totale"): "franchise",
    ("amortissement", MODE_INTERETS_SEULS): "amortissement",
    ("amortissement", "franchise_totale"): "amortissement",
}


def serialiser_echeancier_api(lignes: list[dict], mode_differe: str) -> list[dict]:
    """Échéancier au format `CreditEcheancierLigne` : nombres, phases accentuées."""
    out = []
    for l in lignes:
        phase = _PHASES_API.get((l.get("phase"), mode_differe), l.get("phase"))
        out.append({
            "mois": l["mois"],
            "phase": phase,
            "capital": float(Decimal(str(l["capital"]))),
            "interets": float(Decimal(str(l["interets"]))),
            "interetsCapitalises": float(Decimal(str(l.get("interets_capitalises", 0)))),
            "echeance": float(Decimal(str(l["echeance"]))),
            "crd": float(Decimal(str(l["crd"]))),
        })
    return out


def _totaux_api(lignes: list[dict]) -> dict:
    """Totaux de l'échéancier — calculés en `Decimal`, servis en `number`.

    Pas de `totalCommissions` : la ligne `commission` de la SPEC §A.3 n'est pas
    implémentée (l'écart 25 vs 19,95 du simulateur Excel n'est pas tranché). La
    servir à 0 laisserait croire qu'il n'y a pas de commission, ce qui n'est pas
    établi — l'absence de clé est plus honnête que le zéro.
    """
    if not lignes:
        return {"totalInterets": 0.0, "totalCapital": 0.0, "serviceDette": 0.0,
                "totalInteretsCapitalises": 0.0, "nbEcheances": 0, "crdFinal": 0.0}
    totaux = totaux_echeancier([
        {k: Decimal(str(v)) if k != "mois" and k != "phase" else v for k, v in l.items()}
        for l in lignes
    ])
    return {
        "totalInterets": float(totaux["interets_payes"]),
        "totalInteretsCapitalises": float(totaux["interets_capitalises"]),
        "totalCapital": float(totaux["capital_rembourse"]),
        "serviceDette": float(totaux["service_dette"]),
        "crdFinal": float(totaux["crd_final"]),
        "nbEcheances": totaux["nb_echeances"],
    }


def serialiser_analyse_staff(analyse: AnalyseCredit) -> dict:
    """Vue ANALYSTE — expose barèmes, plages et tolérances. Jamais servie au client."""
    return {
        "id": analyse.pk,
        "reference": analyse.application.code,
        "referentiel": analyse.referentiel.code,
        "parametres": {
            "dureeMois": analyse.duree_mois,
            "differeMois": analyse.differe_mois,
            "tauxAnnuel": float(analyse.taux_annuel),
            "modeDiffere": analyse.mode_differe,
            "capital": float(analyse.capital),
            "devise": analyse.devise,
        },
        "scoreGlobal": float(analyse.score_global),
        # Lettre servie par le serveur : le front ne convertit plus un score en
        # lettre avec des bornes recopiées à la main (principe 8).
        "scoreLettre": score_lettre(analyse.score_global,
                                    (analyse.baremes_appliques or {}).get("_regles")),
        "recommandation": analyse.recommandation,
        "dscr": float(analyse.dscr) if analyse.dscr is not None else None,
        "dscrStress": float(analyse.dscr_stress) if analyse.dscr_stress is not None else None,
        "criteres": {
            cle: {
                "score": float(bloc.get("score", 0)),
                "poids": float(bloc.get("poids", 0)),
                "points": float(bloc.get("points", 0)),
                "details": bloc.get("details", {}),
            }
            for cle, bloc in (analyse.criteres or {}).items() if cle in CRITERES
        },
        "indicateursHorsPlage": analyse.indicateurs_hors_plage or [],
        "justifications": analyse.justifications or [],
        "echeancier": serialiser_echeancier_api(analyse.echeancier or [],
                                                analyse.mode_differe),
        # Totaux servis par le serveur (SPEC §A.4) : le front ne somme pas une
        # colonne de montants en `float`, il affiche ce que le moteur a calculé
        # en `Decimal`.
        "totaux": _totaux_api(analyse.echeancier or []),
        # Devise de l'analyse. Le contrat `CreditAnalyse` ne la portait pas ; la
        # servir évite un repli sur la devise d'un autre objet, et un agrégat
        # multi-devises muet (CLAUDE.md §7.2, « KPI honnêtes »).
        "devise": analyse.devise,
        # Autorité du référentiel : une plage indicative ne vaut pas une plage
        # apprise sur 200 dossiers, et l'écran doit pouvoir le dire (§4.6).
        "referentielInfo": {
            "code": analyse.referentiel.code,
            "filiere": analyse.referentiel.filiere,
            "source": analyse.referentiel.source,
            "estIndicatif": analyse.referentiel.est_indicatif,
            "nCasReels": analyse.referentiel.n_cas_reels,
            "version": analyse.referentiel.version,
        },
        "executeLe": analyse.execute_le.isoformat() if analyse.execute_le else None,
        "versionMoteur": analyse.version_moteur,
        "lignage": {
            "needsSourceId": analyse.needs_source_id,
            "revision": analyse.needs_source_revision,
            "sha256": analyse.needs_source_sha256,
        },
        "poidsAppliques": analyse.poids_appliques or {},
    }


#: Message client par critère quand il est en dessous du niveau attendu.
#: Formulés en ACTION, jamais en seuil : « constituez une garantie » et non
#: « votre couverture est à 0,42 pour un barème qui donne 75 à 1,0 ».
_PISTES_CLIENT = {
    "technique": ("Détaillez votre feuille de besoins poste par poste : plusieurs "
                  "rubriques s'écartent de ce qui est observé sur des projets "
                  "comparables."),
    "dscr": ("Les revenus attendus couvrent difficilement les remboursements. "
             "Une durée plus longue ou un montant plus mesuré améliorerait cet "
             "équilibre."),
    "stress": ("Votre projet résiste mal à une baisse des revenus. Prévoir une "
               "réserve d'exploitation renforcerait sa solidité."),
    "comportemental": ("Un historique de remboursement au sein d'AGRICAP renforce "
                       "un dossier. Une épargne régulière y contribue aussi."),
    "garanties": ("Constituez vos garanties : une garantie confirmée pèse "
                  "davantage qu'une garantie annoncée."),
}

_FORTS_CLIENT = {
    "technique": "Votre plan de financement est cohérent avec des projets comparables.",
    "dscr": "Les revenus attendus couvrent confortablement vos remboursements.",
    "stress": "Votre projet resterait viable même si les revenus baissaient.",
    "comportemental": "Votre historique avec AGRICAP joue en votre faveur.",
    "garanties": "Vos garanties sont solides et bien constituées.",
}

#: Un critère STRICTEMENT au-dessus est un point fort, strictement en dessous une
#: piste d'amélioration. Ce n'est PAS un seuil de barème : c'est la moitié de
#: l'échelle 0–100, une information que le client déduit déjà de sa propre lettre.
#:
#: Comparaison stricte des deux côtés : un critère à exactement 50 n'est ni un
#: point fort ni une faiblesse, il est NEUTRE — et le seul critère qui vaut
#: exactement 50 est le comportemental sans historique. Avec un `>=`, l'absence
#: d'historique était annoncée au client comme « votre historique joue en votre
#: faveur » : le moteur félicitait un client pour une donnée qu'il n'a pas.
_MEDIANE = Decimal(50)


def serialiser_analyse_resume(analyse: AnalyseCredit) -> dict:
    """Vue CLIENT — anti-gaming (principe 7), volontairement pauvre.

    Ce que ce dictionnaire ne contient JAMAIS, et qu'un test verrouille :
    aucun score chiffré, aucun poids, aucun point, aucun DSCR, aucun barème,
    aucune tolérance, aucune plage du référentiel, aucun code de référentiel,
    aucune recommandation du moteur, aucun montant du plan comparé à une
    référence. Le client voit sa LETTRE et des pistes formulées en actions.

    La recommandation elle-même est retenue : elle est l'entrée d'une décision
    humaine (principe 2), et l'annoncer au client avant la décision créerait une
    attente que l'institution n'a pas prise.
    """
    criteres = analyse.criteres or {}
    forts, ameliorer = [], []
    for cle in CRITERES:
        bloc = criteres.get(cle)
        if not bloc:
            continue
        score = Decimal(str(bloc.get("score", 0)))
        details = bloc.get("details") or {}

        # Absence d'historique : jamais un point fort. C'est une piste — le
        # client peut agir dessus (épargner, rembourser un premier crédit),
        # alors qu'il ne peut rien faire d'une félicitation imméritée.
        if cle == "comportemental" and details.get("historiqueDisponible") is False:
            ameliorer.append(_PISTES_CLIENT[cle])
            continue

        if score > _MEDIANE and cle in _FORTS_CLIENT:
            forts.append(_FORTS_CLIENT[cle])
        elif score < _MEDIANE and cle in _PISTES_CLIENT:
            ameliorer.append(_PISTES_CLIENT[cle])

    return {
        "reference": analyse.application.code,
        "scoreLettre": score_lettre(analyse.score_global,
                                    (analyse.baremes_appliques or {}).get("_regles")),
        "pointsForts": forts,
        "pointsAAmeliorer": ameliorer,
        "analyseLe": analyse.execute_le.isoformat() if analyse.execute_le else None,
    }
