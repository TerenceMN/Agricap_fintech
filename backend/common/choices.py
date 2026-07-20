"""Choix partagés entre apps métier (évite la ré-invention par app)."""
from __future__ import annotations

from django.db import models


class FlowStatus(models.TextChoices):
    """Cycle de vie générique d'une opération financière — miroir exact de
    `src/lib/constants.js` `STATUS`, réutilisé par `caisses`, `transactions`,
    `investments.Movement`, `savings` plutôt que ré-inventé par app."""

    DRAFT = "draft", "Brouillon"
    SUBMITTED = "submitted", "Soumis"
    PENDING_VALIDATION = "pending_validation", "En attente de validation"
    APPROVED = "approved", "Approuvé"
    POSTED = "posted", "Comptabilisé"
    REJECTED = "rejected", "Rejeté"
    REVERSED = "reversed", "Annulé (contre-passé)"
