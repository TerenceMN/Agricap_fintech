"""Taux de change à 3 paliers (bcc/staff/client), par devise étrangère et par date — le CDF
est la devise locale implicite (pivot), pas une entrée de `Currency` : chaque taux exprime
« combien de CDF pour 1 unité de `currency` » (`ExchangeRateManager` côté frontend)."""
from __future__ import annotations

from django.db import models
from django.db.models import F, Q


class ExchangeRate(models.Model):
    class Tier(models.TextChoices):
        BCC = "BCC", "BCC (officiel)"
        STAFF = "STAFF", "Interne (staff)"
        CLIENT = "CLIENT", "Client (commercial)"

    class Currency(models.TextChoices):
        USD = "USD", "USD"
        EUR = "EUR", "EUR"
        GBP = "GBP", "GBP"
        CAD = "CAD", "CAD"
        CHF = "CHF", "CHF"
        CNY = "CNY", "CNY"
        ZAR = "ZAR", "ZAR"

    tier = models.CharField(max_length=10, choices=Tier.choices)
    currency = models.CharField(max_length=3, choices=Currency.choices)
    buy_rate = models.DecimalField(max_digits=14, decimal_places=6)
    sell_rate = models.DecimalField(max_digits=14, decimal_places=6)
    effective_date = models.DateField()
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_date"]
        constraints = [
            models.UniqueConstraint(fields=["tier", "currency", "effective_date"],
                                     name="fx_tier_currency_date_unique"),
            models.CheckConstraint(condition=Q(sell_rate__gt=F("buy_rate")), name="fx_sell_gt_buy"),
        ]

    def __str__(self) -> str:
        return f"{self.tier}/{self.currency} {self.effective_date} buy={self.buy_rate} sell={self.sell_rate}"
