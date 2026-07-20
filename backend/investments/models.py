"""Modèle canonique des investissements — fusion des 3 schémas mock incompatibles
(`agricapDataService.js` / `investmentData.js` / `investorSpaceData.js`) qui alimentaient
3 pages/consoles frontend différentes (AdminConsole, AdminInvestments, InvestorSpace). Les
mouvements d'argent réels sont TOUJOURS délégués à `transactions`/`caisses`/`ledger` et
seulement référencés ici en FK (`Movement.transaction`) — une seule source de vérité
comptable, jamais dupliquée."""
from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.db.models import Q

from common.choices import FlowStatus


class Project(models.Model):
    class Status(models.TextChoices):
        P01 = "P01", "Prospection"
        P02 = "P02", "Analyse initiale"
        P03 = "P03", "Due diligence"
        P04 = "P04", "Comité d'investissement"
        P05 = "P05", "Approbation conditionnelle"
        P06 = "P06", "Levée de fonds"
        P07 = "P07", "Souscription clôturée"
        P08 = "P08", "Décaissement"
        P09 = "P09", "En cours"
        P10 = "P10", "Remboursement"
        P11 = "P11", "Clôturé"
        P12 = "P12", "Défaut"
        P13 = "P13", "Annulé"

    code = models.CharField(max_length=32, unique=True, db_index=True)
    title = models.CharField(max_length=200)
    sector = models.CharField(max_length=120, blank=True)
    location = models.CharField(max_length=150, blank=True)
    promoter = models.CharField(max_length=200, blank=True)
    promoter_contact = models.CharField(max_length=150, blank=True)
    issuer = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    objectives = models.TextField(blank=True)
    risk_analysis = models.TextField(blank=True)
    fund_allocation = models.JSONField(default=dict, blank=True)
    impact_esg = models.TextField(blank=True)
    image_url = models.CharField(max_length=500, blank=True)

    funding_target = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    funded_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))

    status = models.CharField(max_length=3, choices=Status.choices, default=Status.P01)
    risk_category = models.CharField(max_length=80, blank=True)
    risk_score = models.IntegerField(default=5)  # 1-10
    global_score = models.FloatField(default=0)

    start_date = models.DateField(null=True, blank=True)
    expected_maturity = models.DateField(null=True, blank=True)

    manager_sub = models.CharField(max_length=255, blank=True)
    manager_name = models.CharField(max_length=150, blank=True)

    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(funding_target__gte=0) & Q(funded_amount__gte=0),
                                    name="project_amounts_nonneg"),
        ]
        indexes = [models.Index(fields=["status", "sector", "location"])]

    def __str__(self) -> str:
        return f"{self.code} — {self.title}"

    @property
    def progress_percent(self) -> int:
        if not self.funding_target:
            return 0
        return max(0, min(100, round(float(self.funded_amount) / float(self.funding_target) * 100)))

    @property
    def is_investable(self) -> bool:
        return self.status == Project.Status.P06


class Offer(models.Model):
    class TypeOfTitle(models.TextChoices):
        OBLIGATION = "OBLIGATION", "Obligation"
        ACTION = "ACTION", "Action"
        PART_SOCIALE = "PART_SOCIALE", "Part sociale"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Brouillon"
        PREPARATION = "PREPARATION", "Préparation"
        OUVERT = "OUVERT", "Ouvert"
        SUSPENDU = "SUSPENDU", "Suspendu"
        CLOTURE = "CLOTURE", "Clôturé"

    class Frequency(models.TextChoices):
        MONTHLY = "monthly", "Mensuel"
        QUARTERLY = "quarterly", "Trimestriel"
        ANNUAL = "annual", "Annuel"
        BULLET = "bullet", "In fine (à terme)"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="offers")
    code = models.CharField(max_length=32, unique=True, db_index=True)
    type_of_title = models.CharField(max_length=16, choices=TypeOfTitle.choices, default=TypeOfTitle.OBLIGATION)
    coupon_rate = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))
    payment_frequency = models.CharField(max_length=12, choices=Frequency.choices, default=Frequency.QUARTERLY)
    maturity_months = models.IntegerField(default=24)
    min_ticket = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    bond_unit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("100"))
    min_bonds = models.IntegerField(default=1)
    max_bonds = models.IntegerField(default=0)
    available_bonds = models.IntegerField(default=0)
    funding_goal = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    funded_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OUVERT)
    collateral_value = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    loan_to_value = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))
    guarantees = models.JSONField(default=list, blank=True)
    conversion_fee = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(available_bonds__gte=0), name="offer_available_bonds_nonneg"),
        ]
        indexes = [models.Index(fields=["project", "status"])]

    def __str__(self) -> str:
        return f"{self.code} ({self.project.code})"


