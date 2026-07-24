"""Services investissements — façade du module.

Le mouvement d'argent réel est TOUJOURS délégué à `transactions`/`caisses` (référencé en
FK sur `Movement.transaction`) ; cette app ne détient jamais elle-même le solde. Elle
orchestre le cycle et produit les événements que la comptabilité consomme.

Répartition des responsabilités depuis le lot « cycle de vie » :

- `workflow.py` : machine à états P01→P13, gardes, journal des transitions ;
- `committee.py` : quorum du comité d'investissement (P04) ;
- `funding.py` : réservation, encaissement, clôture, décaissement, retours, distributions ;
- `metrics.py` : XIRR, défaut, concentration, score de santé ;
- ce fichier : création des entités et opérations sans effet monétaire.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from audit.services import record as audit_record
from common.exceptions import ConflictError, NotFoundError, ValidationFailed
from common.parsing import to_date, to_decimal

from . import funding, workflow
from .models import (
    AnalystObservation, FinancialAnalysis, InvestmentConfig, Investor, Offer, PerformanceReport,
    Project, Subscription, TechnicalAnalysis,
)

#: Ré-export : le graphe canonique vit dans `workflow.py`, un seul endroit.
ALLOWED_TRANSITIONS = workflow.ALLOWED_TRANSITIONS

#: Ré-exports des services monétaires — les appelants historiques n'ont pas à savoir
#: dans quel module la mécanique a été rangée.
reserve = funding.reserve
settle = funding.settle
cancel_reservation = funding.cancel_reservation
close_offer = funding.close_offer
close_fundraising = funding.close_fundraising
disburse = funding.disburse
record_return = funding.record_return
distribute = funding.distribute
refund_project = funding.refund_project
cancel_project = funding.cancel_project


@transaction.atomic
def create_project(*, code: str, title: str, sector: str = "", location: str = "",
                    funding_target: Decimal | str = "0", promoter: str = "", manager_sub: str = "",
                    credit_application_code: str = "", by: str = "") -> Project:
    """Crée un projet d'investissement.

    `credit_application_code` est le chemin NORMAL depuis la décision « 1 projet =
    1 demande de crédit » : le dossier apporte le promoteur, la filière, la zone, le
    montant demandé et le score, et le projet n'a plus qu'à porter la levée. La
    création sans dossier reste possible pour la reprise de l'existant.
    """
    if not code or not title:
        raise ValidationFailed("Code et titre du projet requis.")
    if Project.objects.filter(code=code).exists():
        raise ValidationFailed(f"Le code projet « {code} » existe déjà.")
    project = Project.objects.create(
        code=code, title=title, sector=sector, location=location,
        funding_target=to_decimal(funding_target), promoter=promoter, manager_sub=manager_sub, created_by=by,
    )
    audit_record(actor=by, action="investments.project.create", entity_type="Project", entity_id=project.code)
    if credit_application_code:
        project = link_credit_application(project=project,
                                           application_code=credit_application_code, by=by)
    return project


#: Statuts pendant lesquels un dossier de crédit peut encore être rattaché : tant que
#: la levée n'est pas ouverte. Après P06, des investisseurs ont souscrit sur la foi de
#: la filière, de la zone, du montant et du score PUBLIÉS — changer le dossier
#: sous-jacent réécrirait ce qu'ils ont financé.
LINKABLE_STATUSES = (Project.Status.P01, Project.Status.P02, Project.Status.P03,
                     Project.Status.P04, Project.Status.P05)


@transaction.atomic
def link_credit_application(*, project: Project, application_code: str = "",
                             application=None, by: str = "") -> Project:
    """Rattache un dossier de crédit à un projet — un dossier, un projet.

    L'unicité est portée par la base (`OneToOneField`) ; elle est aussi vérifiée ici
    pour rendre un refus lisible (« déjà financé par PRJ-… ») plutôt qu'une violation
    d'intégrité. Le montant demandé du dossier devient l'objectif de levée : c'est le
    seul champ recopié, parce que c'est celui sur lequel portent les gardes de
    min-funding et de décaissement (les autres sont lus à la volée, cf. `Project`).
    """
    from credits.models import CreditApplication

    if application is None:
        application = CreditApplication.objects.filter(code=application_code).first()
        if application is None:
            raise NotFoundError(f"Dossier de crédit introuvable : « {application_code} ».")

    if project.credit_application_id == application.pk:
        return project
    if project.credit_application_id:
        raise ConflictError(
            f"Le projet {project.code} finance déjà le dossier "
            f"{project.credit_application.code} : un projet ne change pas de dossier "
            "(créez un autre projet).",
            code="PROJECT_ALREADY_LINKED",
        )
    deja = Project.objects.filter(credit_application=application).exclude(pk=project.pk).first()
    if deja is not None:
        raise ConflictError(
            f"Le dossier {application.code} est déjà financé par le projet {deja.code} : "
            "deux projets ne peuvent pas financer la même demande de crédit.",
            code="CREDIT_APPLICATION_ALREADY_FINANCED",
        )
    if project.status not in LINKABLE_STATUSES:
        raise ConflictError(
            f"Le projet {project.code} est en {project.status} : le dossier de crédit "
            "se rattache avant l'ouverture de la levée (P06). Après, les investisseurs "
            "ont souscrit sur la foi du dossier publié.",
            code="LINK_AFTER_FUNDRAISING",
        )
    if application.amount_requested is None:
        raise ValidationFailed(
            f"Le dossier {application.code} ne porte pas de montant demandé : il n'y a "
            "pas d'objectif de levée à en dériver.",
            code="CREDIT_APPLICATION_WITHOUT_AMOUNT",
        )

    ancien_objectif = project.funding_target
    project.credit_application = application
    project.funding_target = to_decimal(application.amount_requested)
    project.save(update_fields=["credit_application", "funding_target", "updated_at"])
    audit_record(actor=by, action="investments.project.link_credit_application",
                 entity_type="Project", entity_id=project.code,
                 details={"application": application.code,
                          "previousFundingTarget": str(ancien_objectif),
                          "fundingTarget": str(project.funding_target),
                          "score": str(project.effective_global_score)})
    return project


#: Champs du projet qui, une fois le dossier de crédit rattaché, ne se saisissent plus :
#: ils sont LUS dans le dossier (principe 6 — une seule source par concept).
DERIVED_FIELDS = {
    "title": None,  # aucun équivalent au dossier — voir `project_detail` (divergence assumée)
    "sector": "value_chain",
    "location": "agency",
    "promoter": "client",
    "promoterContact": "client",
    "fundingTarget": "amount_requested",
    "globalScore": "AnalyseCredit.score_global",
}


def identity_disclosed_to(project: Project, investor: Investor | None) -> bool:
    """L'identité de l'emprunteur est-elle lisible par CET investisseur ?

    Deux conditions cumulatives (décision du fondateur) :

    1. le projet est décaissé (P08 et au-delà) — avant, la levée est anonyme pour tous ;
    2. l'investisseur a une souscription **encaissée** sur ce projet — porter le rôle
       `invest` ne suffit jamais, et une réservation non encaissée non plus : une
       intention n'achète pas le droit de savoir qui l'on finance.
    """
    from .serializers import IDENTITY_DISCLOSED_STATUSES

    if investor is None or project.status not in IDENTITY_DISCLOSED_STATUSES:
        return False
    return Subscription.objects.filter(
        offer__project=project, investor=investor,
        status__in=Subscription.FUNDED_STATUSES, settled_amount__gt=Decimal("0"),
    ).exists()


def transition_status(*, project: Project, to_status: str, by: str = "", reason: str = "",
                       actor_role: str = "", details: dict | None = None) -> Project:
    """Façade de `workflow.transition` — point d'entrée unique du changement de statut.

    Aucun motif de complaisance n'est fabriqué ici : « Passage en P08 » n'explique rien.
    Un appelant qui ne fournit pas de motif reçoit `TRANSITION_REASON_REQUIRED`.
    """
    return workflow.transition(project, to_status=to_status, actor_sub=by, reason=reason,
                                actor_role=actor_role, details=details)


@transaction.atomic
def approve_analysis(*, project: Project, kind: str, by: str = "") -> Project:
    """Approuve l'analyse technique ou financière — condition d'entrée en comité (P04).

    L'approbation est un acte humain daté et signé : c'est elle que la garde de P04
    vérifie, pas la simple existence d'un enregistrement d'analyse.
    """
    kind = (kind or "").strip().lower()
    modele = {"technical": TechnicalAnalysis, "financial": FinancialAnalysis}.get(kind)
    if modele is None:
        raise ValidationFailed("Type d'analyse inconnu : attendu « technical » ou « financial ».")
    analysis = modele.objects.filter(project=project).first()
    if analysis is None:
        raise ValidationFailed(
            f"Aucune analyse {kind} enregistrée sur ce projet : il n'y a rien à approuver."
        )
    analysis.approved_at = timezone.now()
    analysis.approved_by = by
    analysis.save(update_fields=["approved_at", "approved_by", "updated_at"])
    audit_record(actor=by, action=f"investments.analysis.{kind}.approve", entity_type="Project",
                 entity_id=project.code, details={"kind": kind})
    return project


@transaction.atomic
def clear_conditions(*, project: Project, by: str = "", note: str = "") -> Project:
    """Déclare levées les conditions posées par le comité — condition d'entrée en P06."""
    if project.status != Project.Status.P05:
        raise ValidationFailed(
            "Les conditions ne se lèvent que sur un projet en approbation conditionnelle (P05)."
        )
    if not (project.committee_conditions or "").strip():
        raise ValidationFailed("Aucune condition n'a été enregistrée pour ce projet.")
    project.conditions_cleared_at = timezone.now()
    project.save(update_fields=["conditions_cleared_at", "updated_at"])
    audit_record(actor=by, action="investments.project.conditions_cleared", entity_type="Project",
                 entity_id=project.code, details={"note": note})
    return project


