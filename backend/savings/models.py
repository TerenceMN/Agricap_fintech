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

    class RateStatus(models.TextChoices):
        """Gouvernance du TAUX du plan — distincte de `status` (cycle de vie du plan,
        qui gouverne l'acceptation des dépôts). Un plan « bloqué » côté taux cesse de
        produire des intérêts (taux 0) sans être clôturé ; « suspendu » gèle le taux
        temporairement. Séparés parce que geler la rémunération et fermer le plan ne
        sont pas la même décision."""
        ACTIF = "actif", "Actif"
        SUSPENDU = "suspendu", "Suspendu"
        BLOQUE = "bloque", "Bloqué"

    user = models.ForeignKey("accounts.FintechUser", on_delete=models.CASCADE, related_name="savings_plans")
    name = models.CharField(max_length=150)
    objective_type = models.CharField(max_length=20, choices=ObjectiveType.choices, default=ObjectiveType.AUTRE)
    plan_type = models.CharField(max_length=12, choices=PlanType.choices, default=PlanType.CAMPAGNE)
    objectif = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, default="USD")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIF)
    interest_rate = models.DecimalField(max_digits=5, decimal_places=3, default=Decimal("4.5"))
    #: Taux mensuel équivalent, CALCULÉ CÔTÉ SERVEUR (annuel / 12, quantize 0.0001). Le
    #: front ne le recalcule plus (l'ancien `(val/12)` des modales était un calcul
    #: financier côté client, interdit §5) : il affiche cette valeur servie.
    monthly_rate = models.DecimalField(max_digits=6, decimal_places=4, default=Decimal("0.375"))
    rate_status = models.CharField(max_length=10, choices=RateStatus.choices, default=RateStatus.ACTIF)
    #: Modalités de versement (éditées par l'ajustement admin) — servent la simulation
    #: de croissance, désormais projetée CÔTÉ SERVEUR.
    class DepositFrequency(models.TextChoices):
        HEBDOMADAIRE = "hebdomadaire", "Hebdomadaire"
        BIMENSUEL = "bimensuel", "Bimensuel"
        MENSUEL = "mensuel", "Mensuel"
        TRIMESTRIEL = "trimestriel", "Trimestriel"
        ANNUEL = "annuel", "Annuel"

    frequency = models.CharField(max_length=14, choices=DepositFrequency.choices,
                                 default=DepositFrequency.MENSUEL)
    periodic_deposit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
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


class SavingsRateChange(models.Model):
    """Journal APPEND-ONLY des changements de configuration de taux d'un plan (P3 :
    « append-only sur tout ce qui est probant »). La configuration COURANTE d'un plan
    est la dernière entrée ; l'historique n'est jamais modifié ni supprimé — on ré-écrit
    une nouvelle ligne, l'écart entre deux lignes est lui-même une donnée d'audit.

    Le taux mensuel est CALCULÉ ICI (côté serveur), jamais renvoyé par le client : c'est
    la correction directe du `(val/12)` que les modales faisaient côté navigateur."""

    class Action(models.TextChoices):
        RATE_UPDATE = "rate_update", "Modification du taux"
        BLOCK = "block", "Blocage (taux 0%)"
        SUSPEND = "suspend", "Suspension"
        RESUME = "resume", "Réactivation"

    plan = models.ForeignKey(SavingsPlan, on_delete=models.CASCADE, related_name="rate_changes")
    annual_rate = models.DecimalField(max_digits=5, decimal_places=3)
    monthly_rate = models.DecimalField(max_digits=6, decimal_places=4)
    status = models.CharField(max_length=10, choices=SavingsPlan.RateStatus.choices)
    effective_date = models.DateField()
    action = models.CharField(max_length=12, choices=Action.choices, default=Action.RATE_UPDATE)
    reason = models.CharField(max_length=255, blank=True)
    actor = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class SavingsAdjustment(models.Model):
    """Journal APPEND-ONLY des ajustements de MODALITÉS d'un plan (objectif, fréquence,
    mode et montant du versement périodique). Ne touche JAMAIS au solde : le solde ne
    bouge que par un mouvement d'argent tracé (dépôt qui débite le wallet), jamais par
    une saisie admin directe (conservation de la monnaie, §4)."""

    plan = models.ForeignKey(SavingsPlan, on_delete=models.CASCADE, related_name="adjustments")
    target_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    deposit_mode = models.CharField(max_length=14, choices=SavingsPlan.Channel.choices,
                                    default=SavingsPlan.Channel.AGENT)
    frequency = models.CharField(max_length=14, choices=SavingsPlan.DepositFrequency.choices,
                                 default=SavingsPlan.DepositFrequency.MENSUEL)
    periodic_deposit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    reason = models.CharField(max_length=255, blank=True)
    actor = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


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
