"""API investissements — Project/Offer/Investor/Subscription/Movement + produits
obligataires. Alimente `AdminConsole.jsx`, `AdminInvestments.jsx`, `InvestorSpace.jsx`,
`Obligations.jsx`, `Conversions.jsx`, `Holdings.jsx`, `Opportunities.jsx`, `Portfolios.jsx`.

**Asymétrie d'information (§5.2 du prompt HAZINA).** Un investisseur voit SON argent et
les projets OUVERTS. Il ne voit ni les données des autres investisseurs, ni les dossiers
en due diligence (P01→P05) autrement qu'en pipeline agrégé anonymisé. La règle est
appliquée ici, dans le filtrage des vues — pas dans l'affichage : un front ne protège
rien.
"""
from __future__ import annotations

from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common import idempotency
from rbac.permissions import HasCapability
from rbac.role_registry import get_role

from . import committee, funding, metrics, serializers, services, workflow
from .models import (
    AnalystObservation, BondConversion, BondWithdrawal, Collateral, Distribution,
    FinancialAnalysis, InvestmentEvent, Investor, Movement, Offer, ObligationPosition,
    PerformanceReport, Project, ProjectQuestion, ProjectTransition, RepaymentSchedule,
    SecondaryMarketListing, Subscription, SubPortfolio, TechnicalAnalysis,
)

#: Statuts d'un projet visibles par un investisseur : la levée ouverte et tout ce qui
#: suit (il a le droit de suivre un projet dans lequel il a mis de l'argent). Les
#: étapes P01→P05 relèvent de l'instruction interne.
PUBLIC_PROJECT_STATUSES = (
    Project.Status.P06, Project.Status.P07, Project.Status.P08, Project.Status.P09,
    Project.Status.P10, Project.Status.P11, Project.Status.P12,
)


def _my_investor(request):
    return Investor.objects.filter(user=request.user).first()


def _require(request, capability: str) -> bool:
    return bool(getattr(get_role(getattr(request.user, "role", "")), capability, False))


def _is_staff(request) -> bool:
    """Personnel de l'institution, par TYPE de rôle et non par capacité.

    Le rôle `invest` porte `create` (il crée ses souscriptions) : tester `create` pour
    distinguer le personnel du client donnerait l'instruction des dossiers aux
    investisseurs. Le type du rôle est le seul discriminant correct.
    """
    return getattr(get_role(getattr(request.user, "role", "")), "type", "Client") != "Client"


def _visible_projects(request):
    """Projets visibles par l'appelant — tout pour le personnel, P06+ pour un client."""
    qs = Project.objects.all()
    if _is_staff(request):
        return qs
    return qs.filter(status__in=PUBLIC_PROJECT_STATUSES)


def _visible_offers(request):
    """Offres visibles par l'appelant.

    Une offre est un satellite de son projet : si le dossier est en due diligence, son
    offre — objectif de levée, taux de coupon, garanties — l'est aussi. Sans ce
    filtre, `GET /offers` révélait à n'importe quel investisseur l'existence, le
    montage et le montant de chaque dossier P01→P05 (le rôle `invest` porte `read`).
    """
    qs = Offer.objects.filter(project__in=_visible_projects(request))
    if _is_staff(request):
        return qs
    #: Un brouillon d'offre n'est pas une offre : il n'est pas encore opposable.
    return qs.exclude(status__in=(Offer.Status.DRAFT, Offer.Status.PREPARATION))


def _committee_error(exc) -> Response:
    """Les exceptions du comité viennent de `credits.committee` : elles portent leur
    `code` et leur `http_status` mais ne dérivent pas de `BusinessError`, donc le
    handler global ne les mappe pas. On les mappe ici, à l'identique du module crédit."""
    return Response({"detail": str(exc), "code": exc.code, "errors": exc.as_errors()},
                     status=exc.http_status)


