"""API épargne (Savings.jsx + admin/savings/*) — CRUD léger, toujours audité."""
from __future__ import annotations

from django.db.models import F
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit.services import record as audit_record
from common.parsing import to_decimal
from rbac.permissions import HasCapability
from rbac.role_registry import get_role

from .models import GroupIntegrationRequest, SavingsDeposit, SavingsGroup, SavingsGroupMember, SavingsPlan


def _plan_row(p: SavingsPlan) -> dict:
    return {
        "id": p.pk, "name": p.name, "objectiveType": p.objective_type, "type": p.plan_type,
        "objectif": float(p.objectif), "balance": float(p.balance), "status": p.status,
        "currency": p.currency, "accruedInterest": float(p.accrued_interest),
        "interestRate": float(p.interest_rate),
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def my_plans(request):
    if request.method == "GET":
        return Response([_plan_row(p) for p in SavingsPlan.objects.filter(user=request.user)])
    data = request.data or {}
    plan = SavingsPlan.objects.create(
        user=request.user, name=data.get("name", ""), objective_type=data.get("objectiveType", "autre"),
        plan_type=data.get("type", "campagne"), objectif=data.get("objectif", "0"),
        currency=data.get("currency", "USD"),
    )
    audit_record(actor=getattr(request.user, "sub", ""), action="savings.plan.create",
                 entity_type="SavingsPlan", entity_id=str(plan.pk))
    return Response(_plan_row(plan), status=201)


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def all_plans(request):
    """Vue admin (AdminSavingsTable) — tous les plans, tous titulaires."""
    plans = SavingsPlan.objects.select_related("user").all()
    return Response([
        {**_plan_row(p), "holder": p.user.full_name or p.user.email} for p in plans
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def plan_deposit(request, plan_id):
    plan = SavingsPlan.objects.filter(pk=plan_id, user=request.user).first()
    if not plan:
        return Response({"detail": "Plan introuvable."}, status=404)
    amount = to_decimal((request.data or {}).get("amount"))
    channel = (request.data or {}).get("channel", SavingsPlan.Channel.AGENT)
    SavingsDeposit.objects.create(plan=plan, amount=amount, channel=channel)
    SavingsPlan.objects.filter(pk=plan.pk).update(balance=F("balance") + amount)
    plan.refresh_from_db()
    audit_record(actor=getattr(request.user, "sub", ""), action="savings.plan.deposit",
                 entity_type="SavingsPlan", entity_id=str(plan.pk), details={"amount": str(amount)})
    return Response(_plan_row(plan))


def _group_row(g: SavingsGroup) -> dict:
    return {
        "id": g.pk, "name": g.name, "type": g.type, "description": g.description,
        "rate": float(g.rate), "frequency": g.frequency, "balance": float(g.balance),
        "membersCount": g.members.count(),
        "members": [m.user.full_name or m.user.email for m in g.members.select_related("user").all()],
        "status": "Actif",  # pas de cycle de vie suspendu/fermé pour les groupes à ce stade
    }


@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def groups(request):
    if request.method == "GET":
        return Response([_group_row(g) for g in SavingsGroup.objects.all()])
    if not get_role(getattr(request.user, "role", "")).create:
        return Response({"detail": "Capacité requise : create."}, status=403)
    data = request.data or {}
    group = SavingsGroup.objects.create(
        name=data.get("name", ""), type=data.get("type", "AVEC"), description=data.get("description", ""),
        rate=data.get("rate", "6.0"), frequency=data.get("frequency", "mensuel"),
        admin_sub=getattr(request.user, "sub", ""),
    )
    audit_record(actor=getattr(request.user, "sub", ""), action="savings.group.create",
                 entity_type="SavingsGroup", entity_id=str(group.pk))
    return Response(_group_row(group), status=201)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([HasCapability("read")])
def group_detail(request, group_id):
    group = SavingsGroup.objects.filter(pk=group_id).first()
    if not group:
        return Response({"detail": "Groupe introuvable."}, status=404)
    role = get_role(getattr(request.user, "role", ""))
    if request.method == "DELETE":
        if not role.config:
            return Response({"detail": "Capacité requise : config."}, status=403)
        group.delete()
        return Response({"detail": "Groupe supprimé."})
    if request.method == "PATCH":
        if not role.create:
            return Response({"detail": "Capacité requise : create."}, status=403)
        data = request.data or {}
        for field, model_field in (("name", "name"), ("description", "description"), ("rate", "rate"),
                                    ("frequency", "frequency")):
            if field in data:
                setattr(group, model_field, data[field])
        group.save()
        audit_record(actor=getattr(request.user, "sub", ""), action="savings.group.update",
                     entity_type="SavingsGroup", entity_id=str(group.pk))
    return Response(_group_row(group))


@api_view(["GET"])
@permission_classes([HasCapability("validate")])
def all_group_requests(request):
    """Vue admin (AdminGroupsTable) — toutes les demandes d'intégration, tous groupes."""
    reqs = GroupIntegrationRequest.objects.select_related("group", "user").all()
    return Response([
        {"id": r.pk, "groupId": r.group_id, "groupName": r.group.name,
         "userName": r.user.full_name or r.user.email, "reason": r.reason, "status": r.status,
         "date": r.created_at.isoformat()}
        for r in reqs
    ])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_groups(request):
    memberships = SavingsGroupMember.objects.filter(user=request.user).select_related("group")
    return Response([
        {"id": m.group.pk, "name": m.group.name, "type": m.group.type, "rate": float(m.group.rate),
         "frequency": m.group.frequency, "balance": float(m.group.balance)}
        for m in memberships
    ])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_group_requests(request):
    reqs = GroupIntegrationRequest.objects.filter(user=request.user).select_related("group")
    return Response([
        {"id": r.pk, "groupName": r.group.name, "reason": r.reason, "status": r.status,
         "date": r.created_at.isoformat()}
        for r in reqs
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def request_group_integration(request, group_id):
    group = SavingsGroup.objects.filter(pk=group_id).first()
    if not group:
        return Response({"detail": "Groupe introuvable."}, status=404)
    req = GroupIntegrationRequest.objects.create(
        group=group, user=request.user, reason=(request.data or {}).get("reason", ""),
    )
    return Response({"id": req.pk, "status": req.status}, status=201)


@api_view(["GET"])
@permission_classes([HasCapability("validate")])
def group_integration_requests(request, group_id):
    reqs = GroupIntegrationRequest.objects.filter(group_id=group_id)
    return Response([{"id": r.pk, "userSub": r.user_id, "reason": r.reason, "status": r.status} for r in reqs])


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def decide_group_integration(request, request_id):
    req = GroupIntegrationRequest.objects.filter(pk=request_id).first()
    if not req:
        return Response({"detail": "Demande introuvable."}, status=404)
    decision = (request.data or {}).get("decision")
    if decision not in ("approved", "rejected"):
        return Response({"detail": "decision doit être 'approved' ou 'rejected'."}, status=400)
    req.status = decision
    req.save(update_fields=["status"])
    if decision == "approved":
        SavingsGroupMember.objects.get_or_create(group=req.group, user=req.user)
    audit_record(actor=getattr(request.user, "sub", ""), action="savings.group.integration_decision",
                 entity_type="GroupIntegrationRequest", entity_id=str(req.pk), details={"decision": decision})
    return Response({"id": req.pk, "status": req.status})
