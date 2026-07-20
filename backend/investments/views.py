"""API investissements — Project/Offer/Investor/Subscription/Movement + produits
obligataires. Alimente `AdminConsole.jsx`, `AdminInvestments.jsx`, `InvestorSpace.jsx`,
`Obligations.jsx`, `Conversions.jsx`, `Holdings.jsx`, `Opportunities.jsx`, `Portfolios.jsx`."""
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

from . import serializers, services
from .models import (
    AnalystObservation, BondConversion, BondWithdrawal, Collateral, FinancialAnalysis, Investor,
    Movement, Offer, ObligationPosition, PerformanceReport, Project, ProjectQuestion,
    RepaymentSchedule, SecondaryMarketListing, Subscription, SubPortfolio, TechnicalAnalysis,
)


def _my_investor(request):
    return Investor.objects.filter(user=request.user).first()


def _require(request, capability: str) -> bool:
    return bool(getattr(get_role(getattr(request.user, "role", "")), capability, False))


# --- Projects ----------------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def projects(request):
    if request.method == "GET":
        qs = Project.objects.all()
        status = request.GET.get("status")
        if status:
            qs = qs.filter(status=status)
        return Response([serializers.project_row(p) for p in qs])
    if not _require(request, "create"):
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
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    if request.method == "PATCH":
        if not _require(request, "create"):
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
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    analysis = TechnicalAnalysis.objects.filter(project=project).first()
    if not analysis:
        return Response({"detail": "Analyse technique non disponible pour ce projet."}, status=404)
    return Response(serializers.technical_analysis_row(analysis))


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def project_financial_analysis(request, code):
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    analysis = FinancialAnalysis.objects.filter(project=project).first()
    if not analysis:
        return Response({"detail": "Analyse financière non disponible pour ce projet."}, status=404)
    return Response(serializers.financial_analysis_row(analysis))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def project_action(request, code):
    project = Project.objects.filter(code=code).first()
    if not project:
        return Response({"detail": "Projet introuvable."}, status=404)
    to_status = (request.data or {}).get("toStatus")
    project = services.transition_status(project=project, to_status=to_status, by=getattr(request.user, "sub", ""))
    return Response(serializers.project_row(project))


# --- Offers --------------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def offers(request):
    if request.method == "GET":
        qs = Offer.objects.all()
        project_code = request.GET.get("project")
        if project_code:
            qs = qs.filter(project__code=project_code)
        return Response([serializers.offer_row(o) for o in qs])
    if not _require(request, "create"):
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
    qs = Offer.objects.filter(status=Offer.Status.OUVERT, project__status=Project.Status.P06)
    return Response([serializers.offer_row(o) for o in qs])


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def offer_collateral(request, offer_id):
    offer = Offer.objects.filter(pk=offer_id).first()
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
        return Response([serializers.investor_row(i) for i in Investor.objects.all()])
    if not _require(request, "create"):
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
    if request.method == "GET":
        qs = Subscription.objects.all()
        investor_id = request.GET.get("investor")
        if investor_id:
            qs = qs.filter(investor_id=investor_id)
        return Response([serializers.subscription_row(s) for s in qs])
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    investor, _ = Investor.objects.get_or_create(user=request.user)
    try:
        sub = services.subscribe(
            investor=investor, offer_id=data.get("offerId"), bonds=data.get("bonds", 0),
            idempotency_key=key, by=getattr(request.user, "sub", ""),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.subscription_row(sub), status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_subscriptions(request):
    investor = _my_investor(request)
    if not investor:
        return Response([])
    return Response([serializers.subscription_row(s) for s in investor.subscriptions.all()])


# --- Movements / schedules / sub-portfolios --------------------------------

@api_view(["GET"])
@permission_classes([HasCapability("read")])
def movements(request):
    qs = Movement.objects.all()
    investor_id = request.GET.get("investor")
    zone = request.GET.get("zone")
    if investor_id:
        qs = qs.filter(investor_id=investor_id)
    if zone:
        qs = qs.filter(geographic_zone=zone)
    return Response([serializers.movement_row(m) for m in qs[:500]])


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def schedules(request):
    qs = RepaymentSchedule.objects.all()
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
    project_code = request.GET.get("project") if request.method == "GET" else (request.data or {}).get("projectCode")
    project = Project.objects.filter(code=project_code).first()
    if request.method == "GET":
        qs = AnalystObservation.objects.filter(project=project) if project else AnalystObservation.objects.none()
        return Response([
            {"id": o.pk, "projectId": o.project_id, "category": o.category, "riskFlag": o.risk_flag,
             "observation": o.observation, "recommendation": o.recommendation}
            for o in qs
        ])
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
        if request.GET.get("all") and _require(request, "read"):
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
    if request.method == "GET":
        qs = PerformanceReport.objects.all()
        project_code = request.GET.get("project")
        if project_code:
            qs = qs.filter(project__code=project_code)
        return Response([serializers.performance_report_row(r) for r in qs])
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
             "termMonths": p.term_months, "status": p.status, "dateCreated": p.date_created.isoformat()}
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
         "date": w.date.isoformat()}
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
    total_invested = Subscription.objects.aggregate(total=Sum("amount"))["total"] or 0
    return Response({
        "totalProjects": Project.objects.count(),
        "totalInvested": float(total_invested),
        "activeInvestors": Investor.objects.filter(status=Investor.Status.ACTIVE).count(),
        "kycPending": Investor.objects.filter(kyc_status=Investor.KycStatus.EN_ATTENTE).count(),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_portfolio_allocation(request):
    investor, _ = Investor.objects.get_or_create(user=request.user)
    return Response(services.portfolio_allocation(investor=investor))
