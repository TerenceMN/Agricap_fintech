"""
Module Crédits Agricoles — nouveau parcours piloté par les données.

Architecture :
  CreditApplication  ← dossier principal (machine à états complète)
  NeedsSheet         ← feuille de besoins parsée (feuilles 2-7)
  NeedItem           ← ligne d'un besoin (quantité × prix → total)
  ScoringCriterion   ← barème de scoring paramétrique (en base, pas dans le code)
  ModuleAllocation   ← répartition validée par module (créée à l'approbation)
"""
from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


def _gen_code() -> str:
    from django.utils.timezone import now
    dt = now()
    seq = str(uuid.uuid4().int)[:4]
    return f"CRED-{dt.strftime('%Y%m%d')}-{seq}"


class NeedsSheet(models.Model):
    """Feuille de Besoins parsée depuis un classeur Excel (feuilles 2-7)."""

    uploaded_by = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    raw_file = models.FileField(upload_to="credits/needs_sheets/")
    value_chain = models.ForeignKey(
        "reference_data.ValueChain", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="needs_sheets",
    )
    area_ha = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default="USD")
    parsed_ok = models.BooleanField(default=False)
    warnings = models.JSONField(default=list)
    anomalies = models.JSONField(default=list)
    total_by_module = models.JSONField(default=dict)   # {"semences": 5100.00, ...}
    grand_total = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    document_confidence = models.FloatField(null=True, blank=True)  # 0-100, calculé par DocumentReasoningEngine
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"NeedsSheet #{self.pk} ({self.uploaded_by})"


class NeedItem(models.Model):
    """Une ligne d'un besoin (une ligne Excel dans les feuilles 2-7)."""

    MODULES = [
        ("semences", "Semences & Intrants"),
        ("mecanisation", "Mécanisation"),
        ("maindoeuvre", "Main-d'œuvre"),
        ("equipements", "Équipements"),
        ("postrecolte", "Post-récolte"),
        ("logistique", "Logistique"),
        ("commercialisation", "Commercialisation"),
        ("reserve", "Réserve"),
    ]

    sheet = models.ForeignKey(NeedsSheet, on_delete=models.CASCADE, related_name="items")
    module = models.CharField(max_length=20, choices=MODULES)
    label = models.CharField(max_length=300)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    unit = models.CharField(max_length=60, blank=True)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    declared_total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    computed_total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    suggested_supplier = models.CharField(max_length=200, blank=True)
    supplier_warning = models.CharField(max_length=200, blank=True)  # vide si agrée
    source_sheet_index = models.IntegerField(default=2)  # 2..7

    class Meta:
        ordering = ["module", "id"]


