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

import copy
import uuid

from django.db import models
from django.utils import timezone


class ImmutableConsentMeta(Exception):
    """Tentative de réécriture d'une preuve de consentement déjà enregistrée.

    Définie ici plutôt que dans `credits.guarantor` pour que `models` n'importe
    aucun module de règles (le sens des dépendances resterait discutable, et
    l'import circulaire certain).
    """


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

    # Feuille de besoins attachée (legacy : parse en mémoire, totaux figés)
    needs_sheet = models.OneToOneField(
        NeedsSheet, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="credit_application",
    )

    # Révision COURANTE de la feuille de besoins ingérée en tables (dataio).
    # Principe 1 : ce qui est scoré = ce qui est en base. Simulation et scoring
    # lisent les DataRecord de cette source, jamais un fichier ni un payload.
    # PROTECT : la pièce probante d'un dossier ne s'efface pas.
    needs_source = models.ForeignKey(
        "dataio.DataSource", null=True, blank=True,
        on_delete=models.PROTECT, related_name="current_for_applications",
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
        """Cycle de vie d'une garantie — quatre statuts historiques, quatre ajouts.

        La SPEC §2.5 proposait un jeu complet
        (`pending_consent/consented/declined/expired/constituted/called`) pour la
        seule caution solidaire. Le remplacer aurait cassé les garanties épargne
        et les gages qui utilisent déjà `pending/active/released/expired` — et
        surtout aurait créé un sixième vocabulaire là où le principe 6 en exige
        un seul. Choix retenu : **extension, pas substitution.**

        Correspondances avec la SPEC :
          - `constituted` → `ACTIVE` : une garantie confirmée par l'agent était
            déjà « active » pour l'épargne et les gages. Deux mots pour un état
            identique auraient obligé chaque lecteur à connaître le type de la
            garantie pour interpréter son statut.
          - `expired`, `released` : déjà présents, sémantique inchangée.
          - `pending_consent`, `consented`, `declined`, `called` : réellement
            nouveaux, ils décrivent des états qui n'existaient nulle part.

        `PENDING` reste le « en attente de confirmation par un agent » des
        garanties épargne et des gages. Une caution morale n'y passe plus :
        elle naît en `PENDING_CONSENT`.
        """

        PENDING = "pending", "En attente de confirmation"
        PENDING_CONSENT = "pending_consent", "En attente du consentement du garant"
        CONSENTED = "consented", "Consentie par le garant"
        DECLINED = "declined", "Refusée par le garant"
        ACTIVE = "active", "Active / constituée"
        RELEASED = "released", "Levée / libérée"
        EXPIRED = "expired", "Expirée (délai dépassé)"
        CALLED = "called", "Appelée (défaut du débiteur)"

    #: Statuts à partir desquels une caution morale est opposable au garant.
    #: La soumission du dossier l'exige (`GUARANTOR_CONSENT_MISSING`).
    CONSENTED_OR_BEYOND = ("consented", "active", "called")

    application = models.ForeignKey(
        CreditApplication, on_delete=models.CASCADE, related_name="guarantees",
    )
    guarantee_type = models.CharField(max_length=10, choices=GuaranteeType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    # Montant réellement couvert par cette garantie, après décote. C'est ce
    # montant — jamais une valeur déclarée — qui entre dans le ratio de couverture.
    #
    # C'est aussi le `montant_couvert` de la SPEC §2.5 : le champ existait déjà,
    # avec exactement cette sémantique et cette précision. En ajouter un second
    # sous un nom français aurait donné deux colonnes pour un seul concept — le
    # défaut que le principe 6 interdit, et la première chose qu'un auditeur
    # aurait à démêler. Le nom canonique reste `covered_amount`.
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
    # Le garant est désormais une PERSONNE DU SYSTÈME, pas trois chaînes de
    # caractères. PROTECT : on ne supprime pas un utilisateur qui porte un
    # engagement de caution, même éteint — c'est une pièce probante (principe 9).
    guarantor = models.ForeignKey(
        "accounts.FintechUser", null=True, blank=True,
        on_delete=models.PROTECT, related_name="cautions_donnees",
    )
    # Champs déclaratifs historiques : conservés pour la trace des cautions
    # enregistrées avant le consentement opposable, et pour la pièce d'identité
    # relevée en agence. Ils ne suffisent plus à eux seuls à créer une caution.
    guarantor_sub = models.CharField(max_length=255, blank=True)   # sub OIDC du garant
    guarantor_name = models.CharField(max_length=200, blank=True)
    guarantor_phone = models.CharField(max_length=40, blank=True)
    guarantor_id_number = models.CharField(max_length=80, blank=True)  # CNI / passeport
    confirmed_by_sub = models.CharField(max_length=255, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)  # J+7 depuis création
    expiry_notified = models.BooleanField(default=False)

    # ── Consentement du garant ───────────────────────────────────────────────
    # Fenêtre distincte de `expires_at` : celle-ci borne l'acte du GARANT
    # (72 h par défaut, `InstitutionConfig`), `expires_at` bornait la
    # confirmation par un AGENT. Deux acteurs, deux délais, deux colonnes.
    consent_expires_at = models.DateTimeField(null=True, blank=True)

    # Preuve du consentement : horodatage, canal, IP, sub de l'auteur, fenêtre
    # appliquée. IMMUABLE une fois écrite (cf. `save`) — en cas de contentieux
    # sur une caution appelée, c'est la seule pièce qui établit que le garant a
    # bien consenti, quand, et depuis où.
    consent_meta = models.JSONField(default=dict, blank=True)

    # ── Audit ────────────────────────────────────────────────────────────────
    registered_by_sub = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # L'écran garant filtre sur (garant, type) à chaque affichage, et les
            # règles de capacité comptent les cautions vivantes du garant.
            models.Index(fields=["guarantor", "guarantee_type", "status"]),
        ]

    def __str__(self) -> str:
        return (
            f"Garantie {self.guarantee_type} [{self.status}] "
            f"— dossier {self.application.code}"
        )

    # ── Immuabilité de la preuve de consentement (principe 3) ────────────────

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        if "consent_meta" in field_names:
            instance._db_consent_meta = copy.deepcopy(instance.consent_meta)
        return instance

    def save(self, *args, **kwargs):
        """Refuse toute réécriture d'un `consent_meta` déjà constitué.

        Un consentement est probant : on ne le corrige pas, on en recueille un
        nouveau sur une nouvelle désignation. Sans ce garde-fou, un `save()`
        anodin ailleurs dans le code suffirait à effacer la seule pièce qui
        prouve l'engagement du garant.

        Limite honnête : `QuerySet.update()` court-circuite `save()` et n'est
        donc pas couvert. Le module n'utilise `update()` sur les garanties que
        pour des transitions de statut de masse (expiration), qui ne touchent
        pas `consent_meta`.
        """
        previous = getattr(self, "_db_consent_meta", None)
        if previous and self.consent_meta != previous:
            raise ImmutableConsentMeta(
                "consent_meta est la preuve du consentement du garant : elle ne "
                "peut être ni modifiée ni effacée après son enregistrement."
            )
        super().save(*args, **kwargs)
        self._db_consent_meta = copy.deepcopy(self.consent_meta)

    # ── Dérivés ──────────────────────────────────────────────────────────────

    @property
    def is_expired(self) -> bool:
        from django.utils import timezone
        if self.expires_at and self.status == self.Status.PENDING:
            return timezone.now() > self.expires_at
        return False

    @property
    def is_consent_expired(self) -> bool:
        """Fenêtre de consentement du garant dépassée sans réponse."""
        from django.utils import timezone
        if self.consent_expires_at and self.status == self.Status.PENDING_CONSENT:
            return timezone.now() > self.consent_expires_at
        return False

    @property
    def retained_coverage(self):
        """Montant réellement porté au ratio de couverture du dossier.

        Une caution morale n'y entre qu'après décote : elle n'apporte aucun actif
        réalisable, seulement une pression sociale de recouvrement. Les autres
        types entrent pour leur montant retenu, déjà déprécié à la vérification
        de l'actif ou bloqué en épargne.
        """
        from decimal import Decimal

        base = self.covered_amount or self.hold_amount or Decimal("0")
        if self.guarantee_type == self.GuaranteeType.MORALE:
            from credits.guarantor import moral_coverage_weight
            return (base * moral_coverage_weight()).quantize(Decimal("0.01"))
        return base


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


# ── Moteur d'analyse technico-économique (SPEC Moteur §3) ────────────────────
#
# Écarts assumés avec la SPEC, signalés plutôt que tranchés en silence :
#   - `DemandeCredit`       → `CreditApplication` (le modèle de la SPEC n'existe pas ici) ;
#   - `PlanFinancierUpload` → `dataio.DataSource` via `application.needs_source`
#     (lot 2 : la feuille de besoins est ingérée en tables, plus un fichier).
#   - la SPEC type les seuils en `float` ; tout est ici en `Decimal` (principe 4).


class ReferentielFiliere(models.Model):
    """Référentiel technico-économique par filière (fichier AGRICAP_FIN_SIM_xx).

    Alimenté par la boucle d'apprentissage (principe 10) : les plages indicatives
    sont progressivement remplacées par les données réelles à N ≥ 30 dossiers.
    `source` dit laquelle des deux autorités s'applique — une comparaison faite
    contre un référentiel `indicatif` ne vaut pas une comparaison faite contre
    200 dossiers, et le moteur doit le restituer comme tel.

    `value_chain_code` mappe la nomenclature `01`–`14` du référentiel v3 sur les
    codes `reference_data.ValueChain` : c'est la dette « 2 nomenclatures de
    filières » (CLAUDE.md §6), résorbée ici par une colonne de jointure plutôt
    que par une table de correspondance codée en dur.
    """

    class Source(models.TextChoices):
        INDICATIF = "indicatif", "Indicatif (plages estimées)"
        APPRIS = "appris", "Appris (N ≥ 30 dossiers réels)"

    code = models.CharField(max_length=60, unique=True)   # AGRICAP_FIN_SIM_01_Cereales_Mais
    filiere = models.CharField(max_length=100)            # Céréales — Maïs
    #: Code `reference_data.ValueChain` correspondant (jointure de nomenclatures).
    value_chain_code = models.CharField(max_length=50, blank=True, db_index=True)
    unite_reference = models.CharField(max_length=30, default="ha")

    #: {"semences": {"ref": "850.00", "tol_inf": "0.30", "tol_sup": "0.40"}, ...}
    #: Montants et tolérances stockés en CHAÎNES : un JSON `float` réintroduirait
    #: le binaire flottant que le principe 4 bannit du calcul financier.
    couts_modules = models.JSONField(default=dict)
    #: {"qte_unite": "4.5", "prix_unitaire": "380.00", "unite": "t"}
    rendement_ref = models.JSONField(default=dict)

    n_cas_reels = models.PositiveIntegerField(default=0)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.INDICATIF)
    version = models.PositiveIntegerField(default=1)
    actif = models.BooleanField(default=True)
    devise = models.CharField(max_length=3, default="USD")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return f"{self.code} ({self.filiere}) v{self.version}"

    @property
    def est_indicatif(self) -> bool:
        return self.source == self.Source.INDICATIF


