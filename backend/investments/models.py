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


class InvestmentConfig(models.Model):
    """Paramètres du module investissement — principe 8 : « les règles vivent en base ».

    Un seul enregistrement actif. Tout ce qui gouverne une décision (quorum du comité,
    coefficients du score de santé, seuils d'alerte, politique de sursouscription par
    défaut) vit ici et non dans le code : le comité doit pouvoir recalibrer sans
    redéploiement, et la formule affichée à l'investisseur doit correspondre
    exactement aux paramètres appliqués.
    """

    is_active = models.BooleanField(default=True)

    #: Quorum du comité d'investissement. `null` = on hérite du quorum du comité de
    #: crédit (`credits.committee.committee_quorum()`, lui-même lu dans
    #: `InstitutionConfig`) — un seul paramétrage de gouvernance tant que
    #: l'institution n'a pas voulu les dissocier.
    committee_quorum = models.PositiveIntegerField(null=True, blank=True)

    # Score de santé /100 (Annexe D) :
    #   100 − a×taux_défaut − b×max(0, H−h₀)×100 − c×part_projets_en_retard
    health_coeff_default = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("4"))     # a
    health_coeff_concentration = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("50"))  # b
    health_coeff_late = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("1"))        # c
    #: h₀ — seuil de Herfindahl au-delà duquel la concentration pénalise (Annexe D).
    concentration_threshold = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal("0.25"))
    #: Seuil d'alerte du taux de défaut en valeur (5 % par défaut, Annexe D).
    default_rate_alert = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal("0.05"))

    #: Décote de provision appliquée au capital non remboursé d'un projet en défaut
    #: (P12) pour la valorisation latente — Annexe D, « décote de provision pour P12 ».
    #: 1,0000 = provision à 100 %, donc valeur retenue nulle. Un recouvrement
    #: RÉELLEMENT encaissé prime toujours sur ce paramètre : un fait bat une hypothèse.
    p12_provision_rate = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal("1.0000"))
    #: Âge maximal d'une valorisation d'expert avant péremption (Annexe D exige une
    #: expertise DATÉE pour les titres de capital). Au-delà, on retombe au pair et on
    #: le dit — une expertise de 2023 n'est pas une valeur de 2026.
    expert_valuation_max_age_months = models.PositiveIntegerField(default=12)

    #: Écart (en %) au-delà duquel un rapport de performance déclenche une observation
    #: de risque. Était codé en dur à 10 dans `submit_performance_report` — un seuil
    #: métier dans le code est un seuil que le comité ne peut pas corriger (principe 8).
    performance_deviation_alert_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("10.00"))

    #: Politique appliquée aux offres qui ne précisent rien (voir `Offer.Oversubscription`).
    default_oversubscription_policy = models.CharField(max_length=10, default="QUEUE")
    #: Part de l'objectif en deçà de laquelle la levée échoue à l'échéance (min-funding).
    default_min_funding_ratio = models.DecimalField(max_digits=5, decimal_places=4, default=Decimal("0.7000"))

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Configuration investissement"

    @classmethod
    def active(cls) -> "InvestmentConfig":
        cfg = cls.objects.filter(is_active=True).order_by("-pk").first()
        return cfg or cls(is_active=True)  # instance non persistée = valeurs par défaut

    def __str__(self) -> str:
        return f"InvestmentConfig(actif={self.is_active})"


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
    #: Σ souscriptions ENCAISSÉES (B10). Une réservation n'est pas de l'argent : elle
    #: n'entre jamais ici (principe 8 du prompt HAZINA, §3 de la mission).
    funded_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    #: Σ décaissée au promoteur (B11), Σ retours encaissés (B12), Σ distribuée (B13).
    disbursed_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    returned_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    distributed_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))

    #: Conditions posées par le comité en P05 — « approbation conditionnelle » n'a de
    #: sens que si les conditions sont écrites et leur levée tracée.
    committee_conditions = models.TextField(blank=True)
    conditions_cleared_at = models.DateTimeField(null=True, blank=True)
    defaulted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=3, choices=Status.choices, default=Status.P01)
    risk_category = models.CharField(max_length=80, blank=True)
    risk_score = models.IntegerField(default=5)  # 1-10
    global_score = models.FloatField(default=0)

    start_date = models.DateField(null=True, blank=True)
    expected_maturity = models.DateField(null=True, blank=True)

    #: Valorisation d'expert des titres de capital (Annexe D : « valorisation d'expert
    #: DATÉE pour les actions »). Trois champs indissociables — une valeur sans date ni
    #: source n'est pas une expertise, c'est une opinion : la valorisation n'est retenue
    #: que si les trois sont renseignés et que la date n'est pas périmée
    #: (`InvestmentConfig.expert_valuation_max_age_months`). Sinon : au pair, et la
    #: méthode affichée le dit.
    expert_valuation = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    expert_valuation_date = models.DateField(null=True, blank=True)
    expert_valuation_source = models.CharField(max_length=200, blank=True)

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

    class Oversubscription(models.TextChoices):
        """Traitement des souscriptions au-delà de l'objectif — paramétrable par offre.

        QUEUE   : premier arrivé premier servi ; le surplus part en liste d'attente et
                  n'est servi que si une réservation antérieure tombe.
        PRORATA : toutes les réservations sont acceptées ; à la clôture, chacune est
                  réduite au prorata et le surplus n'est jamais encaissé.
        REJECT  : la réservation qui dépasse l'objectif est refusée sur-le-champ.
        """

        QUEUE = "QUEUE", "File d'attente (premier arrivé)"
        PRORATA = "PRORATA", "Prorata à la clôture"
        REJECT = "REJECT", "Refus au-delà de l'objectif"

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
    #: RÉSERVÉ ≠ ENCAISSÉ. `reserved_amount` = engagements pris (souscriptions vivantes,
    #: hors liste d'attente) ; `funded_amount` = argent réellement reçu (B10).
    reserved_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    funded_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    #: Seuil de min-funding : en deçà, la levée échoue à l'échéance et les souscripteurs
    #: sont remboursés (P13). 0 = pas de plancher (dérivé de la config à la création).
    min_funding_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    subscription_deadline = models.DateField(null=True, blank=True)
    oversubscription_policy = models.CharField(
        max_length=10, choices=Oversubscription.choices, default=Oversubscription.QUEUE,
    )
    closed_at = models.DateTimeField(null=True, blank=True)
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
    """Une souscription RÉSERVE, elle n'encaisse pas.

    `RESERVED` = engagement pris, aucun franc n'a bougé. `SETTLED` = argent reçu et
    comptabilisé (B10) — c'est le seul état qui alimente `funded_amount`, qui autorise
    le décaissement et qui compte dans le XIRR. `WAITLISTED` = au-delà de l'objectif,
    en file d'attente (politique QUEUE). `REFUNDED` = souscription encaissée puis
    remboursée (min-funding non atteint ou annulation P13, contrepassation de B10).
    """

    class Status(models.TextChoices):
        RESERVED = "RESERVED", "Réservée (non encaissée)"
        WAITLISTED = "WAITLISTED", "Liste d'attente"
        SETTLED = "SETTLED", "Encaissée"
        PENDING = "PENDING", "En attente (hérité)"
        ACTIVE = "ACTIVE", "Actif"
        REPAYMENT = "REPAYMENT", "Remboursement"
        COMPLETED = "COMPLETED", "Terminé"
        DEFAULTED = "DEFAULTED", "Défaut"
        REFUNDED = "REFUNDED", "Remboursée"
        CANCELLED = "CANCELLED", "Annulé"

    #: États dans lesquels la souscription pèse sur l'objectif de l'offre.
    LIVE_STATUSES = ("RESERVED", "SETTLED", "ACTIVE", "REPAYMENT", "COMPLETED", "DEFAULTED")
    #: États dans lesquels l'argent a réellement été reçu.
    FUNDED_STATUSES = ("SETTLED", "ACTIVE", "REPAYMENT", "COMPLETED", "DEFAULTED")

    class PaymentStatus(models.TextChoices):
        PAID = "PAID", "Payé"
        UNPAID = "UNPAID", "Impayé"
        OVERDUE = "OVERDUE", "En retard"

    investor = models.ForeignKey(Investor, on_delete=models.CASCADE, related_name="subscriptions")
    offer = models.ForeignKey(Offer, on_delete=models.PROTECT, related_name="subscriptions")
    sub_portfolio = models.ForeignKey(SubPortfolio, null=True, blank=True, on_delete=models.SET_NULL,
                                       related_name="subscriptions")
    #: Montant RÉSERVÉ. Il ne bouge pas : la réduction prorata s'inscrit dans
    #: `allocated_amount`, et l'encaissement dans `settled_amount` — pour qu'un
    #: auditeur voie ce qui a été promis ET ce qui a été servi.
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    allocated_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    settled_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    refunded_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    bonds = models.IntegerField(default=0)
    #: Rang dans la file (politique QUEUE) — 0 pour les souscriptions servies.
    queue_rank = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RESERVED)
    payment_status = models.CharField(max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    coupon_rate_snapshot = models.DecimalField(max_digits=6, decimal_places=3, default=Decimal("0"))
    subscription_date = models.DateField(auto_now_add=True)
    reserved_at = models.DateTimeField(null=True, blank=True)
    #: Horodatage de l'encaissement : c'est LA date de flux du XIRR côté investisseur.
    settled_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    next_payment_date = models.DateField(null=True, blank=True)
    total_received = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="subscription_amount_nonneg"),
            models.CheckConstraint(
                condition=Q(settled_amount__gte=0) & Q(allocated_amount__gte=0) & Q(refunded_amount__gte=0),
                name="subscription_lifecycle_amounts_nonneg",
            ),
        ]
        indexes = [models.Index(fields=["investor", "status"]), models.Index(fields=["offer"])]

    @property
    def is_funded(self) -> bool:
        return self.status in Subscription.FUNDED_STATUSES

    def __str__(self) -> str:
        return f"Sub({self.investor_id}->{self.offer_id}) {self.amount}"