# --- Projects ----------------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def projects(request):
    if request.method == "GET":
        qs = _visible_projects(request)
        status = request.GET.get("status")
        if status:
            qs = qs.filter(status=status)
        # Forme de liste conservée telle quelle : le front existant la consomme ainsi,
        # et cette liste n'est jamais tronquée (pas de `total_rows` à annoncer).
        return Response([serializers.project_row(p) for p in qs])
    if not _is_staff(request) or not _require(request, "create"):
        return Response({"detail": "Capacité requise : create."}, status=403)
    data = request.data or {}
    project = services.create_project(
        code=data.get("code", ""), title=data.get("title", ""), sector=data.get("sector", ""),
        location=data.get("location", ""), funding_target=data.get("fundingTarget", "0"),
        promoter=data.get("promoter", ""), manager_sub=getattr(request.user, "sub", ""),
        by=getattr(request.user, "sub", ""),
    )
    return Response(serializers.project_row(project), status=201)


@api_view(["GET", "PATCH"])
@permission_classes([HasCapability("read")])
def project_detail(request, code):
    project = _visible_projects(request).filter(code=code).first()
    if not project:
        # 404 volontaire et non 403 : révéler l'existence d'un dossier en due
        # diligence est déjà une fuite d'information.
        return Response({"detail": "Projet introuvable."}, status=404)
    if request.method == "PATCH":
        if not _is_staff(request) or not _require(request, "create"):
            return Response({"detail": "Capacité requise : create."}, status=403)
        data = request.data or {}
        for field, model_field in (
            ("title", "title"), ("description", "description"), ("objectives", "objectives"),
            ("riskAnalysis", "risk_analysis"), ("impactEsg", "impact_esg"),
            ("riskScore", "risk_score"), ("globalScore", "global_score"),
        ):
            if field in data:
                setattr(project, model_field, data[field])
        project.save()
    return Response(serializers.project_detail_row(project))


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def project_technical_analysis(request, code):
    project = _visible_projects(request).filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    analysis = TechnicalAnalysis.objects.filter(project=project).first()
    if not analysis:
        return Response({"detail": "Analyse technique non disponible pour ce projet."}, status=404)
    return Response(serializers.technical_analysis_row(analysis))


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def project_financial_analysis(request, code):
    project = _visible_projects(request).filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    analysis = FinancialAnalysis.objects.filter(project=project).first()
    if not analysis:
        return Response({"detail": "Analyse financière non disponible pour ce projet."}, status=404)
    return Response(serializers.financial_analysis_row(analysis))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_analysis_approve(request, code):
    """Approbation datée d'une analyse — condition d'entrée en comité (P04)."""
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    kind = (request.data or {}).get("kind", "")
    project = services.approve_analysis(project=project, kind=kind, by=getattr(request.user, "sub", ""))
    return Response(serializers.project_row(project))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_clear_conditions(request, code):
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    project = services.clear_conditions(project=project, by=getattr(request.user, "sub", ""),
                                         note=data.get("note", ""))
    return Response(serializers.project_row(project))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_expert_valuation(request, code):
    """Enregistre la valorisation d'expert DATÉE d'un projet (Annexe D).

    C'est le seul intrant de la valorisation des titres de capital : sans elle,
    `metrics` retombe au pair et l'annonce. Acte de personnel — un investisseur ne
    valorise pas lui-même la ligne qu'il détient.
    """
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    project = services.set_expert_valuation(
        project=project, amount=data.get("amount", "0"), valuation_date=data.get("valuationDate"),
        source=data.get("source", ""), by=getattr(request.user, "sub", ""),
    )
    return Response(serializers.project_detail_row(project))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_action(request, code):
    """Transition explicite de la machine à états. Le motif est obligatoire.

    Les transitions à effet monétaire (clôture de souscription, décaissement,
    annulation avec remboursement) ont leurs propres endpoints : elles ne sont pas
    un simple changement de statut et ne passent pas par ici.
    """
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    to_status = data.get("toStatus")
    if to_status in (Project.Status.P07, Project.Status.P08):
        return Response(
            {"detail": "Cette étape a son propre endpoint (clôture de souscription, "
                       "décaissement) : elle ne se déclenche pas par un changement de statut.",
             "code": "USE_DEDICATED_ENDPOINT"},
            status=409,
        )
    project = services.transition_status(
        project=project, to_status=to_status, by=getattr(request.user, "sub", ""),
        reason=data.get("reason", ""), actor_role=getattr(request.user, "role", ""),
    )
    return Response(serializers.project_row(project))


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def project_transitions(request, code):
    """Historique append-only des transitions d'un projet — lecture seule absolue."""
    project = _visible_projects(request).filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    rows = [
        {"fromStatus": t.from_status, "toStatus": t.to_status, "actor": t.actor_sub,
         "actorRole": t.actor_role, "reason": t.reason, "details": t.details,
         "createdAt": t.created_at.isoformat()}
        for t in ProjectTransition.objects.filter(project=project)
    ]
    return Response({"projectCode": project.code, "currentStatus": project.status,
                     "allowedTargets": sorted(workflow.allowed_targets(project.status)),
                     "transitions": rows, "totalRows": len(rows)})


