"""Comptes de trésorerie (agences/HQ, Wallets.jsx+Treasury.jsx) et portefeuilles clients
(ClientWallet.jsx) — rigueur stricte : Decimal, `CheckConstraint(balance>=0)`, verrouillage
ordonné + idempotence dans `services.py`."""
from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import models
from django.db.models import F, Q

from common.choices import FlowStatus


def _generate_otp_id() -> str:
    return uuid.uuid4().hex


class TreasuryAccount(models.Model):
    class Kind(models.TextChoices):
        CAISSE = "CAISSE", "Caisse"
        BANQUE = "BANQUE", "Banque"
        MOBILE_MONEY = "MOBILE_MONEY", "Mobile Money"

    class Currency(models.TextChoices):
        CDF = "CDF", "CDF"
        USD = "USD", "USD"

    class RiskLevel(models.TextChoices):
        FAIBLE = "FAIBLE", "Faible"
        MODERE = "MODERE", "Modéré"
        ELEVE = "ELEVE", "Élevé"

    class Status(models.TextChoices):
        ACTIF = "ACTIF", "Actif"
        EN_TRAITEMENT = "EN_TRAITEMENT", "En traitement"
        EN_OBSERVATION = "EN_OBSERVATION", "En observation"
        BLOQUE = "BLOQUE", "Bloqué"
        ARCHIVE = "ARCHIVE", "Archivé"

    code = models.CharField(max_length=32, unique=True, db_index=True)
    name = models.CharField(max_length=150)
    kind = models.CharField(max_length=14, choices=Kind.choices, default=Kind.CAISSE)
    agency = models.ForeignKey("agencies.Agency", null=True, blank=True, on_delete=models.PROTECT,
                                related_name="treasury_accounts")  # null = compte HQ
    # Rattachement à l'intégration API (`kind=MOBILE_MONEY` uniquement) — permet la
    # synchronisation de connectivité via `partners.services.sync_partner` plutôt qu'un
    # compte Mobile Money isolé sans lien avec le disjoncteur/health-check du partenaire.
    partner = models.ForeignKey("partners.Partner", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="treasury_accounts")
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    initial_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    manager_sub = models.CharField(max_length=255, blank=True)
    scope = models.CharField(max_length=120, blank=True)
    risk_level = models.CharField(max_length=10, choices=RiskLevel.choices, default=RiskLevel.FAIBLE)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.ACTIF)
    # Plafond journalier d'entrées de caisse (billetage physique, `kind=CAISSE` uniquement) —
    # null = pas de plafond configuré. Suivi par rapport à la session de caisse du jour
    # (`CashRegisterSession.cash_in_total`), pas un cumul indépendant.
    daily_ceiling = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(condition=Q(balance__gte=0), name="treasury_balance_nonneg"),
        ]
        indexes = [models.Index(fields=["agency", "status"])]

    def __str__(self) -> str:
        return f"{self.code} — {self.name} ({self.currency})"


class CashRegisterSession(models.Model):
    """Séance de caisse journalière (billetage physique, `TreasuryAccount.kind=CAISSE`) —
    ouverture avec comptage initial, clôture avec comptage final comparé au solde système
    (`TreasuryAccount.balance`, déjà tenu à jour en temps réel par chaque mouvement) :
    au-delà de la tolérance, la caisse est gelée (`TreasuryAccount.status=BLOQUE`) plutôt que
    de laisser un écart non expliqué passer inaperçu."""
    class Status(models.TextChoices):
        OPEN = "OPEN", "Ouverte"
        CLOSED = "CLOSED", "Clôturée"
        DISCREPANCY = "DISCREPANCY", "Écart constaté"

    account = models.ForeignKey(TreasuryAccount, on_delete=models.CASCADE, related_name="register_sessions")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    opened_by = models.CharField(max_length=255, blank=True)
    opening_count = models.DecimalField(max_digits=18, decimal_places=2)
    opening_balance_expected = models.DecimalField(max_digits=18, decimal_places=2)
    opened_at = models.DateTimeField(auto_now_add=True)
    # Cumul des entrées de caisse (`services.adjust_account(direction="in")`) enregistrées
    # PENDANT que cette session est ouverte — base de la vérification du plafond journalier.
    cash_in_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    closed_by = models.CharField(max_length=255, blank=True)
    closing_count = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    closing_balance_expected = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    discrepancy = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-opened_at"]

    def __str__(self) -> str:
        return f"{self.account.code} [{self.status}] {self.opened_at}"