@transaction.atomic
def set_expert_valuation(*, project: Project, amount, valuation_date, source: str = "",
                          by: str = "") -> Project:
    """Enregistre la valorisation d'expert d'un projet — Annexe D, titres de capital.

    Les trois éléments sont indissociables : une valeur sans date ni source n'est pas
    une expertise, c'est une opinion, et `metrics._expert_valuation()` la refusera. On
    refuse donc de l'enregistrer plutôt que de l'enregistrer pour la voir écartée en
    silence à l'affichage. Une expertise antidatée du futur n'existe pas non plus.

    Aucun écrasement muet : l'ancienne valeur part au journal d'audit, qui est
    append-only — la trajectoire des valorisations successives est elle-même une
    donnée (une action réévaluée trois fois en six mois se remarque).
    """
    montant = to_decimal(amount)
    if montant < Decimal("0"):
        raise ValidationFailed("Une valorisation d'expert ne peut pas être négative.")
    jour = to_date(valuation_date)
    if jour is None:
        raise ValidationFailed(
            "La date de la valorisation d'expert est obligatoire : une valeur sans date "
            "n'est pas une expertise."
        )
    if jour > timezone.now().date():
        raise ValidationFailed("La date de la valorisation d'expert ne peut pas être future.")
    if not (source or "").strip():
        raise ValidationFailed(
            "La source de la valorisation d'expert est obligatoire (cabinet, rapport, "
            "référence) : une valorisation sans auteur n'est pas opposable."
        )
    ancien = {
        "amount": str(project.expert_valuation) if project.expert_valuation is not None else None,
        "date": project.expert_valuation_date.isoformat() if project.expert_valuation_date else None,
        "source": project.expert_valuation_source,
    }
    project.expert_valuation = montant
    project.expert_valuation_date = jour
    project.expert_valuation_source = source.strip()
    project.save(update_fields=["expert_valuation", "expert_valuation_date",
                                 "expert_valuation_source", "updated_at"])
    audit_record(actor=by, action="investments.project.expert_valuation", entity_type="Project",
                 entity_id=project.code,
                 details={"previous": ancien, "amount": str(montant), "date": jour.isoformat(),
                          "source": project.expert_valuation_source})
    return project