class CreditApplication(models.Model):
    """Dossier de demande de crédit (machine à états complète)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Brouillon"
        SUBMITTED = "submitted", "Soumise"
        IN_ANALYSIS = "in_analysis", "En analyse"
        APPROVED = "approved", "Approuvée"
        REJECTED = "rejected", "Rejetée"
        ADJOURNED = "adjourned", "Ajournée"
        PENDING_DISBURSEMENT = "pending_disbursement", "En attente de décaissement"
        ACTIVE = "active", "Active (décaissée)"
        CLOSED = "closed", "Clôturée"

    class Currency(models.TextChoices):
        CDF = "CDF", "Franc Congolais"
        USD = "USD", "Dollar US"

    class RejectionReason(models.TextChoices):
        SCORE_INSUFFISANT = "score_insuffisant", "Score insuffisant"
        GARANTIE = "garantie", "Garantie insuffisante"
        ENDETTEMENT = "endettement", "Taux d'endettement trop élevé"
        INCOHERENCES = "incoherences", "Incohérences dans le dossier"
        AUTRE = "autre", "Autre"

    # Identité
    code = models.CharField(max_length=40, unique=True, default=_gen_code)
    client = models.ForeignKey(
        "accounts.FintechUser", on_delete=models.PROTECT, related_name="credit_applications",
    )
    initiated_by_sub = models.CharField(max_length=255, blank=True)  # agent si on_behalf_of

    # Chaîne de valeur & version référentiel (figés à la soumission)
    value_chain = models.ForeignKey(
        "reference_data.ValueChain", null=True, blank=True,
        on_delete=models.PROTECT, related_name="applications",
    )
    reference_version = models.ForeignKey(
        "reference_data.ReferenceFileUpload", null=True, blank=True,
        on_delete=models.PROTECT, related_name="credit_applications",
    )

    # Données de la demande
    area_ha = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    amount_requested = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    amount_approved = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)

    # Feuille de besoins attachée
    needs_sheet = models.OneToOneField(
        NeedsSheet, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="credit_application",
    )

    # Tracking des overrides par rapport au prefill
    prefill_snapshot = models.JSONField(default=dict)  # valeurs telles que retournées par /prefill
    overridden_fields = models.JSONField(default=list)  # ex: ["area_ha", "value_chain"]

    # Statut
    status = models.CharField(max_length=25, choices=Status.choices, default=Status.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by_sub = models.CharField(max_length=255, blank=True)  # maker

    # Analyse & décision
    score_result = models.JSONField(default=dict)     # résultat complet du scoring (Étape 3)
    guarantee_type = models.CharField(max_length=20, blank=True)  # epargne|morale
    reviewed_by_sub = models.CharField(max_length=255, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    approval_comment = models.TextField(blank=True)
    rejection_reason_code = models.CharField(
        max_length=30, choices=RejectionReason.choices, blank=True,
    )
    rejection_comment = models.TextField(blank=True)

    # Décaissement (Étape 6)
    disbursed_at = models.DateTimeField(null=True, blank=True)
    disbursed_by_sub = models.CharField(max_length=255, blank=True)
    disbursed_amount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)

    # Consentement client (demande par agent)
    client_consent_at = models.DateTimeField(null=True, blank=True)
    client_consent_method = models.CharField(max_length=20, blank=True)  # app|sms|ussd
    client_consent_expires = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.code} [{self.status}]"

    @property
    def is_on_behalf_of(self) -> bool:
        return bool(self.initiated_by_sub)

    @property
    def pending_client_consent(self) -> bool:
        if not self.is_on_behalf_of:
            return False
        if self.client_consent_at:
            return False
        if self.client_consent_expires and self.client_consent_expires < timezone.now():
            return False  # expired
        return self.status == self.Status.SUBMITTED


class ScoringCriterion(models.Model):
    """
    Barème de scoring paramétrique (Étape 3).
    Chaque critère a un poids et des règles de calcul.
    """

    class ComputeMethod(models.TextChoices):
        REPAYMENT_HISTORY = "repayment_history", "Historique de remboursement"
        NEEDS_COHERENCE = "needs_coherence", "Cohérence besoins vs référentiel"
        DEBT_RATIO = "debt_ratio", "Ratio endettement / capacité"
        KYC_SENIORITY = "kyc_seniority", "Ancienneté & KYC"
        SECTOR_RISK = "sector_risk", "Risque filière"

    code = models.CharField(max_length=50, unique=True)
    label = models.CharField(max_length=200)
    compute_method = models.CharField(max_length=40, choices=ComputeMethod.choices)
    max_points = models.IntegerField()
    weight = models.DecimalField(max_digits=5, decimal_places=2, default=1)
    active = models.BooleanField(default=True)
    config = models.JSONField(default=dict)  # paramètres spécifiques à la méthode
    order = models.IntegerField(default=10)

    class Meta:
        ordering = ["order"]

    def __str__(self) -> str:
        return f"{self.label} ({self.max_points} pts)"


class DisbursementRequest(models.Model):
    """
    Double validation du décaissement (Étape 6).
    Le demandeur (maker) ≠ le confirmateur (checker).
    """

    class Status(models.TextChoices):
        PENDING = "pending", "En attente de confirmation"
        CONFIRMED = "confirmed", "Confirmé — décaissé"
        CANCELLED = "cancelled", "Annulé"

    application = models.OneToOneField(
        CreditApplication, on_delete=models.CASCADE, related_name="disbursement_request",
    )
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    requested_by_sub = models.CharField(max_length=255)
    requested_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    confirmed_by_sub = models.CharField(max_length=255, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    # Références créées lors de la confirmation
    loan_id = models.IntegerField(null=True, blank=True)          # portfolio.Loan.pk
    journal_entry_id = models.IntegerField(null=True, blank=True)  # ledger.JournalEntry.pk

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-requested_at"]

    def __str__(self) -> str:
        return f"DisbReq {self.application.code} [{self.status}]"


class CreditGuarantee(models.Model):
    """
    Garantie attachée à un dossier de crédit.

    Quatre types canoniques — le backend fait foi, le front mappe pour
    l'affichage (`actif` et `immobilier` sont des alias d'affichage de
    `materiel` et `foncier`, pas des codes de stockage) :

      epargne   — blocage d'un montant sur un plan d'épargne existant
      morale    — caution solidaire d'un membre du groupe, confirmation 7 j
      materiel  — gage sur un actif mobilier vérifié (assets.Asset)
      foncier   — hypothèque sur un actif immobilier vérifié (assets.Asset)

    Un type n'est posable que s'il figure dans `ValueChain.eligible_guarantees`
    de la filière du dossier.
    """

    class GuaranteeType(models.TextChoices):
        EPARGNE = "epargne", "Nantissement épargne"
        MORALE = "morale", "Caution solidaire"
        MATERIEL = "materiel", "Gage matériel"
        FONCIER = "foncier", "Hypothèque / foncier"

    #: Types adossés à un actif du registre `assets`
    ASSET_BACKED_TYPES = ("materiel", "foncier")

    class Status(models.TextChoices):
        PENDING = "pending", "En attente de confirmation"
        ACTIVE = "active", "Active"
        RELEASED = "released", "Levée / libérée"
        EXPIRED = "expired", "Expirée (délai dépassé)"

    application = models.ForeignKey(
        CreditApplication, on_delete=models.CASCADE, related_name="guarantees",
    )
    guarantee_type = models.CharField(max_length=10, choices=GuaranteeType.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    # Montant réellement couvert par cette garantie, après décote. C'est ce
    # montant — jamais une valeur déclarée — qui entre dans le ratio de couverture.
    covered_amount = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )

    # ── Champs gage sur actif (materiel / foncier) ───────────────────────────
    asset = models.ForeignKey(
        "assets.Asset", null=True, blank=True,
        on_delete=models.PROTECT, related_name="guarantees",
    )

    # ── Champs épargne ───────────────────────────────────────────────────────
    savings_plan = models.ForeignKey(
        "savings.SavingsPlan", null=True, blank=True,
        on_delete=models.PROTECT, related_name="credit_holds",
    )
    hold_amount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    hold_currency = models.CharField(max_length=3, default="USD")
    hold_reference = models.CharField(max_length=50, blank=True)  # ex: HOLD-CRED-20260101-XXXX
    hold_placed_at = models.DateTimeField(null=True, blank=True)
    hold_released_at = models.DateTimeField(null=True, blank=True)

    # ── Champs caution morale ────────────────────────────────────────────────
    guarantor_sub = models.CharField(max_length=255, blank=True)   # sub OIDC du garant
    guarantor_name = models.CharField(max_length=200, blank=True)
    guarantor_phone = models.CharField(max_length=40, blank=True)
    guarantor_id_number = models.CharField(max_length=80, blank=True)  # CNI / passeport
    confirmed_by_sub = models.CharField(max_length=255, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)  # J+7 depuis création
    expiry_notified = models.BooleanField(default=False)

    # ── Audit ────────────────────────────────────────────────────────────────
    registered_by_sub = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return (
            f"Garantie {self.guarantee_type} [{self.status}] "
            f"— dossier {self.application.code}"
        )

    @property
    def is_expired(self) -> bool:
        from django.utils import timezone
        if self.expires_at and self.status == self.Status.PENDING:
            return timezone.now() > self.expires_at
        return False


class ModuleAllocation(models.Model):
    """
    Répartition finale par module (créée à l'approbation, pilote le décaissement).
    """

    application = models.ForeignKey(
        CreditApplication, on_delete=models.CASCADE, related_name="module_allocations",
    )
    module = models.CharField(max_length=20)
    cost = models.DecimalField(max_digits=15, decimal_places=2)
    financing_pct = models.DecimalField(max_digits=5, decimal_places=2)  # % financé
    amount_financed = models.DecimalField(max_digits=15, decimal_places=2)
    source = models.CharField(max_length=20, default="needs_sheet")  # needs_sheet|referential|manual
    overridden = models.BooleanField(default=False)  # modifié par l'agent par rapport au standard

    class Meta:
        unique_together = [("application", "module")]


# ── Partie H : Moteur d'analyse documentaire ─────────────────────────────────

class AnalysisRule(models.Model):
    """
    Règle d'analyse paramétrable (ruleId → sévérité, seuils).
    Chaque règle est nommée, versionnée et activable/désactivable sans déploiement.
    """
    SEVERITY_CHOICES = [
        ("info",         "Info"),
        ("point_fort",   "Point fort"),
        ("a_justifier",  "À justifier"),
        ("anomalie",     "Anomalie"),
        ("bloquant",     "Bloquant"),
    ]

    rule_id = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    severity_default = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default="anomalie")
    thresholds = models.JSONField(default=dict)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["rule_id"]

    def __str__(self) -> str:
        return f"{self.rule_id} ({self.severity_default})"


class LineFinding(models.Model):
    """
    Constat d'analyse documentaire : une preuve source traçable jusqu'à la ligne exacte,
    liée à un critère de scoring et au workflow analyste (justifier / confirmer).
    """
    SEVERITY_CHOICES = AnalysisRule.SEVERITY_CHOICES
    ANALYST_STATUS_CHOICES = [
        ("a_traiter",         "À traiter"),
        ("justifie",          "Justifié"),
        ("corrige",           "Corrigé"),
        ("confirme_anomalie", "Anomalie confirmée"),
    ]

    needs_sheet = models.ForeignKey(
        NeedsSheet, on_delete=models.CASCADE, related_name="findings",
    )
    rule = models.ForeignKey(
        AnalysisRule, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="findings",
    )
    rule_id_snapshot = models.CharField(max_length=60)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES)
    # Preuve source
    source = models.JSONField(default=dict)      # {sheet, row, label, module}
    observed = models.JSONField(default=dict)    # {value, unit, quantity}
    reference = models.JSONField(default=dict)   # {value, range, origin, referentialVersion}
    deviation = models.CharField(max_length=30, blank=True)
    score_impact = models.JSONField(default=dict)  # {criterion, points}
    conclusion = models.TextField()
    recommendation = models.TextField(blank=True)
    # Workflow analyste
    analyst_status = models.CharField(
        max_length=20, choices=ANALYST_STATUS_CHOICES, default="a_traiter",
    )
    analyst_comment = models.TextField(blank=True)
    analyst_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.rule_id_snapshot} [{self.severity}] → NeedsSheet#{self.needs_sheet_id}"