class ClientWallet(models.Model):
    class Status(models.TextChoices):
        ACTIF = "ACTIF", "Actif"
        BLOQUE = "BLOQUE", "Bloqué"

    user = models.ForeignKey("accounts.FintechUser", on_delete=models.CASCADE, related_name="wallets")
    currency = models.CharField(max_length=3, choices=TreasuryAccount.Currency.choices,
                                 default=TreasuryAccount.Currency.USD)
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIF)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "currency"], name="wallet_user_currency_unique"),
            models.CheckConstraint(condition=Q(balance__gte=0), name="wallet_balance_nonneg"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} [{self.currency}] {self.balance}"


class FundTransfer(models.Model):
    from_account = models.ForeignKey(TreasuryAccount, on_delete=models.PROTECT, related_name="transfers_out")
    to_account = models.ForeignKey(TreasuryAccount, on_delete=models.PROTECT, related_name="transfers_in")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3, choices=TreasuryAccount.Currency.choices)
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.POSTED)
    idempotency_key = models.CharField(max_length=128, blank=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=~Q(from_account=F("to_account")), name="transfer_distinct_accounts"),
        ]

    def __str__(self) -> str:
        return f"{self.from_account.code} -> {self.to_account.code} : {self.amount} {self.currency}"


class WalletMovement(models.Model):
    class Kind(models.TextChoices):
        DEPOSIT = "DEPOSIT", "Dépôt"
        WITHDRAW = "WITHDRAW", "Retrait"
        FX_BUY = "FX_BUY", "Achat devise"
        FX_SELL = "FX_SELL", "Vente devise"
        REGULARIZATION = "REGULARIZATION", "Régularisation"

    wallet = models.ForeignKey(ClientWallet, on_delete=models.CASCADE, related_name="movements")
    kind = models.CharField(max_length=14, choices=Kind.choices)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.POSTED)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.wallet_id} {self.kind} {self.amount}"


class WithdrawalThreshold(models.Model):
    """Seuils de palier par devise (ClientWallet.jsx retrait) — même principe que
    `transactions.ValidationThreshold`, mais dupliqué (pas de FK partagée) car le retrait
    de portefeuille et la validation de transaction sont deux workflows distincts."""
    currency = models.CharField(max_length=3, choices=TreasuryAccount.Currency.choices, unique=True)
    auto_limit = models.DecimalField(max_digits=18, decimal_places=2)
    manager_limit = models.DecimalField(max_digits=18, decimal_places=2)

    def __str__(self) -> str:
        return f"{self.currency} auto<{self.auto_limit} manager<{self.manager_limit}"


class WithdrawalRequest(models.Model):
    """Retrait au-dessus du palier auto : le solde n'est débité qu'à l'approbation (palier
    manager) ou à l'atteinte du quorum (palier quorum) — jamais à la création de la
    demande, pour ne jamais tenir des fonds "gelés" sans mécanisme de hold dédié."""
    wallet = models.ForeignKey(ClientWallet, on_delete=models.CASCADE, related_name="withdrawal_requests")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.PENDING_VALIDATION)
    auto_validated = models.BooleanField(default=False)
    movement = models.ForeignKey(WalletMovement, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="withdrawal_request")
    idempotency_key = models.CharField(max_length=128, blank=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="withdrawal_request_amount_positive"),
        ]

    def __str__(self) -> str:
        return f"WithdrawalRequest({self.wallet_id}, {self.amount}) [{self.status}]"