class BaremeScore(models.Model):
    """Barème de conversion valeur → score, calibrable sans redéploiement (principe 8).

    Deux formes cohabitent, et une seule est renseignée à la fois :

      - **courbe** (`points`) : fonction affine par morceaux
        `[{"x": "0.5", "y": "0"}, {"x": "1.0", "y": "40"}, ...]` — c'est la forme
        des trois barèmes de la SPEC §5 (`DSCR`, `ECART_TECHNIQUE`,
        `COUVERTURE_GARANTIES`) ;
      - **règles** (`parametres`) : le barème de décision à 4 niveaux et le choc
        du stress test, qui ne sont pas des courbes. Ajout assumé à la SPEC : ces
        seuils étaient codés en dur dans son pseudo-code (`>= 75`, `>= 60`,
        `>= 45`, `CHOC_STRESS = 0.25`), ce que le principe 8 interdit.

    `evaluer()` travaille en `Decimal` de bout en bout. Le pseudo-code de la SPEC
    prend et rend des `float` : sur un barème dont un point d'inflexion tombe
    exactement sur un seuil de décision, l'erreur de représentation binaire suffit
    à faire basculer une recommandation.
    """

    code = models.CharField(max_length=40, unique=True)   # DSCR, ECART_TECHNIQUE...
    libelle = models.CharField(max_length=200, blank=True)
    points = models.JSONField(default=list)
    parametres = models.JSONField(default=dict, blank=True)
    actif = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return f"{self.code} v{self.version}"

    def evaluer(self, x):
        """Score 0–100 (quantizé au dixième) pour l'abscisse `x`.

        Hors des bornes, la courbe est prolongée par sa valeur extrême — jamais
        extrapolée : un DSCR de 40 ne vaut pas 4 000/100.
        """
        from decimal import Decimal, ROUND_HALF_UP

        dixieme = Decimal("0.1")
        pts = sorted(
            ({"x": Decimal(str(p["x"])), "y": Decimal(str(p["y"]))} for p in self.points),
            key=lambda p: p["x"],
        )
        if not pts:
            raise ValueError(f"Barème « {self.code} » sans point de courbe.")

        valeur = Decimal(str(x))
        if valeur <= pts[0]["x"]:
            return pts[0]["y"].quantize(dixieme, rounding=ROUND_HALF_UP)
        if valeur >= pts[-1]["x"]:
            return pts[-1]["y"].quantize(dixieme, rounding=ROUND_HALF_UP)

        for a, b in zip(pts, pts[1:]):
            if a["x"] <= valeur <= b["x"]:
                largeur = b["x"] - a["x"]
                if largeur == 0:
                    return b["y"].quantize(dixieme, rounding=ROUND_HALF_UP)
                t = (valeur - a["x"]) / largeur
                return (a["y"] + t * (b["y"] - a["y"])).quantize(
                    dixieme, rounding=ROUND_HALF_UP)
        # Inatteignable : les bornes sont traitées au-dessus.
        return pts[-1]["y"].quantize(dixieme, rounding=ROUND_HALF_UP)