# --- Comité d'investissement (P04) -------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("validate")])
def project_committee_votes(request, code):
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    if request.method == "GET":
        payload = committee.votes_summary(project)
        payload["procesVerbal"] = committee.proces_verbal(project)
        return Response(payload)
    data = request.data or {}
    try:
        result = committee.cast_vote(
            project, voter_sub=getattr(request.user, "sub", ""), decision=data.get("decision", ""),
            comment=data.get("comment", ""), conditions=data.get("conditions", ""),
        )
    except committee.CommitteeError as exc:
        return _committee_error(exc)
    return Response(result, status=201)


# --- Offers --------------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def offers(request):
    if request.method == "GET":
        qs = _visible_offers(request)
        project_code = request.GET.get("project")
        if project_code:
            qs = qs.filter(project__code=project_code)
        return Response([serializers.offer_row(o) for o in qs])
    if not _is_staff(request) or not _require(request, "create"):
        return Response({"detail": "Capacité requise : create."}, status=403)
    data = request.data or {}
    project = Project.objects.filter(code=data.get("projectCode")).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    offer = services.create_offer(
        project=project, code=data.get("code", ""), coupon_rate=data.get("couponRate", "0"),
        maturity_months=data.get("maturityMonths", 24), min_ticket=data.get("minTicket", "0"),
        available_bonds=data.get("availableBonds", 0), funding_goal=data.get("fundingGoal", "0"),
        by=getattr(request.user, "sub", ""),
    )
    return Response(serializers.offer_row(offer), status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def offers_open(request):
    """Offres réellement ouvertes — le seul détail projet auquel un investisseur a droit
    avant d'engager son argent."""
    return Response(metrics.open_offers_summary())


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def offer_close(request, offer_id):
    offer = Offer.objects.filter(pk=offer_id).first()
    if not offer:
        return Response({"detail": "Offre introuvable."}, status=404)
    offer = funding.close_offer(offer=offer, by=getattr(request.user, "sub", ""))
    return Response(serializers.offer_row(offer))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def offer_distribute(request, offer_id):
    """Distribution au prorata des souscriptions ENCAISSÉES (B13)."""
    offer = Offer.objects.select_related("project").filter(pk=offer_id).first()
    if not offer:
        return Response({"detail": "Offre introuvable."}, status=404)
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    try:
        distribution = funding.distribute(
            offer=offer, amount=data.get("amount", "0"),
            kind=data.get("kind", Distribution.Kind.COUPON), idempotency_key=key,
            by=getattr(request.user, "sub", ""), value_date=data.get("valueDate"),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.distribution_row(distribution), status=201)


# --- Levée : clôture, décaissement, retours ----------------------------------

@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_close_fundraising(request, code):
    """P06 → P07 (min-funding atteint) ou P06 → P13 avec remboursements (min-funding raté)."""
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    project = funding.close_fundraising(project=project, by=getattr(request.user, "sub", ""),
                                         reason=data.get("reason", ""))
    return Response(serializers.project_row(project))


@api_view(["POST"])
@permission_classes([HasCapability("disburse")])
def project_disburse(request, code):
    """P07 → P08 : décaissement vers le promoteur (B11). Jamais avant clôture."""
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    try:
        project = funding.disburse(project=project, amount=data.get("amount", "0"),
                                    idempotency_key=key, by=getattr(request.user, "sub", ""),
                                    reason=data.get("reason", ""))
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.project_row(project))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_record_return(request, code):
    """Encaissement d'un retour du projet (B12) — préalable à toute distribution."""
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    try:
        project = funding.record_return(project=project, amount=data.get("amount", "0"),
                                         idempotency_key=key, by=getattr(request.user, "sub", ""),
                                         value_date=data.get("valueDate"),
                                         reason=data.get("reason", ""))
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.project_row(project))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_cancel(request, code):
    """P13 : annulation avec remboursement des souscriptions encaissées."""
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    project = funding.cancel_project(project=project, by=getattr(request.user, "sub", ""),
                                      reason=data.get("reason", ""))
    return Response(serializers.project_row(project))


