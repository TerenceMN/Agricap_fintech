"""API des caisses/comptes de trésorerie (Wallets.jsx, Treasury.jsx) et portefeuilles
clients (ClientWallet.jsx)."""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common import idempotency
from rbac.permissions import HasCapability
from rbac.role_registry import get_role

from . import cash_register, partner_link, regularization, serializers, services, withdrawal_tiers
from .models import CashRegisterSession, ClientWallet, RegularizationOrder, TreasuryAccount, WithdrawalRequest


def _require(request, capability: str) -> bool:
    return bool(getattr(get_role(getattr(request.user, "role", "")), capability, False))


@api_view(["GET", "POST"])
@permission_classes([HasCapability("read")])
def accounts(request):
    if request.method == "GET":
        qs = TreasuryAccount.objects.all()
        agency_id = request.GET.get("agency")
        if agency_id:
            qs = qs.filter(agency_id=agency_id)
        return Response([serializers.account_row(a) for a in qs])
    if not _require(request, "create"):
        return Response({"detail": "Capacité requise : create."}, status=403)
    data = request.data or {}
    account = services.create_treasury_account(
        code=data.get("code", ""), name=data.get("name", ""), kind=data.get("kind", "CAISSE"),
        currency=data.get("currency", "USD"), agency_id=data.get("agencyId"),
        manager_sub=data.get("manager", ""), initial_amount=data.get("initialAmount", "0"),
        by=getattr(request.user, "sub", ""),
    )
    return Response(serializers.account_row(account), status=201)


@api_view(["GET", "PATCH"])
@permission_classes([HasCapability("read")])
def account_detail(request, code):
    account = TreasuryAccount.objects.filter(code=code).first()
    if not account:
        return Response({"detail": "Compte introuvable."}, status=404)
    if request.method == "PATCH":
        if not _require(request, "create"):
            return Response({"detail": "Capacité requise : create."}, status=403)
        data = request.data or {}
        for field, model_field in (("name", "name"), ("manager", "manager_sub"), ("scope", "scope"),
                                    ("riskLevel", "risk_level"), ("status", "status")):
            if field in data:
                setattr(account, model_field, data[field])
        account.save()
    return Response(serializers.account_row(account))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def account_action(request, code):
    account = TreasuryAccount.objects.filter(code=code).first()
    if not account:
        return Response({"detail": "Compte introuvable."}, status=404)
    data = request.data or {}
    action = data.get("action")
    by = getattr(request.user, "sub", "")
    if action == "transfer":
        to_account = TreasuryAccount.objects.filter(code=data.get("toCode")).first()
        if not to_account:
            return Response({"detail": "Compte destination introuvable."}, status=404)
        key = data.get("idempotencyKey")
        if not key:
            return Response({"detail": "idempotencyKey requis."}, status=400)
        try:
            transfer = services.transfer_funds(
                from_account_id=account.pk, to_account_id=to_account.pk,
                amount=data.get("amount", "0"), reason=data.get("reason", ""),
                idempotency_key=key, by=by,
            )
        except idempotency.IdempotentReplay as exc:
            return idempotency.replay_response(exc)
        return Response(serializers.transfer_row(transfer))
    if action == "add_flow":
        key = data.get("idempotencyKey")
        if not key:
            return Response({"detail": "idempotencyKey requis."}, status=400)
        try:
            account = services.adjust_account(
                account_id=account.pk, amount=data.get("amount", "0"), direction=data.get("direction", "in"),
                reason=data.get("reason", ""), idempotency_key=key, by=by,
            )
        except idempotency.IdempotentReplay as exc:
            return idempotency.replay_response(exc)
        return Response(serializers.account_row(account))
    if action == "register_open":
        session = cash_register.open_session(account=account, opening_count=data.get("openingCount", "0"), by=by)
        return Response(serializers.session_row(session), status=201)
    if action == "register_close":
        session = cash_register._open_session_for(account)
        if not session:
            return Response({"detail": "Aucune séance de caisse ouverte pour ce compte."}, status=404)
        session = cash_register.close_session(session=session, closing_count=data.get("closingCount", "0"), by=by)
        return Response(serializers.session_row(session))
    if action == "set_daily_ceiling":
        account.daily_ceiling = data.get("dailyCeiling") or None
        account.save(update_fields=["daily_ceiling", "updated_at"])
        return Response(serializers.account_row(account))
    if action == "link_partner":
        account = partner_link.link_partner(account=account, partner_id=data.get("partnerId"), by=by)
        return Response(serializers.account_row(account))
    if action == "sync_partner":
        result = partner_link.sync_account_partner(account=account, by=by)
        return Response(result)
    if action == "block":
        account.status = TreasuryAccount.Status.BLOQUE
        account.save(update_fields=["status", "updated_at"])
    elif action == "archive":
        account.status = TreasuryAccount.Status.ARCHIVE
        account.save(update_fields=["status", "updated_at"])
    elif action == "reassign":
        account.manager_sub = data.get("manager", account.manager_sub)
        account.save(update_fields=["manager_sub", "updated_at"])
    else:
        return Response({"detail": f"Action inconnue : {action}"}, status=400)
    return Response(serializers.account_row(account))


