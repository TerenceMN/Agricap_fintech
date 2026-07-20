"""API des taux de change (`ExchangeRateManager`, onglet FX de `ClientWallet.jsx`)."""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from common.parsing import to_date
from rbac.permissions import HasCapability
from rbac.role_registry import get_role

from . import services
from .models import ExchangeRate


def _rate_row(r: ExchangeRate) -> dict:
    return {
        "id": r.pk, "tier": r.tier, "currency": r.currency, "buy": float(r.buy_rate),
        "sell": float(r.sell_rate), "effectiveDate": r.effective_date.isoformat(),
    }


@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def rates(request):
    if request.method == "GET":
        qs = ExchangeRate.objects.all()
        tier = request.GET.get("tier")
        currency = request.GET.get("currency")
        if tier:
            qs = qs.filter(tier=tier)
        if currency:
            qs = qs.filter(currency=currency)
        return Response([_rate_row(r) for r in qs[:200]])
    role = get_role(getattr(request.user, "role", ""))
    if not role.config:
        return Response({"detail": "Capacité requise : config."}, status=403)
    data = request.data or {}
    rate = services.set_rate(
        tier=data.get("tier", "CLIENT"), currency=data.get("currency", "USD"),
        buy=data.get("buy", "0"), sell=data.get("sell", "0"),
        effective_date=to_date(data.get("effectiveDate")), by=getattr(request.user, "sub", ""),
    )
    return Response(_rate_row(rate), status=201)


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def current(request):
    rate = services.current_rate(
        tier=request.GET.get("tier", "CLIENT"), currency=request.GET.get("currency", "USD"),
        on=to_date(request.GET.get("on")),
    )
    if not rate:
        return Response({"detail": "Aucun taux disponible."}, status=404)
    return Response(_rate_row(rate))


@api_view(["POST"])
@permission_classes([HasCapability("config")])
def sync_bcc(request):
    """Synchronise le taux BCC du jour depuis la page publique bcc.cd (pas d'API officielle
    — parsing HTML, cf. services.fetch_bcc_rates). En cas d'échec (site injoignable, format
    de page changé), l'admin garde la main via le formulaire manuel existant (POST /fx/rates)."""
    rates_synced = services.fetch_bcc_rates(by=getattr(request.user, "sub", ""))
    return Response([_rate_row(r) for r in rates_synced])


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def convert(request):
    result = services.convert(
        amount=request.GET.get("amount", "0"), from_currency=request.GET.get("from", "CDF"),
        to_currency=request.GET.get("to", "USD"), tier=request.GET.get("tier", "CLIENT"),
    )
    return Response({"amount": float(result), "from": request.GET.get("from", "CDF"),
                      "to": request.GET.get("to", "USD")})