@api_view(["GET"])
@permission_classes([HasCapability("audit")])
def accounting_events(request):
    """File des événements métier destinés au moteur d'écritures (B10→B13).

    Lecture seule : `investments` produit, `accounting` consomme. Le filtre
    `?pending=1` sert le consommateur ; l'auditeur, lui, relit tout.
    """
    qs = InvestmentEvent.objects.all()
    if request.GET.get("pending"):
        qs = qs.filter(consumed_at__isnull=True)
    if request.GET.get("project"):
        qs = qs.filter(project__code=request.GET["project"])
    if request.GET.get("type"):
        qs = qs.filter(event_type=request.GET["type"])
    total = qs.count()
    rows = [serializers.investment_event_row(e) for e in qs[:500]]
    return Response({"results": rows, "totalRows": total, "returned": len(rows)})


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def offer_collateral(request, offer_id):
    offer = _visible_offers(request).filter(pk=offer_id).first()
    if not offer:
        return Response({"detail": "Offre introuvable."}, status=404)
    collateral = Collateral.objects.filter(offer=offer).first()
    if not collateral:
        return Response({"detail": "Aucune garantie renseignée pour cette offre."}, status=404)
    return Response(serializers.collateral_row(collateral))


# --- Investors -----------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def investors(request):
    if request.method == "GET":
        # Un investisseur ne voit jamais les autres investisseurs.
        if not _is_staff(request):
            return Response({"detail": "Réservé au personnel de l'institution."}, status=403)
        return Response([serializers.investor_row(i) for i in Investor.objects.all()])
    if not _is_staff(request) or not _require(request, "create"):
        return Response({"detail": "Capacité requise : create."}, status=403)
    data = request.data or {}
    from accounts.models import FintechUser
    user = FintechUser.objects.filter(sub=data.get("userSub")).first()
    if not user:
        return Response({"detail": "Utilisateur IdP introuvable (doit s'être connecté au moins une fois)."},
                         status=404)
    investor, _ = Investor.objects.update_or_create(
        user=user, defaults={"investor_type": data.get("investorType", "INDIVIDUAL"),
                              "assigned_manager_sub": data.get("assignedManagerSub", "")},
    )
    return Response(serializers.investor_row(investor), status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_investor_profile(request):
    investor, _ = Investor.objects.get_or_create(user=request.user)
    return Response(serializers.investor_row(investor))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def investor_action(request, investor_id):
    investor = Investor.objects.filter(pk=investor_id).first()
    if not investor:
        return Response({"detail": "Investisseur introuvable."}, status=404)
    action = (request.data or {}).get("action")
    investor = services.investor_action(investor=investor, action=action, by=getattr(request.user, "sub", ""))
    return Response(serializers.investor_row(investor))


# --- Subscriptions ---------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def subscriptions(request):
    """POST = RÉSERVATION, pas encaissement (voir `subscription_settle`).

    En lecture, un investisseur ne voit que SES souscriptions : le filtre `?investor=`
    n'est honoré que pour le personnel. Sans cette règle, `?investor=42` exposerait le
    portefeuille du voisin.
    """
    if request.method == "GET":
        if _is_staff(request):
            qs = Subscription.objects.all()
            investor_id = request.GET.get("investor")
            if investor_id:
                qs = qs.filter(investor_id=investor_id)
        else:
            investor = _my_investor(request)
            qs = Subscription.objects.filter(investor=investor) if investor else Subscription.objects.none()
        return Response([serializers.subscription_row(s) for s in qs])
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    investor, _ = Investor.objects.get_or_create(user=request.user)
    try:
        sub = funding.reserve(
            investor=investor, offer_id=data.get("offerId"), bonds=data.get("bonds", 0),
            idempotency_key=key, by=getattr(request.user, "sub", ""),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.subscription_row(sub), status=201)


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def subscription_settle(request, subscription_id):
    """Encaissement d'une souscription réservée (B10) — événement distinct de la
    réservation, réservé au personnel qui constate l'arrivée des fonds."""
    sub = Subscription.objects.filter(pk=subscription_id).first()
    if not sub:
        return Response({"detail": "Souscription introuvable."}, status=404)
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    try:
        sub = funding.settle(subscription=sub, idempotency_key=key,
                              by=getattr(request.user, "sub", ""), amount=data.get("amount"),
                              value_date=data.get("valueDate"))
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.subscription_row(sub))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def subscription_cancel(request, subscription_id):
    """Annulation d'une réservation NON encaissée — par son titulaire ou le personnel."""
    sub = Subscription.objects.filter(pk=subscription_id).first()
    if not sub:
        return Response({"detail": "Souscription introuvable."}, status=404)
    if not _is_staff(request) and sub.investor_id != getattr(_my_investor(request), "pk", None):
        return Response({"detail": "Souscription introuvable."}, status=404)
    sub = funding.cancel_reservation(subscription=sub, by=getattr(request.user, "sub", ""),
                                      reason=(request.data or {}).get("reason", ""))
    return Response(serializers.subscription_row(sub))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_subscriptions(request):
    investor = _my_investor(request)
    if not investor:
        return Response([])
    return Response([serializers.subscription_row(s) for s in investor.subscriptions.all()])


