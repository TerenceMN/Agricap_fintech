"""KYC/AML (Compliance.jsx) + centre de documents partagé client/investisseur
(ClientDocuments.jsx / InvestorDocuments.jsx)."""
from __future__ import annotations

from decimal import Decimal

from django.db import models

from common.choices import FlowStatus


class KycProfile(models.Model):
    class Status(models.TextChoices):
        VALIDE = "Validé", "Validé"
        EN_ATTENTE = "En attente", "En attente"

    class RiskScore(models.TextChoices):
        BAS = "Bas", "Bas"
        MOYEN = "Moyen", "Moyen"
        ELEVE = "Élevé", "Élevé"

    user = models.OneToOneField("accounts.FintechUser", on_delete=models.CASCADE, related_name="kyc_profile")
    kyc_status = models.CharField(max_length=12, choices=Status.choices, default=Status.EN_ATTENTE)
    risk_score = models.CharField(max_length=10, choices=RiskScore.choices, default=RiskScore.MOYEN)
    kyc_level = models.CharField(max_length=4, default="T1")
    monthly_limit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("50000"))
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"KYC({self.user_id}) {self.kyc_status}"


class Document(models.Model):
    class Type(models.TextChoices):
        ID_CARD = "id_card", "Pièce d'identité"
        PROOF_ADDRESS = "proof_address", "Justificatif domicile"
        FINANCIAL = "financial", "Document financier"
        OTHER = "other", "Autre"

    user = models.ForeignKey("accounts.FintechUser", on_delete=models.CASCADE, related_name="documents")
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.OTHER)
    name = models.CharField(max_length=200)
    file_url = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.SUBMITTED)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.user_id})"