class Collateral(models.Model):
    offer = models.OneToOneField(Offer, on_delete=models.CASCADE, related_name="collateral")
    debt_type = models.CharField(max_length=80, blank=True)
    guarantees = models.JSONField(default=list, blank=True)
    collateral_value = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    loan_to_value = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))


class Investor(models.Model):
    class InvestorType(models.TextChoices):
        INDIVIDUAL = "INDIVIDUAL", "Individuel"
        INSTITUTIONAL = "INSTITUTIONAL", "Institutionnel"
        CORPORATE = "CORPORATE", "Corporate"

    class KycStatus(models.TextChoices):
        VALIDE = "VALIDE", "Validé"
        EN_ATTENTE = "EN_ATTENTE", "En attente"
        REJETE = "REJETE", "Rejeté"
        EXPIRE = "EXPIRE", "Expiré"

    class RiskProfile(models.TextChoices):
        CONSERVATIVE = "CONSERVATIVE", "Conservateur"
        MODERATE = "MODERATE", "Modéré"
        AGGRESSIVE = "AGGRESSIVE", "Agressif"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Actif"
        SUSPENDED = "SUSPENDED", "Suspendu"

    user = models.OneToOneField("accounts.FintechUser", on_delete=models.CASCADE, related_name="investor_profile")
    investor_type = models.CharField(max_length=16, choices=InvestorType.choices, default=InvestorType.INDIVIDUAL)
    kyc_status = models.CharField(max_length=12, choices=KycStatus.choices, default=KycStatus.EN_ATTENTE)
    risk_profile = models.CharField(max_length=14, choices=RiskProfile.choices, default=RiskProfile.MODERATE)
    assigned_manager_sub = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Investor({self.user_id})"


class SubPortfolio(models.Model):
    investor = models.ForeignKey(Investor, on_delete=models.CASCADE, related_name="sub_portfolios")
    name = models.CharField(max_length=150)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.name} ({self.investor_id})"


class Subscription(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "En attente"
        ACTIVE = "ACTIVE", "Actif"
        REPAYMENT = "REPAYMENT", "Remboursement"
        COMPLETED = "COMPLETED", "Terminé"
        DEFAULTED = "DEFAULTED", "Défaut"
        CANCELLED = "CANCELLED", "Annulé"

    class PaymentStatus(models.TextChoices):
        PAID = "PAID", "Payé"
        UNPAID = "UNPAID", "Impayé"
        OVERDUE = "OVERDUE", "En retard"

    investor = models.ForeignKey(Investor, on_delete=models.CASCADE, related_name="subscriptions")
    offer = models.ForeignKey(Offer, on_delete=models.PROTECT, related_name="subscriptions")
    sub_portfolio = models.ForeignKey(SubPortfolio, null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="subscriptions")
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    bonds = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    payment_status = models.CharField(max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    coupon_rate_snapshot = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))
    subscription_date = models.DateField(auto_now_add=True)
    next_payment_date = models.DateField(null=True, blank=True)
    total_received = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="subscription_amount_nonneg"),
        ]
        indexes = [models.Index(fields=["investor", "status"]), models.Index(fields=["offer"])]

    def __str__(self) -> str:
        return f"Sub({self.investor_id}->{self.offer_id}) {self.amount}"