@transaction.atomic
def create_offer(*, project: Project, code: str, coupon_rate: Decimal | str, maturity_months: int,
                  min_ticket: Decimal | str, available_bonds: int, funding_goal: Decimal | str = "0",
                  min_funding_amount: Decimal | str | None = None, oversubscription_policy: str = "",
                  subscription_deadline=None, type_of_title: str = "", by: str = "") -> Offer:
    """Crée une offre. Le plancher de min-funding, s'il n'est pas donné, est dérivé du
    ratio paramétré en base — jamais d'un nombre écrit dans le code.

    `type_of_title` gouverne la MÉTHODE DE VALORISATION de toutes les positions issues
    de cette offre (`metrics._valuation`) : une obligation se valorise au pair avec ses
    intérêts courus, une action ou une part sociale par expertise datée. Il n'était pas
    exposé ici : aucune offre en titres de capital ne pouvait donc naître par l'API, et
    la branche « expertise » de la valorisation était inatteignable en production. Une
    offre créée sans précision reste une obligation, comme avant.
    """
    if Offer.objects.filter(code=code).exists():
        raise ValidationFailed(f"Le code offre « {code} » existe déjà.")
    titre = type_of_title or Offer.TypeOfTitle.OBLIGATION
    if titre not in Offer.TypeOfTitle.values:
        raise ValidationFailed(
            f"Type de titre inconnu : « {titre} ». Valeurs admises : "
            f"{', '.join(Offer.TypeOfTitle.values)}."
        )
    goal = to_decimal(funding_goal)
    cfg = InvestmentConfig.active()
    if min_funding_amount in (None, ""):
        plancher = (goal * Decimal(cfg.default_min_funding_ratio)).quantize(Decimal("0.01"))
    else:
        plancher = to_decimal(min_funding_amount)
    if plancher > goal:
        raise ValidationFailed(
            f"Le plancher de min-funding ({plancher}) ne peut pas dépasser l'objectif ({goal})."
        )
    politique = (oversubscription_policy or cfg.default_oversubscription_policy or
                 Offer.Oversubscription.QUEUE)
    if politique not in Offer.Oversubscription.values:
        raise ValidationFailed(f"Politique de sursouscription inconnue : « {politique} ».")
    offer = Offer.objects.create(
        project=project, code=code, type_of_title=titre,
        coupon_rate=to_decimal(coupon_rate), maturity_months=maturity_months,
        min_ticket=to_decimal(min_ticket), available_bonds=available_bonds, max_bonds=available_bonds,
        funding_goal=goal, min_funding_amount=plancher, oversubscription_policy=politique,
        subscription_deadline=to_date(subscription_deadline),
    )
    audit_record(actor=by, action="investments.offer.create", entity_type="Offer", entity_id=offer.code,
                 details={"fundingGoal": str(goal), "minFunding": str(plancher), "policy": politique,
                          "typeOfTitle": titre})
    return offer