class ImmutableAnalyse(Exception):
    """Tentative de modification d'une analyse déjà exécutée (principe 3)."""


class AnalyseCredit(models.Model):
    """Résultat complet d'une exécution du moteur — **immuable**.

    On ré-analyse, on ne corrige jamais : chaque exécution crée une ligne. L'écart
    entre deux analyses successives d'un même dossier est lui-même une donnée
    (principe 3) — d'où le triplet `needs_source / revision / sha256` figé ici :
    sans lui, comparer deux analyses ne dirait pas si c'est le moteur, les
    barèmes ou le fichier du client qui a bougé.

    Seul `justifications` peut évoluer, et seulement par ajout : une justification
    d'analyste s'ajoute au dossier, elle n'en retire ni n'en réécrit aucune.
    """

    class Recommandation(models.TextChoices):
        APPROBATION = "approbation", "Approbation recommandée"
        APPROBATION_COND = "approbation_cond", "Approbation sous conditions"
        REVUE = "revue", "Revue approfondie requise"
        REFUS = "refus", "Refus recommandé"

    #: PROTECT et non CASCADE (la SPEC dit CASCADE) : une analyse est une pièce
    #: probante, elle ne disparaît pas avec le dossier (garde-fou final §9).
    application = models.ForeignKey(
        CreditApplication, on_delete=models.PROTECT, related_name="analyses",
    )

    # ── Lignage : de quoi rejouer l'analyse à l'identique (principe 1) ────────
    needs_source = models.ForeignKey(
        "dataio.DataSource", on_delete=models.PROTECT, related_name="analyses",
    )
    needs_source_revision = models.PositiveIntegerField(default=1)
    needs_source_sha256 = models.CharField(max_length=64, blank=True)
    referentiel = models.ForeignKey(ReferentielFiliere, on_delete=models.PROTECT)

    # ── Paramètres du crédit analysé ─────────────────────────────────────────
    duree_mois = models.PositiveIntegerField()
    differe_mois = models.PositiveIntegerField(default=0)
    mode_differe = models.CharField(max_length=20, default="interets_seuls")
    taux_annuel = models.DecimalField(max_digits=6, decimal_places=3)
    capital = models.DecimalField(max_digits=15, decimal_places=2)
    devise = models.CharField(max_length=3, default="USD")

    # ── Résultats ────────────────────────────────────────────────────────────
    criteres = models.JSONField(default=dict)
    dscr = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    dscr_stress = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    score_global = models.DecimalField(max_digits=5, decimal_places=1)
    recommandation = models.CharField(max_length=20, choices=Recommandation.choices)

    indicateurs_hors_plage = models.JSONField(default=list)
    #: [{indicateur, justification, agent, date}] — APPEND ONLY (cf. `save`).
    justifications = models.JSONField(default=list)
    echeancier = models.JSONField(default=list)

    #: Empreinte des règles appliquées : poids retenus et version de chaque
    #: barème. Un recalibrage du comité ne doit pas rendre une analyse passée
    #: inexplicable.
    poids_appliques = models.JSONField(default=dict)
    baremes_appliques = models.JSONField(default=dict)

    execute_le = models.DateTimeField(auto_now_add=True)
    execute_par = models.CharField(max_length=255, blank=True)   # sub IdP
    version_moteur = models.CharField(max_length=10, default="4.0")

    class Meta:
        ordering = ["-execute_le", "-id"]
        indexes = [models.Index(fields=["application", "-execute_le"])]

    def __str__(self) -> str:
        return (f"Analyse #{self.pk} — {self.application.code} : "
                f"{self.score_global}/100 → {self.recommandation}")

    # ── Immuabilité (principe 3) ─────────────────────────────────────────────

    #: Seul champ dont une analyse déjà écrite accepte la mise à jour.
    MUTABLE_FIELDS = ("justifications",)

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._db_snapshot = {
            name: copy.deepcopy(getattr(instance, name))
            for name in field_names
            if name not in cls.MUTABLE_FIELDS and name != "id"
        }
        instance._db_justifications = copy.deepcopy(getattr(instance, "justifications", []))
        return instance

    def save(self, *args, **kwargs):
        snapshot = getattr(self, "_db_snapshot", None)
        if snapshot is not None:
            modifies = [
                name for name, ancien in snapshot.items()
                if getattr(self, name) != ancien
            ]
            if modifies:
                raise ImmutableAnalyse(
                    "Une analyse est immuable : on ré-analyse, on ne corrige pas. "
                    f"Champs modifiés : {', '.join(sorted(modifies))}."
                )
            anciennes = getattr(self, "_db_justifications", []) or []
            nouvelles = self.justifications or []
            if len(nouvelles) < len(anciennes) or nouvelles[:len(anciennes)] != anciennes:
                raise ImmutableAnalyse(
                    "Les justifications sont append-only : une justification "
                    "déjà enregistrée ne peut être ni retirée ni réécrite."
                )

        super().save(*args, **kwargs)
        self._db_snapshot = {
            f.attname: copy.deepcopy(getattr(self, f.attname))
            for f in self._meta.concrete_fields
            if f.attname not in self.MUTABLE_FIELDS and f.attname != "id"
        }
        self._db_justifications = copy.deepcopy(self.justifications)
