"""Épargne individuelle + groupes (Savings.jsx + admin/savings/*) — CRUD léger (style
existant `@api_view`), toujours audité."""
from __future__ import annotations

from decimal import Decimal

from django.db import models


class SavingsPlan(models.Model):
    class ObjectiveType(models.TextChoices):
        INVESTISSEMENT = "investissement", "Investissement"
        PRODUCTION = "production", "Production"
        TRANSFORMATION = "transformation", "Transformation"
        COMMERCIALISATION = "commercialisation", "Commercialisation"
        RESERVES = "reserves", "Réserves"
        ACTIONS = "actions", "Actions"
        IMMOBILIER = "immobilier", "Immobilier"
        AUTRE = "autre", "Autre"

    class PlanType(models.TextChoices):
        CAMPAGNE = "campagne", "Campagne (4.5%)"
        EQUIPEMENT = "equipement", "Équipement (3.8%)"
        GROUPEE = "groupee", "Groupée (5.2%)"

    class Status(models.TextChoices):
        ACTIF = "actif", "Actif"
        CLOTURE = "cloture", "Clôturé"

    class Channel(models.TextChoices):
        AGENT = "agent", "Agent"
        MOBILE_MONEY = "mobile_money", "Mobile Money"
        BANK = "bank", "Banque"
        WALLET = "wallet", "Portefeuille"

    user = models.ForeignKey("accounts.FintechUser", on_delete=models.CASCADE, related_name="savings_plans")
    name = models.CharField(max_length=150)
    objective_type = models.CharField(max_length=20, choices=ObjectiveType.choices, default=ObjectiveType.AUTRE)
    plan_type = models.CharField(max_length=12, choices=PlanType.choices, default=PlanType.CAMPAGNE)
    objectif = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, default="USD")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIF)
    interest_rate = models.DecimalField(max_digits=5, decimal_places=3, default=Decimal("4.5"))
    accrued_interest = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    deposit_channel = models.CharField(max_length=14, choices=Channel.choices, default=Channel.AGENT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.user_id})"


class SavingsDeposit(models.Model):
    plan = models.ForeignKey(SavingsPlan, on_delete=models.CASCADE, related_name="deposits")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    channel = models.CharField(max_length=14, choices=SavingsPlan.Channel.choices, default=SavingsPlan.Channel.AGENT)
    created_at = models.DateTimeField(auto_now_add=True)


class SavingsGroup(models.Model):
    class GroupType(models.TextChoices):
        AVEC = "AVEC", "AVEC"
        MUTUELLE = "MUTUELLE", "Mutuelle"
        COOPERATIVE = "COOPERATIVE", "Coopérative"
        ORGANISATION_PAYSANNE = "ORGANISATION_PAYSANNE", "Organisation paysanne"

    class Frequency(models.TextChoices):
        HEBDOMADAIRE = "hebdomadaire", "Hebdomadaire"
        MENSUEL = "mensuel", "Mensuel"
        TRIMESTRIEL = "trimestriel", "Trimestriel"

    name = models.CharField(max_length=150)
    type = models.CharField(max_length=24, choices=GroupType.choices, default=GroupType.AVEC)
    description = models.CharField(max_length=255, blank=True)
    rate = models.DecimalField(max_digits=5, decimal_places=3, default=Decimal("6.0"))
    frequency = models.CharField(max_length=14, choices=Frequency.choices, default=Frequency.MENSUEL)
    deposit_mode = models.CharField(max_length=14, choices=SavingsPlan.Channel.choices,
                                     default=SavingsPlan.Channel.AGENT)
    admin_sub = models.CharField(max_length=255, blank=True)
    balance = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class SavingsGroupMember(models.Model):
    group = models.ForeignKey(SavingsGroup, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey("accounts.FintechUser", on_delete=models.CASCADE, related_name="savings_groups")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "user"], name="unique_group_member")]


class GroupIntegrationRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "En attente"
        APPROVED = "approved", "Approuvé"
        REJECTED = "rejected", "Rejeté"

    group = models.ForeignKey(SavingsGroup, on_delete=models.CASCADE, related_name="integration_requests")
    user = models.ForeignKey("accounts.FintechUser", on_delete=models.CASCADE, related_name="group_requests")
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