class Movement(models.Model):
    class Type(models.TextChoices):
        DEPOSIT = "DEPOSIT", "Dépôt"
        SUBSCRIPTION = "SUBSCRIPTION", "Souscription"
        COUPON_REPAYMENT = "COUPON_REPAYMENT", "Remboursement coupon"
        CAPITAL_REPAYMENT = "CAPITAL_REPAYMENT", "Remboursement capital"
        WITHDRAWAL = "WITHDRAWAL", "Retrait"
        FEES = "FEES", "Frais"

    type = models.CharField(max_length=20, choices=Type.choices)
    investor = models.ForeignKey(Investor, null=True, blank=True, on_delete=models.SET_NULL, related_name="movements")
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="movements")
    subscription = models.ForeignKey(Subscription, null=True, blank=True, on_delete=models.SET_NULL,
                                      related_name="movements")
    geographic_zone = models.CharField(max_length=120, blank=True)
    assigned_manager_sub = models.CharField(max_length=255, blank=True)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.POSTED)
    transaction = models.ForeignKey("transactions.Transaction", null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name="investment_movements")
    date_time = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date_time"]

    def __str__(self) -> str:
        return f"{self.type} {self.amount} {self.currency}"


class RepaymentSchedule(models.Model):
    class Kind(models.TextChoices):
        COUPON = "COUPON", "Coupon"
        CAPITAL = "CAPITAL", "Capital"
        BULLET = "BULLET", "In fine"

    class Status(models.TextChoices):
        PENDING = "PENDING", "En attente"
        PAID = "PAID", "Payé"
        OVERDUE = "OVERDUE", "En retard"
        CANCELLED = "CANCELLED", "Annulé"

    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name="schedules")
    due_date = models.DateField()
    amount_due = models.DecimalField(max_digits=16, decimal_places=2)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.COUPON)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    paid_movement = models.ForeignKey(Movement, null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="schedule_entries")

    class Meta:
        ordering = ["due_date"]

    def __str__(self) -> str:
        return f"{self.offer.code} {self.kind} {self.due_date}"


class AnalystObservation(models.Model):
    class Category(models.TextChoices):
        TECHNICAL = "TECHNICAL", "Technique"
        FINANCIAL = "FINANCIAL", "Financier"
        MARKET = "MARKET", "Marché"
        RISK = "RISK", "Risque"
        ENVIRONMENTAL = "ENVIRONMENTAL", "Environnemental"
        SOCIAL = "SOCIAL", "Social"

    class RiskFlag(models.TextChoices):
        LOW = "LOW", "Faible"
        MEDIUM = "MEDIUM", "Moyen"
        HIGH = "HIGH", "Élevé"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="observations")
    analyst_name = models.CharField(max_length=150, blank=True)
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.RISK)
    risk_flag = models.CharField(max_length=10, choices=RiskFlag.choices, default=RiskFlag.LOW)
    observation = models.TextField(blank=True)
    recommendation = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.project.code} [{self.category}] {self.risk_flag}"


class ProjectQuestion(models.Model):
    class Status(models.TextChoices):
        ANSWERED = "ANSWERED", "Répondu"
        PENDING = "PENDING", "En attente"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="questions")
    investor = models.ForeignKey(Investor, on_delete=models.CASCADE, related_name="questions")
    question = models.TextField()
    question_date = models.DateTimeField(auto_now_add=True)
    answer = models.TextField(blank=True)
    answer_date = models.DateTimeField(null=True, blank=True)
    answered_by = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    class Meta:
        ordering = ["-question_date"]

    def __str__(self) -> str:
        return f"Q({self.project.code}) {self.status}"


class PerformanceReport(models.Model):
    class ValidationStatus(models.TextChoices):
        VALIDATED = "VALIDATED", "Validé"
        PENDING = "PENDING", "En attente"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="performance_reports")
    reporting_period = models.CharField(max_length=40, blank=True)
    submission_date = models.DateTimeField(auto_now_add=True)
    actual_revenue = models.FloatField(default=0)
    forecast_revenue = models.FloatField(default=0)
    actual_costs = models.FloatField(default=0)
    forecast_costs = models.FloatField(default=0)
    actual_production = models.FloatField(default=0)
    forecast_production = models.FloatField(default=0)
    deviation_percent = models.FloatField(default=0)
    deviation_comments = models.TextField(blank=True)
    validation_status = models.CharField(max_length=10, choices=ValidationStatus.choices,
                                          default=ValidationStatus.PENDING)
    validated_by = models.CharField(max_length=255, blank=True)
    validation_date = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-submission_date"]

    def __str__(self) -> str:
        return f"PerfReport({self.project.code}) {self.reporting_period}"