class WithdrawalOtpChallenge(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=_generate_otp_id)
    request = models.ForeignKey(WithdrawalRequest, on_delete=models.CASCADE, related_name="otp_challenges")
    approver_sub = models.CharField(max_length=255)
    code_hash = models.CharField(max_length=128)
    channel = models.CharField(max_length=10, choices=[("EMAIL", "Email")], default="EMAIL")
    attempts = models.IntegerField(default=0)
    max_attempts = models.IntegerField(default=5)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"OTP {self.id[:8]} request={self.request_id} approver={self.approver_sub}"


class WithdrawalApproval(models.Model):
    class Decision(models.TextChoices):
        APPROVED = "APPROVED", "Approuvé"
        REJECTED = "REJECTED", "Rejeté"

    request = models.ForeignKey(WithdrawalRequest, on_delete=models.CASCADE, related_name="approvals")
    approver_sub = models.CharField(max_length=255)
    approver_role = models.CharField(max_length=40)
    decision = models.CharField(max_length=10, choices=Decision.choices)
    otp_verified_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["request", "approver_sub"], name="one_decision_per_withdrawal_approver"),
        ]
        ordering = ["decided_at"]

    def __str__(self) -> str:
        return f"request={self.request_id} {self.approver_sub} -> {self.decision}"


class RegularizationThreshold(models.Model):
    """Seuils de palier des ordres de régularisation (Support.jsx « Crédit forcé ») —
    modèle dupliqué de `WithdrawalThreshold` (pas de FK partagée, même principe que les
    autres seuils de l'app) : une régularisation est un crédit forcé sur décision d'un
    agent, un risque de nature différente d'un retrait client, donc configurable
    séparément."""
    currency = models.CharField(max_length=3, choices=TreasuryAccount.Currency.choices, unique=True)
    auto_limit = models.DecimalField(max_digits=18, decimal_places=2)
    manager_limit = models.DecimalField(max_digits=18, decimal_places=2)

    def __str__(self) -> str:
        return f"{self.currency} auto<{self.auto_limit} manager<{self.manager_limit}"


class RegularizationOrder(models.Model):
    """Crédit forcé sur un portefeuille client (ex. dépôt mobile money reçu chez l'opérateur
    mais jamais crédité en DB) — remplace l'action `force_credit` simulée de Support.jsx par
    un vrai `WalletMovement`, gouverné par le même palier auto/manager/quorum + OTP que
    `withdrawal_tiers`."""
    wallet = models.ForeignKey(ClientWallet, on_delete=models.CASCADE, related_name="regularization_orders")
    ticket = models.ForeignKey("support.Ticket", null=True, blank=True, on_delete=models.SET_NULL,
                                related_name="regularization_orders")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.PENDING_VALIDATION)
    auto_validated = models.BooleanField(default=False)
    movement = models.ForeignKey(WalletMovement, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="regularization_order")
    idempotency_key = models.CharField(max_length=128, blank=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="regularization_amount_positive"),
        ]

    def __str__(self) -> str:
        return f"RegularizationOrder({self.wallet_id}, {self.amount}) [{self.status}]"


class RegularizationOtpChallenge(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=_generate_otp_id)
    order = models.ForeignKey(RegularizationOrder, on_delete=models.CASCADE, related_name="otp_challenges")
    approver_sub = models.CharField(max_length=255)
    code_hash = models.CharField(max_length=128)
    channel = models.CharField(max_length=10, choices=[("EMAIL", "Email")], default="EMAIL")
    attempts = models.IntegerField(default=0)
    max_attempts = models.IntegerField(default=5)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"OTP {self.id[:8]} order={self.order_id} approver={self.approver_sub}"


class RegularizationApproval(models.Model):
    class Decision(models.TextChoices):
        APPROVED = "APPROVED", "Approuvé"
        REJECTED = "REJECTED", "Rejeté"

    order = models.ForeignKey(RegularizationOrder, on_delete=models.CASCADE, related_name="approvals")
    approver_sub = models.CharField(max_length=255)
    approver_role = models.CharField(max_length=40)
    decision = models.CharField(max_length=10, choices=Decision.choices)
    otp_verified_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "approver_sub"],
                                     name="one_decision_per_regularization_approver"),
        ]
        ordering = ["decided_at"]

    def __str__(self) -> str:
        return f"order={self.order_id} {self.approver_sub} -> {self.decision}"
