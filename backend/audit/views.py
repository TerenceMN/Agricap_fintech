"""API de lecture du journal d'audit (`AuditLog.jsx`) — réservée au personnel disposant de
la capacité `audit`."""
from __future__ import annotations

from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from rbac.permissions import HasCapability

from .models import AuditEntry

# Préfixes d'action = opérations financières/métier réellement effectuées sur la
# plateforme (Supervision.jsx « Activités Récentes ») — PAR OPPOSITION à `agency.*`/
# `rbac.*`, qui sont des actions de configuration/administration système, pas des
# opérations d'AGRICAP FINTECH à superviser financièrement. Liste blanche délibérée (pas
# une exclusion) : un futur type d'action système ne fuite pas silencieusement dans ce
# flux tant qu'il n'est pas explicitement ajouté ici.
FINANCIAL_ACTION_PREFIXES = (
    "transaction.", "investments.", "portfolio.", "caisses.", "savings.",
    "contract.", "fx.", "ledger.", "kyc.", "assets.",
)


def _row(e: AuditEntry, names_by_sub: dict[str, str]) -> dict:
    return {
        "id": e.id,
        "timestamp": e.created_at.isoformat(),
        "user": e.actor,
        "userName": names_by_sub.get(e.actor, e.actor or "Système"),
        "role": e.actor_role,
        "action": e.action,
        "entityType": e.entity_type,
        "entityId": e.entity_id,
        "details": e.details,
        "ip": e.ip_address,
    }


@api_view(["GET"])
@permission_classes([HasCapability("audit")])
def entries(request):
    qs = AuditEntry.objects.all()
    entity_type = request.GET.get("entity_type")
    entity_id = request.GET.get("entity_id")
    actor = request.GET.get("actor")
    category = request.GET.get("category")
    if entity_type:
        qs = qs.filter(entity_type=entity_type)
    if entity_id:
        qs = qs.filter(entity_id=entity_id)
    if actor:
        qs = qs.filter(actor=actor)
    if category == "financial":
        prefix_filter = Q()
        for prefix in FINANCIAL_ACTION_PREFIXES:
            prefix_filter |= Q(action__startswith=prefix)
        qs = qs.filter(prefix_filter)
    rows = list(qs[:500])

    # Résolution `sub` -> nom lisible en un seul aller-retour (pas de FK AuditEntry ->
    # FintechUser : l'acteur d'une action système peut être vide/inexistant, une FK stricte
    # casserait l'écriture de l'entrée d'audit elle-même).
    from accounts.models import FintechUser
    actors = {e.actor for e in rows if e.actor}
    names_by_sub = {
        u.sub: (u.full_name or u.email)
        for u in FintechUser.objects.filter(sub__in=actors)
    }
    return Response([_row(e, names_by_sub) for e in rows])