# --- Métriques (Annexe D) ----------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_metrics(request):
    """Le tableau de bord de l'investisseur — SON argent, sur SES flux réels."""
    investor, _ = Investor.objects.get_or_create(user=request.user)
    return Response(metrics.investor_metrics(investor))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def pipeline(request):
    """Pipeline P01→P05 : agrégé et anonymisé pour un client, détaillé pour le personnel."""
    if _is_staff(request):
        return Response({
            "stages": metrics.anonymised_pipeline(),
            "projects": [serializers.project_row(p) for p in Project.objects.filter(
                status__in=[Project.Status.P01, Project.Status.P02, Project.Status.P03,
                            Project.Status.P04, Project.Status.P05])],
        })
    return Response({"stages": metrics.anonymised_pipeline(), "projects": []})


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def portfolio_metrics(request):
    """Métriques institution — XIRR sur flux réels, défaut valeur ET nombre,
    Herfindahl, score de santé avec sa formule et ses paramètres."""
    if not _is_staff(request):
        return Response({"detail": "Réservé au personnel de l'institution."}, status=403)
    return Response(metrics.portfolio_metrics())


# --- Movements / schedules / sub-portfolios --------------------------------

@api_view(["GET"])
@permission_classes([HasCapability("read")])
def movements(request):
    if _is_staff(request):
        qs = Movement.objects.all()
        investor_id = request.GET.get("investor")
        if investor_id:
            qs = qs.filter(investor_id=investor_id)
        zone = request.GET.get("zone")
        if zone:
            qs = qs.filter(geographic_zone=zone)
    else:
        # Un investisseur ne voit que SES mouvements — jamais ceux d'un autre.
        investor = _my_investor(request)
        qs = Movement.objects.filter(investor=investor) if investor else Movement.objects.none()
    # Forme de liste conservée (le front la consomme telle quelle) ; la troncature à
    # 500 lignes et la pagination associée sont à traiter dans le lot front.
    return Response([serializers.movement_row(m) for m in qs[:500]])


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def schedules(request):
    """Échéanciers de retour (B12) — bornés aux offres visibles par l'appelant : un
    échéancier révèle le montage financier de son offre, donc de son projet."""
    qs = RepaymentSchedule.objects.filter(offer__in=_visible_offers(request))
    offer_id = request.GET.get("offer")
    if offer_id:
        qs = qs.filter(offer_id=offer_id)
    return Response([
        {"id": s.pk, "offerId": s.offer_id, "dueDate": s.due_date.isoformat(), "amountDue": float(s.amount_due),
         "kind": s.kind, "status": s.status}
        for s in qs
    ])


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sub_portfolios(request):
    investor = _my_investor(request)
    if request.method == "GET":
        if not investor:
            return Response([])
        return Response([
            {"id": sp.pk, "name": sp.name, "description": sp.description} for sp in investor.sub_portfolios.all()
        ])
    if not investor:
        investor, _ = Investor.objects.get_or_create(user=request.user)
    data = request.data or {}
    sp = SubPortfolio.objects.create(investor=investor, name=data.get("name", ""),
                                      description=data.get("description", ""))
    return Response({"id": sp.pk, "name": sp.name, "description": sp.description}, status=201)