def subscribe(*, investor: Investor, offer_id: int, bonds: int, idempotency_key: str,
              by: str = "") -> Subscription:
    """Alias historique de `funding.reserve` — une souscription RÉSERVE, elle n'encaisse pas."""
    return funding.reserve(investor=investor, offer_id=offer_id, bonds=bonds,
                            idempotency_key=idempotency_key, by=by)


def _montant(value) -> Decimal:
    """Montant du reporting promoteur, quantizé à 0,01 / `ROUND_HALF_UP` — jamais un `float`."""
    return to_decimal(value or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _quantite(value) -> Decimal:
    """Quantité produite, quantizée à 0,001 (tonnes, litres… — pas un montant)."""
    return to_decimal(value or 0).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _deviation_percent(actual, forecast) -> Decimal:
    """`(réalisé − prévu) / prévu × 100`, en `Decimal`, quantifié à 0,01.

    Sans prévision, il n'y a pas d'écart — pas un écart de 0 % : `0` signifierait
    « conforme à la prévision », ce qui est faux quand aucune prévision n'a été posée.
    On retourne 0 faute de champ nullable dans un modèle déjà consommé, mais
    `has_forecast` ci-dessous permet à l'appelant de distinguer les deux cas.
    """
    prevu = to_decimal(forecast or 0)
    if prevu == 0:
        return Decimal("0.00")
    return ((to_decimal(actual or 0) - prevu) / prevu * Decimal("100")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP)


def submit_performance_report(*, project: Project, data: dict, by: str = "") -> PerformanceReport:
    """Enregistre le reporting du promoteur ET calcule SES écarts — les trois.

    L'écart de revenu était seul calculé côté serveur : les écrans recalculaient donc
    l'écart de coûts eux-mêmes, avec leur propre formule, pour une grandeur qui décide
    d'une observation de risque. Deux formules pour une grandeur, c'est l'incident de
    données du principe 11 en germe. Les trois écarts sont désormais calculés ici, une
    fois, et figés avec le rapport.

    Le seuil d'alerte vient de `InvestmentConfig` (principe 8), et le sens de chaque
    écart est respecté : des coûts SUPÉRIEURS à la prévision sont défavorables, des
    revenus supérieurs ne le sont pas.
    """
    cfg = InvestmentConfig.active()
    seuil = Decimal(cfg.performance_deviation_alert_percent)

    revenu = _deviation_percent(data.get("actualRevenue"), data.get("forecastRevenue"))
    couts = _deviation_percent(data.get("actualCosts"), data.get("forecastCosts"))
    production = _deviation_percent(data.get("actualProduction"), data.get("forecastProduction"))

    # Les montants sont écrits en `Decimal` : le `float(…)` qui les enveloppait
    # reprenait d'une main ce que `to_decimal` donnait de l'autre, et rendait
    # 1 000,10 relisible en 1 000,0999999999999 (principe 4).
    report = PerformanceReport.objects.create(
        project=project, reporting_period=data.get("reportingPeriod", ""),
        actual_revenue=_montant(data.get("actualRevenue")),
        forecast_revenue=_montant(data.get("forecastRevenue")),
        actual_costs=_montant(data.get("actualCosts")),
        forecast_costs=_montant(data.get("forecastCosts")),
        actual_production=_quantite(data.get("actualProduction")),
        forecast_production=_quantite(data.get("forecastProduction")),
        deviation_percent=revenu, cost_deviation_percent=couts,
        production_deviation_percent=production,
        deviation_comments=data.get("deviationComments", ""),
    )

    # Un écart de revenu ou de production s'apprécie en valeur absolue (une prévision
    # dépassée de 40 % est autant un signal sur la QUALITÉ de la prévision qu'un bon
    # résultat — CLAUDE.md §4.3) ; un écart de coûts ne se signale que s'il DÉPASSE.
    alertes = []
    if abs(revenu) > seuil:
        alertes.append(f"revenu {revenu:+} %")
    if couts > seuil:
        alertes.append(f"coûts {couts:+} % au-dessus de la prévision")
    if abs(production) > seuil:
        alertes.append(f"production {production:+} %")
    if alertes:
        AnalystObservation.objects.create(
            project=project, category=AnalystObservation.Category.RISK,
            risk_flag=AnalystObservation.RiskFlag.HIGH,
            observation=(
                f"Écart supérieur au seuil de {seuil} % sur le rapport de performance "
                f"{report.reporting_period or report.pk} : {' ; '.join(alertes)}."
            ),
        )
    audit_record(actor=by, action="investments.performance_report.submit", entity_type="PerformanceReport",
                 entity_id=str(report.pk),
                 details={"deviation_percent": str(revenu), "cost_deviation_percent": str(couts),
                          "production_deviation_percent": str(production), "threshold": str(seuil)})
    return report


@transaction.atomic
def investor_action(*, investor: Investor, action: str, by: str = "") -> Investor:
    """Suspend/réactive un investisseur (pas de suppression — même logique que
    `agencies.services.suspend`/`unlock_temporary`)."""
    if action == "suspend":
        investor.status = Investor.Status.SUSPENDED
    elif action == "activate":
        investor.status = Investor.Status.ACTIVE
    else:
        raise ValidationFailed(f"Action inconnue : {action}")
    investor.save(update_fields=["status", "updated_at"])
    audit_record(actor=by, action=f"investments.investor.{action}", entity_type="Investor",
                 entity_id=str(investor.pk))
    return investor


def portfolio_allocation(*, investor: Investor) -> dict:
    """Allocation du portefeuille — sur l'argent RÉELLEMENT placé.

    Une souscription seulement réservée ne pèse pas dans une allocation d'actifs :
    elle n'est pas un actif, elle est une intention. Seuls les montants encaissés
    comptent (`settled_amount` sur les souscriptions vivantes).
    """
    from caisses.models import ClientWallet

    from .models import ObligationPosition
    bonds_total = Subscription.objects.filter(
        investor=investor, status__in=Subscription.FUNDED_STATUSES,
    ).aggregate(total=Sum("settled_amount"))["total"] or Decimal("0")
    obligations_total = ObligationPosition.objects.filter(investor=investor).aggregate(
        total=Sum("invested_amount"))["total"] or Decimal("0")
    cash_total = ClientWallet.objects.filter(user=investor.user).aggregate(total=Sum("balance"))["total"] or Decimal("0")
    positions_obligataires = ObligationPosition.objects.filter(investor=investor).count()
    return {
        "bonds": float(bonds_total + obligations_total),
        # `bonds` additionne DEUX grandeurs qui ne se valent pas, et le total seul le
        # cachait. À gauche, de l'argent reçu et comptabilisé (B10), rapprochable d'une
        # pièce. À droite, des positions obligataires dont le montant est saisi libre,
        # dont le coupon, le taux et la maturité viennent des défauts du modèle
        # (250 / 9 % / 24 mois) et qui ne sont rattachées à aucune offre — elles
        # n'ont jamais transité par un encaissement.
        #
        # Conséquence mesurable : `GET /metrics/mine` ne compte QUE les souscriptions
        # encaissées, donc le même investisseur lit deux « investi » différents sur
        # deux écrans — l'incident de données du principe 11. Tant que le produit
        # obligataire n'est pas raccroché au cycle des offres, la ventilation est le
        # minimum honnête : le total reste servi tel quel pour ne rien casser, mais
        # sa composition est désormais lisible.
        "bondsFromSubscriptions": float(bonds_total),
        "bondsFromObligationPositions": float(obligations_total),
        "obligationPositionsCount": positions_obligataires,
        "reconciliationWarning": (
            "Les positions obligataires sont incluses dans « bonds » mais absentes de "
            "`metrics/mine.totalInvested`, qui ne compte que les souscriptions "
            "encaissées : les deux écrans afficheront des montants différents pour cet "
            "investisseur tant que ce produit n'est pas rattaché au cycle des offres."
            if obligations_total else None
        ),
        "cash": float(cash_total),
        # Aucun produit actions n'existe encore dans le système — trou produit assumé,
        # pas inventé silencieusement (voir le plan).
        "stocks": 0.0,
    }