@api_view(["GET"])
@permission_classes([HasCapability("read")])
def account_register_sessions(request, code):
    account = TreasuryAccount.objects.filter(code=code).first()
    if not account:
        return Response({"detail": "Compte introuvable."}, status=404)
    sessions = CashRegisterSession.objects.select_related("account").filter(account=account)[:100]
    return Response([serializers.session_row(s) for s in sessions])


def _wallet_row(w: ClientWallet) -> dict:
    return {"id": w.pk, "currency": w.currency, "balance": float(w.balance), "status": w.status}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_wallets(request):
    wallets = ClientWallet.objects.filter(user=request.user)
    return Response([_wallet_row(w) for w in wallets])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_movements(request):
    return Response(services.wallet_movements(user=request.user))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_withdrawal_requests(request):
    """Visibilité client sur ses propres demandes de retrait (Support.jsx « Crédit forcé »
    n'a pas d'équivalent ici — c'est `withdrawal_requests` côté staff qui reste le seul
    accès pour approuver/rejeter). Sans cet endpoint, un retrait au-dessus du palier auto
    disparaîtrait de la vue du client jusqu'à son approbation (il ne devient un
    `WalletMovement` — donc visible via `my_movements` — qu'une fois posté)."""
    requests_qs = WithdrawalRequest.objects.filter(wallet__user=request.user).select_related("wallet")
    return Response([serializers.withdrawal_request_row(r) for r in requests_qs])