class PerformanceReportFile(models.Model):
    report = models.ForeignKey(PerformanceReport, on_delete=models.CASCADE, related_name="files")
    file = models.FileField(upload_to="performance_reports/")
    uploaded_at = models.DateTimeField(auto_now_add=True)


class TechnicalAnalysis(models.Model):
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="technical_analysis")
    land_size = models.FloatField(default=0)
    production_capacity = models.FloatField(default=0)
    production_cycle_months = models.IntegerField(default=0)
    yield_forecast = models.FloatField(default=0)
    climate_risk = models.TextField(blank=True)
    mitigation = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class FinancialAnalysis(models.Model):
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="financial_analysis")
    investment_breakdown = models.JSONField(default=dict, blank=True)
    revenue_forecast = models.JSONField(default=dict, blank=True)
    cost_structure = models.JSONField(default=dict, blank=True)
    cashflow_projection = models.JSONField(default=dict, blank=True)
    ebitda_margin = models.FloatField(default=0)
    dscr = models.FloatField(default=0)
    irr = models.FloatField(default=0)
    financial_score = models.FloatField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


# --- Produits obligataires (Obligations.jsx / Conversions.jsx / Holdings.jsx) : mécaniques
# distinctes du portefeuille d'offres ci-dessus, référencées via FK plutôt que fusionnées
# dans Subscription (pas des vues alternatives de la même ligne). ---

class ObligationPosition(models.Model):
    class Status(models.TextChoices):
        ACTIF = "ACTIF", "Actif"
        EN_ATTENTE = "EN_ATTENTE", "En attente"
        MATURE = "MATURE", "Maturé"

    investor = models.ForeignKey(Investor, on_delete=models.CASCADE, related_name="obligation_positions")
    offer = models.ForeignKey(Offer, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="obligation_positions")
    name = models.CharField(max_length=150)
    coupon_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("250"))
    invested_amount = models.DecimalField(max_digits=16, decimal_places=2)
    rate = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("9.0"))
    term_months = models.IntegerField(default=24)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIF)
    date_created = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.name} ({self.investor_id})"


class BondWithdrawal(models.Model):
    class Status(models.TextChoices):
        EN_ATTENTE = "EN_ATTENTE", "En attente"
        APPROUVE = "APPROUVE", "Approuvé"
        PAYE = "PAYE", "Payé"

    position = models.ForeignKey(ObligationPosition, on_delete=models.CASCADE, related_name="withdrawals")
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    penalty_rate = models.DecimalField(max_digits=5, decimal_places=3, default=Decimal("0.02"))
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.EN_ATTENTE)
    date = models.DateTimeField(auto_now_add=True)


class BondConversion(models.Model):
    class Status(models.TextChoices):
        EN_ATTENTE = "EN_ATTENTE", "En attente"
        APPROUVE = "APPROUVE", "Approuvé"
        REJETE = "REJETE", "Rejeté"

    position = models.ForeignKey(ObligationPosition, on_delete=models.CASCADE, related_name="conversions")
    coupons = models.IntegerField(default=0)
    value = models.DecimalField(max_digits=16, decimal_places=2)
    shares = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.EN_ATTENTE)
    date = models.DateTimeField(auto_now_add=True)


class SecondaryMarketListing(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Ouvert"
        SOLD = "SOLD", "Vendu"
        CANCELLED = "CANCELLED", "Annulé"

    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="listings")
    ask_price = models.DecimalField(max_digits=16, decimal_places=2)
    fee_rate = models.DecimalField(max_digits=5, decimal_places=3, default=Decimal("0.015"))
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    buyer = models.ForeignKey(Investor, null=True, blank=True, on_delete=models.SET_NULL, related_name="purchases")
    created_at = models.DateTimeField(auto_now_add=True)