class Movement(models.Model):
    class Type(models.TextChoices):
        DEPOSIT = "DEPOSIT", "Dépôt"
        #: Réservation — trace applicative, AUCUN mouvement d'argent (pas d'écriture).
        SUBSCRIPTION = "SUBSCRIPTION", "Souscription (réservation)"
        #: Encaissement de la souscription — B10.
        SETTLEMENT = "SETTLEMENT", "Encaissement souscription"
        #: Remboursement d'une souscription encaissée — contrepassation de B10.
        REFUND = "REFUND", "Remboursement souscription"
        #: Décaissement vers le projet — B11.
        DISBURSEMENT = "DISBURSEMENT", "Décaissement projet"
        #: Retour du projet — B12.
        PROJECT_RETURN = "PROJECT_RETURN", "Encaissement retour projet"
        #: Distribution aux investisseurs au prorata — B13.
        DISTRIBUTION = "DISTRIBUTION", "Distribution investisseurs"
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


class ProjectTransition(models.Model):
    """Journal append-only des transitions P01→P13 — acteur, horodatage, motif.

    Double du journal d'audit (`audit.services.record`, seul journal transverse) : ici
    la trace est interrogeable PAR PROJET sans traverser tout l'audit, ce dont a besoin
    l'écran « historique du dossier ». Jamais d'UPDATE ni de DELETE (principe 3) : on
    n'annule pas une transition, on en pose une nouvelle.
    """

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="transitions")
    from_status = models.CharField(max_length=3)
    to_status = models.CharField(max_length=3)
    actor_sub = models.CharField(max_length=255, blank=True)
    actor_role = models.CharField(max_length=64, blank=True)
    #: Motif obligatoire — une transition sans motif n'est pas reconstituable.
    reason = models.TextField()
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["project", "created_at"])]

    def __str__(self) -> str:
        return f"{self.project_id}: {self.from_status}→{self.to_status}"


