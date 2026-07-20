"""Agrégation lecture seule cross-apps (Analytics.jsx, Dashboard.jsx,
MultiCurrencyDashboard.jsx) — aucun modèle autoritaire propre (à l'exception
d'un instantané de score de conformité, cf. `models.py`), cette app ne fait que lire
les autres."""
from __future__ import annotations

from django.db.models import Sum
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from rbac.permissions import HasCapability

from . import services


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def overview(request):
    from agencies.models import Agency
    from caisses.models import TreasuryAccount
    from transactions.models import Transaction

    return Response({
        "activeAgencies": Agency.objects.filter(status=Agency.Status.ACTIF).count(),
        "suspendedAgencies": Agency.objects.filter(status=Agency.Status.SUSPENDU).count(),
        "treasuryTotalUSD": float(
            TreasuryAccount.objects.filter(currency="USD").aggregate(total=Sum("balance"))["total"] or 0
        ),
        "pendingTransactions": Transaction.objects.filter(status="pending_validation").count(),
        "postedTransactions": Transaction.objects.filter(status="posted").count(),
    })


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def compliance_score(request):
    return Response(services.compute_compliance_score())
