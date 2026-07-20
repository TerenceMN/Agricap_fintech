"""
Portefeuille de crédits — CYCLE DE VIE des dossiers (distinct du moteur d'analyse
`credit`). Alimente le « Module Crédits Agricoles » côté admin : liste des dossiers,
statuts, taux & maturité (avec historique/audit), échéancier d'amortissement, journal
des mouvements financiers, notes et alertes.

Un dossier peut être relié (optionnel) à un dossier d'analyse du moteur (`credit`),
mais reste autonome : un dossier peut être saisi manuellement (« Ajouter »).
"""
from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.utils import timezone


class Loan(models.Model):
    """Un dossier de crédit géré (un « crédit » de la table admin)."""

    class Status(models.TextChoices):
        EN_TRAITEMENT = "EN_TRAITEMENT", "En traitement"
        APPROUVE = "APPROUVE", "Approuvé"
        EN_COURS = "EN_COURS", "En cours"
        DEFAUT = "DEFAUT", "Défaut"
        CLOTURE = "CLOTURE", "Clôturé"
        REJETE = "REJETE", "Rejeté"
        SUSPENDU = "SUSPENDU", "Suspendu"
        BLOQUE = "BLOQUE", "Bloqué"

    class Frequency(models.TextChoices):
        MONTHLY = "monthly", "Mensuel"
        QUARTERLY = "quarterly", "Trimestriel"
        ANNUAL = "annual", "Annuel"
        BULLET = "bullet", "In fine (à terme)"

    class Currency(models.TextChoices):
        USD = "USD", "USD"
        CDF = "CDF", "CDF"

    reference = models.CharField(max_length=32, unique=True, db_index=True)  # CRD-AAAA-NNN
    date = models.DateField(default=timezone.localdate)                      # date de la demande
    operator = models.CharField(max_length=200)                             # bénéficiaire / opérateur
    category = models.CharField(max_length=120, blank=True)                 # catégorie / filière

    amount_requested = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    amount_approved = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)

    duration_months = models.IntegerField(default=12)
    rate = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))  # taux MENSUEL %
    frequency = models.CharField(max_length=12, choices=Frequency.choices, default=Frequency.MONTHLY)
    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)

    manager = models.CharField(max_length=150, blank=True)      # gestionnaire
    investor = models.CharField(max_length=150, blank=True)
    source = models.CharField(max_length=120, blank=True)       # ex. « App », « Terrain », « IdP »

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.EN_TRAITEMENT)
    score = models.IntegerField(default=0)
    guarantee = models.CharField(max_length=200, blank=True)

    # Lien optionnel vers un dossier de crédit (traçabilité).
    application = models.ForeignKey(
        "credits.CreditApplication", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="loans",
    )

    # Client TITULAIRE du dossier (Credits.jsx, espace client) — distinct de `created_by`
    # (qui peut être un membre du staff ayant saisi le dossier manuellement). Renseigné
    # automatiquement quand le client soumet lui-même sa demande (auto-service).
    borrower_sub = models.CharField(max_length=255, blank=True, db_index=True)

    created_by = models.CharField(max_length=255, blank=True)   # sub IdP
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.reference} — {self.operator} [{self.get_status_display()}]"

    # --- Agrégats dérivés du journal ------------------------------------------
    @property
    def disbursed(self) -> Decimal:
        """Total décaissé = somme des décaissements validés/en attente."""
        total = sum((t.amount for t in self.transactions.all()
                     if t.kind == LoanTransaction.Kind.DISBURSEMENT and t.amount), Decimal("0"))
        return total

    @property
    def repaid(self) -> Decimal:
        """Total remboursé (montant positif) = somme des remboursements."""
        total = sum(((-t.amount) for t in self.transactions.all()
                     if t.kind == LoanTransaction.Kind.REPAYMENT and t.amount), Decimal("0"))
        return total

    @property
    def outstanding(self) -> Decimal:
        """Solde restant dû = décaissé − remboursé."""
        return self.disbursed - self.repaid

    @property
    def progress(self) -> int:
        """Progression de remboursement (%) sur le montant approuvé."""
        base = self.amount_approved or self.amount_requested
        if not base:
            return 0
        return max(0, min(100, round(float(self.repaid) / float(base) * 100)))


class LoanTransaction(models.Model):
    """Un mouvement financier du dossier (journal / sous-tableau)."""

    class Kind(models.TextChoices):
        DISBURSEMENT = "DISBURSEMENT", "Décaissement"
        REPAYMENT = "REPAYMENT", "Remboursement"
        FEE = "FEE", "Frais"
        REMINDER = "REMINDER", "Relance"
        ADJUSTMENT = "ADJUSTMENT", "Ajustement"
        OTHER = "OTHER", "Autre"

    class Status(models.TextChoices):
        VALIDE = "VALIDE", "Validé"
        EN_ATTENTE = "EN_ATTENTE", "En attente"
        NON_APPLICABLE = "NON_APPLICABLE", "Non applicable"

    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="transactions")
    # Sous-portefeuille d'origine (Credits.jsx, espace client) — optionnel : les
    # décaissements/mouvements saisis côté admin (AdminCreditsDashboard) n'en ont pas.
    subwallet = models.ForeignKey(
        "LoanSubWallet", null=True, blank=True, on_delete=models.SET_NULL, related_name="transactions",
    )
    date = models.DateField(default=timezone.localdate)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.OTHER)
    label = models.CharField(max_length=200, blank=True)    # ex. « Décaissement initial »
    # Signe : + = fonds sortis vers le client (décaissement) ; − = remboursement.
    amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, choices=Loan.Currency.choices, default=Loan.Currency.USD)
    original_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    original_currency = models.CharField(max_length=3, blank=True)
    payment_method = models.CharField(max_length=80, blank=True)
    reference = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.VALIDE)
    verified_by = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date", "created_at"]

    def __str__(self) -> str:
        return f"{self.loan.reference} {self.get_kind_display()} {self.amount}"


class LoanConfigHistory(models.Model):
    """Audit des changements taux/maturité/statut (onglet « Historique & Audit »)."""
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="config_history")
    action = models.CharField(max_length=120)
    user = models.CharField(max_length=120, blank=True)
    details = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.loan.reference} — {self.action}"


class LoanNote(models.Model):
    """Note libre attachée à un dossier."""
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="notes")
    author = models.CharField(max_length=120, blank=True)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Note {self.loan.reference}"


class LoanSubWallet(models.Model):
    """Enveloppe budgétaire par module agricole (Credits.jsx, espace client) — le
    montant financé est ventilé par poste (semences, mécanisation, main-d'œuvre...) et
    chaque module se dépense indépendamment (« Payer ») ou se réajuste entre modules
    (« Réajuster »), sans jamais dépasser le total approuvé du dossier."""
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="subwallets")
    module_key = models.CharField(max_length=40)   # clé stable (ex. "semences") — cf. MODULES_CONFIG frontend
    label = models.CharField(max_length=120)
    allocated_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    balance = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["loan", "module_key"], name="unique_loan_subwallet_module"),
            models.CheckConstraint(condition=models.Q(balance__gte=0), name="subwallet_balance_gte_0"),
        ]

    def __str__(self) -> str:
        return f"{self.loan.reference} — {self.label}"


class LoanGuarantee(models.Model):
    """Garantie enregistrée pour un dossier (morale, épargne nantie, actif physique...)."""
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="guarantee_items")
    type = models.CharField(max_length=40)
    label = models.CharField(max_length=200, blank=True)
    description = models.CharField(max_length=300, blank=True)
    value = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.loan.reference} — {self.label or self.type}"