class InvestmentCommitteeVote(models.Model):
    """Vote nominatif au comité d'investissement (P04) — append-only.

    Structure et règles calquées sur `credits.models.CommitteeVote` (même sémantique :
    un vote par membre, motif obligatoire, quorum figé au moment du vote). Le modèle est
    distinct parce que l'objet voté l'est : un `CreditApplication` n'est pas un `Project`,
    et une FK ne se généralise pas sans table polymorphe — voir `investments/committee.py`
    pour ce qui est effectivement réutilisé du module crédit.
    """

    class Decision(models.TextChoices):
        APPROVE = "approve", "Pour l'approbation"
        REJECT = "reject", "Pour le rejet"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="committee_votes")
    voter_sub = models.CharField(max_length=255)
    decision = models.CharField(max_length=10, choices=Decision.choices)
    comment = models.TextField()
    conditions = models.TextField(blank=True)
    quorum_at_vote = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["project", "voter_sub"],
                                     name="unique_investment_committee_vote_per_member"),
        ]
        indexes = [models.Index(fields=["project", "created_at"])]

    def __str__(self) -> str:
        return f"{self.project_id} {self.voter_sub}:{self.decision}"


class InvestmentEvent(models.Model):
    """Événement métier append-only — le SEUL contrat entre `investments` et la
    comptabilité (`accounting`, construit par un autre agent).

    Ce module ne passe aucune écriture : il déclare que quelque chose s'est produit
    (encaissement d'une souscription, décaissement d'un projet, retour, distribution,
    remboursement) avec son montant, sa devise, son cantonnement d'offre et sa date.
    Le moteur d'écritures consomme la file (`consumed_at` / `journal_reference`) et
    applique le catalogue B10→B13. Aucun consommateur n'est requis pour que le module
    fonctionne : l'événement est produit, qu'il soit lu ou non.
    """

    class Type(models.TextChoices):
        #: B10 — encaissement souscription : 501/511 → 419-OFF.
        SUBSCRIPTION_SETTLED = "SUBSCRIPTION_SETTLED", "Encaissement souscription (B10)"
        #: Contrepassation B10 — remboursement d'une souscription encaissée.
        SUBSCRIPTION_REFUNDED = "SUBSCRIPTION_REFUNDED", "Remboursement souscription (B10 contrepassé)"
        #: B11 — décaissement projet : 419-OFF → 501/511.
        PROJECT_DISBURSED = "PROJECT_DISBURSED", "Décaissement projet (B11)"
        #: B12 — encaissement retour projet : 501/511 → 719 + 419-OFF.
        PROJECT_RETURN_RECEIVED = "PROJECT_RETURN_RECEIVED", "Encaissement retour projet (B12)"
        #: B13 — distribution investisseur au prorata : 419-OFF → 501/511.
        DISTRIBUTION_PAID = "DISTRIBUTION_PAID", "Distribution investisseur (B13)"
        #: Sans écriture — signale à la compta qu'une provision est à constituer.
        PROJECT_DEFAULTED = "PROJECT_DEFAULTED", "Défaut projet (provision à constituer)"

    event_type = models.CharField(max_length=32, choices=Type.choices, db_index=True)
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.PROTECT,
                                 related_name="accounting_events")
    offer = models.ForeignKey(Offer, null=True, blank=True, on_delete=models.PROTECT,
                               related_name="accounting_events")
    subscription = models.ForeignKey(Subscription, null=True, blank=True, on_delete=models.PROTECT,
                                      related_name="accounting_events")
    investor = models.ForeignKey(Investor, null=True, blank=True, on_delete=models.PROTECT,
                                  related_name="accounting_events")
    amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, default="USD")
    #: Sous-compte de cantonnement attendu par la compta (419-OFF-xxxx, Annexe A).
    segregation_account = models.CharField(max_length=32, blank=True)
    occurred_at = models.DateTimeField(db_index=True)
    actor_sub = models.CharField(max_length=255, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    #: Renseignés par le consommateur comptable — jamais par ce module.
    consumed_at = models.DateTimeField(null=True, blank=True)
    journal_reference = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at", "id"]
        indexes = [
            models.Index(fields=["event_type", "occurred_at"]),
            models.Index(fields=["consumed_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} {self.amount} {self.currency}"


class Distribution(models.Model):
    """Distribution au prorata des souscriptions ENCAISSÉES d'une offre (B13).

    Une distribution ne peut jamais excéder ce qui a été effectivement encaissé du
    projet (B12) et non encore distribué : « pas de distribution sans encaissement ».
    """

    class Kind(models.TextChoices):
        COUPON = "COUPON", "Coupon / rendement"
        CAPITAL = "CAPITAL", "Remboursement de capital"
        REFUND = "REFUND", "Remboursement de souscription"

    offer = models.ForeignKey(Offer, on_delete=models.PROTECT, related_name="distributions")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.COUPON)
    total_amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    value_date = models.DateField()
    executed_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-value_date", "-id"]

    def __str__(self) -> str:
        return f"Distribution({self.offer_id}) {self.kind} {self.total_amount}"


class DistributionLine(models.Model):
    """Part d'un investisseur dans une distribution — la quote-part se calcule sur les
    montants ENCAISSÉS, jamais sur les montants réservés."""

    distribution = models.ForeignKey(Distribution, on_delete=models.CASCADE, related_name="lines")
    subscription = models.ForeignKey(Subscription, on_delete=models.PROTECT, related_name="distribution_lines")
    investor = models.ForeignKey(Investor, on_delete=models.PROTECT, related_name="distribution_lines")
    share = models.DecimalField(max_digits=9, decimal_places=8, default=Decimal("0"))
    amount = models.DecimalField(max_digits=16, decimal_places=2)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["distribution", "subscription"],
                                     name="unique_distribution_line_per_subscription"),
        ]


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
    #: Écart de REVENU (réalisé − prévu) / prévu × 100. Le nom est générique pour des
    #: raisons historiques : il est consommé tel quel par le front. Ses deux frères
    #: ci-dessous lèvent l'ambiguïté plutôt que de le renommer sous les pieds d'un
    #: écran livré.
    deviation_percent = models.FloatField(default=0)
    #: Écart de COÛTS. Attention au sens : un écart POSITIF est défavorable (les coûts
    #: dépassent la prévision), là où un écart de revenu positif est favorable. Deux
    #: grandeurs de même forme et de sens opposé — d'où `unfavorable_deviations`.
    cost_deviation_percent = models.FloatField(default=0)
    #: Écart de PRODUCTION (positif = favorable, comme le revenu).
    production_deviation_percent = models.FloatField(default=0)
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
    #: Approbation explicite — condition d'entrée en comité (P04, Annexe C).
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.CharField(max_length=255, blank=True)
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
    #: Approbation explicite — condition d'entrée en comité (P04, Annexe C).
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.CharField(max_length=255, blank=True)
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