# --- Observations / questions / performance reports ------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def observations(request):
    """Observations d'analyste. En lecture, elles suivent la visibilité du PROJET :
    les remarques de risque d'un dossier en due diligence ne s'affichent pas à un
    investisseur qui connaîtrait le code. En écriture, elles sont un acte d'analyste —
    donc du personnel : un investisseur ne rédige pas l'analyse de risque du dossier
    dans lequel il place son argent."""
    project_code = request.GET.get("project") if request.method == "GET" else (request.data or {}).get("projectCode")
    project = _visible_projects(request).filter(code=project_code).first()
    if request.method == "GET":
        qs = AnalystObservation.objects.filter(project=project) if project else AnalystObservation.objects.none()
        return Response([
            {"id": o.pk, "projectId": o.project_id, "category": o.category, "riskFlag": o.risk_flag,
             "observation": o.observation, "recommendation": o.recommendation}
            for o in qs
        ])
    if not _is_staff(request) or not _require(request, "create"):
        return Response({"detail": "Capacité requise : create (personnel de l'institution)."}, status=403)
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    data = request.data or {}
    obs = AnalystObservation.objects.create(
        project=project, analyst_name=data.get("analystName", ""), category=data.get("category", "RISK"),
        risk_flag=data.get("riskFlag", "LOW"), observation=data.get("observation", ""),
        recommendation=data.get("recommendation", ""),
    )
    return Response({"id": obs.pk}, status=201)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def questions(request):
    if request.method == "GET":
        investor = _my_investor(request)
        qs = ProjectQuestion.objects.filter(investor=investor) if investor else ProjectQuestion.objects.none()
        # `?all=1` était gardé par la capacité `read` — que le rôle `invest` PORTE :
        # n'importe quel investisseur récupérait ainsi les questions de tous les autres
        # (leur identifiant, leurs projets, leurs préoccupations). La corbeille des
        # questions est un écran de personnel.
        if request.GET.get("all") and _is_staff(request) and _require(request, "read"):
            qs = ProjectQuestion.objects.all()
        project_code = request.GET.get("project")
        if project_code:
            qs = qs.filter(project__code=project_code)
        return Response([
            {"id": q.pk, "projectId": q.project_id, "question": q.question, "questionDate": q.question_date.isoformat(),
             "answer": q.answer, "answerDate": q.answer_date.isoformat() if q.answer_date else None,
             "answeredBy": q.answered_by, "status": q.status}
            for q in qs
        ])
    data = request.data or {}
    project = Project.objects.filter(code=data.get("projectCode")).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    investor, _ = Investor.objects.get_or_create(user=request.user)
    q = ProjectQuestion.objects.create(project=project, investor=investor, question=data.get("question", ""))
    return Response({"id": q.pk}, status=201)


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def question_answer(request, question_id):
    q = ProjectQuestion.objects.filter(pk=question_id).first()
    if not q:
        return Response({"detail": "Question introuvable."}, status=404)
    q.answer = (request.data or {}).get("answer", "")
    q.answer_date = timezone.now()
    q.answered_by = getattr(request.user, "sub", "")
    q.status = ProjectQuestion.Status.ANSWERED
    q.save()
    return Response({"id": q.pk, "status": q.status})