@api_view(["GET"])
@permission_classes([HasCapability("validate")])
def wallet_for_user(request, sub):
    """Résout (et crée si besoin) le portefeuille d'un client par son `sub` IdP — utilisé
    par le flux de régularisation (Support.jsx « Crédit forcé ») : un agent connaît le
    ticket/le client, pas l'id interne de `ClientWallet`."""
    from accounts.models import FintechUser
    user = FintechUser.objects.filter(sub=sub).first()
    if not user:
        return Response({"detail": "Utilisateur introuvable."}, status=404)
    currency = request.GET.get("currency", "USD")
    wallet = _get_or_create_wallet(user, currency)
    return Response({**_wallet_row(wallet), "userSub": sub})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def my_convert(request):
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    try:
        result = services.convert_wallet(
            user=request.user, from_currency=data.get("from", "USD"), to_currency=data.get("to", "CDF"),
            amount=data.get("amount", "0"), idempotency_key=key, by=getattr(request.user, "sub", ""),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(result)


def _get_or_create_wallet(user, currency: str) -> ClientWallet:
    wallet, _ = ClientWallet.objects.get_or_create(user=user, currency=currency)
    return wallet


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def my_deposit(request):
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    wallet = _get_or_create_wallet(request.user, data.get("currency", "USD"))
    try:
        movement = services.deposit(
            wallet_id=wallet.pk, amount=data.get("amount", "0"), channel=data.get("channel", ""),
            idempotency_key=key, by=getattr(request.user, "sub", ""),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.movement_row(movement, verb="Dépôt effectué."))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def my_withdraw(request):
    """Passe par le workflow à paliers (`withdrawal_tiers`) plutôt que par
    `services.withdraw()` (débit inconditionnel) : un retrait sous le seuil auto est traité
    immédiatement (même effet qu'avant), au-dessus il crée une demande PENDING_VALIDATION,
    débitée seulement une fois le palier manager/quorum atteint."""
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    wallet = _get_or_create_wallet(request.user, data.get("currency", "USD"))
    try:
        request_obj = withdrawal_tiers.create_withdrawal_request(
            wallet_id=wallet.pk, amount=data.get("amount", "0"),
            idempotency_key=key, by=getattr(request.user, "sub", ""),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.withdrawal_request_row(request_obj))


@api_view(["GET"])
@permission_classes([HasCapability("validate")])
def withdrawal_requests(request):
    qs = WithdrawalRequest.objects.select_related("wallet").prefetch_related("approvals").all()[:500]
    status = request.GET.get("status")
    if status:
        qs = qs.filter(status=status)
    return Response([serializers.withdrawal_request_row(r) for r in qs])


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def withdrawal_request_approve(request, request_id):
    role = get_role(getattr(request.user, "role", ""))
    req = withdrawal_tiers.approve(
        request_id=request_id, approver_sub=getattr(request.user, "sub", ""), approver_role=role.id,
        otp_code=(request.data or {}).get("otpCode"),
    )
    return Response(serializers.withdrawal_request_row(req))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def withdrawal_request_reject(request, request_id):
    role = get_role(getattr(request.user, "role", ""))
    req = withdrawal_tiers.reject(
        request_id=request_id, approver_sub=getattr(request.user, "sub", ""), approver_role=role.id,
        reason=(request.data or {}).get("reason", ""),
    )
    return Response(serializers.withdrawal_request_row(req))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def withdrawal_otp_request(request, request_id):
    challenge = withdrawal_tiers.request_step_up_otp(request_id=request_id,
                                                       approver_sub=getattr(request.user, "sub", ""))
    return Response({"challengeId": challenge.pk, "expiresAt": challenge.expires_at.isoformat()})


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def withdrawal_otp_verify(request, request_id):
    data = request.data or {}
    ok = withdrawal_tiers.verify_step_up_otp(challenge_id=data.get("challengeId", ""), code=data.get("code", ""))
    return Response({"verified": ok})


@api_view(["GET", "POST"])
@permission_classes([HasCapability("validate")])
def regularization_orders(request):
    if request.method == "GET":
        qs = RegularizationOrder.objects.select_related("wallet").prefetch_related("approvals").all()[:500]
        status = request.GET.get("status")
        if status:
            qs = qs.filter(status=status)
        return Response([serializers.regularization_order_row(o) for o in qs])
    data = request.data or {}
    key = data.get("idempotencyKey")
    if not key:
        return Response({"detail": "idempotencyKey requis."}, status=400)
    wallet_id = data.get("walletId")
    if not wallet_id:
        return Response({"detail": "walletId requis."}, status=400)
    try:
        order = regularization.create_regularization_order(
            wallet_id=wallet_id, amount=data.get("amount", "0"), reason=data.get("reason", ""),
            ticket_id=data.get("ticketId"), idempotency_key=key, by=getattr(request.user, "sub", ""),
        )
    except idempotency.IdempotentReplay as exc:
        return idempotency.replay_response(exc)
    return Response(serializers.regularization_order_row(order), status=201)


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def regularization_order_approve(request, order_id):
    role = get_role(getattr(request.user, "role", ""))
    order = regularization.approve(
        order_id=order_id, approver_sub=getattr(request.user, "sub", ""), approver_role=role.id,
        otp_code=(request.data or {}).get("otpCode"),
    )
    return Response(serializers.regularization_order_row(order))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def regularization_order_reject(request, order_id):
    role = get_role(getattr(request.user, "role", ""))
    order = regularization.reject(
        order_id=order_id, approver_sub=getattr(request.user, "sub", ""), approver_role=role.id,
        reason=(request.data or {}).get("reason", ""),
    )
    return Response(serializers.regularization_order_row(order))


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def regularization_otp_request(request, order_id):
    challenge = regularization.request_step_up_otp(order_id=order_id, approver_sub=getattr(request.user, "sub", ""))
    return Response({"challengeId": challenge.pk, "expiresAt": challenge.expires_at.isoformat()})


@api_view(["POST"])
@permission_classes([HasCapability("validate")])
def regularization_otp_verify(request, order_id):
    data = request.data or {}
    ok = regularization.verify_step_up_otp(challenge_id=data.get("challengeId", ""), code=data.get("code", ""))
    return Response({"verified": ok})