@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def performance_reports(request):
    """Reporting du promoteur. Lecture bornée à la visibilité du projet (un
    investisseur suit les projets ouverts et ceux où il a mis de l'argent, pas les
    dossiers en instruction) ; dépôt réservé au personnel, qui saisit le reporting
    reçu du promoteur — celui-ci n'est pas un utilisateur du système."""
    if request.method == "GET":
        qs = PerformanceReport.objects.filter(project__in=_visible_projects(request))
        project_code = request.GET.get("project")
        if project_code:
            qs = qs.filter(project__code=project_code)
        return Response([serializers.performance_report_row(r) for r in qs])
    if not _is_staff(request) or not _require(request, "create"):
        return Response({"detail": "Capacité requise : create (personnel de l'institution)."}, status=403)
    data = request.data or {}
    project = Project.objects.filter(code=data.get("projectCode")).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    report = services.submit_performance_report(project=project, data=data, by=getattr(request.user, "sub", ""))
    return Response({"id": report.pk, "deviationPercent": report.deviation_percent}, status=201)


# --- Obligations (produit épargne obligataire client) -----------------------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def obligations(request):
    investor, _ = Investor.objects.get_or_create(user=request.user)
    if request.method == "GET":
        return Response([
            {"id": p.pk, "name": p.name, "couponAmount": float(p.coupon_amount),
             "investedAmount": float(p.invested_amount), "rate": float(p.rate),
             "termMonths": p.term_months, "status": p.status, "dateCreated": p.date_created.isoformat(),
             "units": serializers.OBLIGATION_RATE_UNITS}
            for p in investor.obligation_positions.all()
        ])
    data = request.data or {}
    position = ObligationPosition.objects.create(
        investor=investor, name=data.get("name", "Obligation AGRICAP"),
        invested_amount=data.get("investedAmount", "0"),
    )
    return Response({"id": position.pk}, status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def obligation_withdrawals(request, position_id):
    position = ObligationPosition.objects.filter(pk=position_id, investor__user=request.user).first()
    if not position:
        return Response({"detail": "Position introuvable."}, status=404)
    return Response([
        {"id": w.pk, "positionId": w.position_id, "amount": float(w.amount),
         "penaltyRate": float(w.penalty_rate), "reason": w.reason, "status": w.status,
         "date": w.date.isoformat(), "units": serializers.WITHDRAWAL_RATE_UNITS}
        for w in position.withdrawals.all()
    ])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def obligation_conversions(request, position_id):
    position = ObligationPosition.objects.filter(pk=position_id, investor__user=request.user).first()
    if not position:
        return Response({"detail": "Position introuvable."}, status=404)
    return Response([
        {"id": c.pk, "positionId": c.position_id, "coupons": c.coupons, "value": float(c.value),
         "shares": c.shares, "status": c.status, "date": c.date.isoformat()}
        for c in position.conversions.all()
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def obligation_withdraw(request, position_id):
    position = ObligationPosition.objects.filter(pk=position_id, investor__user=request.user).first()
    if not position:
        return Response({"detail": "Position introuvable."}, status=404)
    data = request.data or {}
    withdrawal = BondWithdrawal.objects.create(
        position=position, amount=data.get("amount", "0"), reason=data.get("reason", ""),
    )
    return Response({"id": withdrawal.pk, "status": withdrawal.status}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def obligation_convert(request, position_id):
    position = ObligationPosition.objects.filter(pk=position_id, investor__user=request.user).first()
    if not position:
        return Response({"detail": "Position introuvable."}, status=404)
    data = request.data or {}
    coupons = int(data.get("coupons", 0) or 0)
    value = position.coupon_amount * coupons
    shares = int(value // Decimal("100"))
    conversion = BondConversion.objects.create(position=position, coupons=coupons, value=value, shares=shares)
    return Response({"id": conversion.pk, "shares": shares}, status=201)


# --- Secondary market -------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def secondary_market(request):
    if request.method == "GET":
        qs = SecondaryMarketListing.objects.filter(status=SecondaryMarketListing.Status.OPEN)
        return Response([
            {"id": l.pk, "subscriptionId": l.subscription_id, "askPrice": float(l.ask_price), "status": l.status}
            for l in qs
        ])
    investor, _ = Investor.objects.get_or_create(user=request.user)
    data = request.data or {}
    sub = Subscription.objects.filter(pk=data.get("subscriptionId"), investor=investor).first()
    if not sub:
        return Response({"detail": "Souscription introuvable."}, status=404)
    listing = SecondaryMarketListing.objects.create(subscription=sub, ask_price=data.get("askPrice", "0"))
    return Response({"id": listing.pk}, status=201)


# --- Dashboard / portefeuille -----------------------------------------------

@api_view(["GET"])
@permission_classes([HasCapability("read")])
def dashboard_metrics(request):
    """KPI institution. `totalInvested` compte l'argent ENCAISSÉ, pas les réservations :
    additionner des intentions et les appeler « investi » gonflerait le chiffre le plus
    regardé du module."""
    if not _is_staff(request):
        return Response({"detail": "Réservé au personnel de l'institution."}, status=403)
    encaisse = Subscription.objects.filter(
        status__in=Subscription.FUNDED_STATUSES).aggregate(total=Sum("settled_amount"))["total"] or 0
    reserve = Subscription.objects.filter(
        status=Subscription.Status.RESERVED).aggregate(total=Sum("amount"))["total"] or 0
    return Response({
        "totalProjects": Project.objects.count(),
        "totalInvested": float(encaisse),
        "totalReserved": float(reserve),
        # Effectifs des deux agrégats : « 120 000 investis » ne dit rien sans le nombre
        # de souscriptions qui le composent.
        "settledSubscriptionsCount": Subscription.objects.filter(
            status__in=Subscription.FUNDED_STATUSES).count(),
        "reservedSubscriptionsCount": Subscription.objects.filter(
            status=Subscription.Status.RESERVED).count(),
        "activeInvestors": Investor.objects.filter(status=Investor.Status.ACTIVE).count(),
        "kycPending": Investor.objects.filter(kyc_status=Investor.KycStatus.EN_ATTENTE).count(),
        # Devise VÉRIFIÉE sur les flux, pas affirmée : `currency_note` signale toute
        # devise étrangère plutôt que de laisser l'écran additionner des CDF et des USD.
        **metrics.currency_note(distributions=Distribution.objects.all(),
                                  movements=Movement.objects.all()),
        "scope": "Toutes agences, tous projets.",
        "asOf": timezone.now().date().isoformat(),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_portfolio_allocation(request):
    investor, _ = Investor.objects.get_or_create(user=request.user)
    return Response(services.portfolio_allocation(investor=investor))
