"""Socle comptable AGRICAP — partie double BI-MONNAIE native (HAZINA, annexes A/B/E).

Différence STRUCTURANTE avec l'app `ledger` existante : ici la devise est portée par la
LIGNE (`LigneEcriture.devise`), pas par la pièce. C'est ce qui rend représentable une
opération mixte FC↔USD — donc le mécanisme 588FX de l'annexe E, impossible à écrire avec un
modèle mono-devise par écriture.

Invariants portés par ce module :
  * Σ débits = Σ crédits **PAR DEVISE** avant persistance (`services.verifier_equilibre`) ;
  * append-only : une pièce `VALIDEE` est immuable, on contrepasse (jamais d'UPDATE/DELETE) ;
  * aucun compte mouvementé n'est supprimable (FK `PROTECT` + garde explicite).

Limite assumée et documentée : l'équilibre par devise est un invariant AGRÉGÉ cross-lignes,
qu'un `CheckConstraint` SQL ne peut pas exprimer. Il est donc verrouillé (a) dans le service
de validation, seul chemin d'écriture, (b) par les gardes d'immuabilité qui empêchent de
déséquilibrer une pièce après coup, et (c) par un contrôle global rejouable
(`services.controler_integrite`) couvert par un test bloquant.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.db.models import Q

from common.exceptions import ValidationFailed


class Devise(models.TextChoices):
    """Les deux devises structurelles d'AGRICAP. `FC` est la nomenclature de l'annexe A
    (l'app `fx` historique utilise `CDF` implicitement — divergence signalée au fondateur)."""

    FC = "FC", "Franc congolais"
    USD = "USD", "Dollar américain"


class Nature(models.TextChoices):
    """Sens normal du solde — repris à l'identique de `ledger.ChartAccount.Nature` pour ne
    pas créer un quatrième vocabulaire (principe 6 : une seule nomenclature par concept)."""

    ACTIF = "ACTIF", "Actif"
    PASSIF = "PASSIF", "Passif"
    CHARGE = "CHARGE", "Charge"
    PRODUIT = "PRODUIT", "Produit"


class Journal(models.TextChoices):
    JCR = "JCR", "Journal crédit"
    JEP = "JEP", "Journal épargne"
    JCA = "JCA", "Journal caisse"
    JMM = "JMM", "Journal mobile money"
    JFX = "JFX", "Journal change"
    JIN = "JIN", "Journal investissement"
    JOD = "JOD", "Journal opérations diverses"


class CompteComptable(models.Model):
    """Un compte du plan comptable canonique (annexe A).

    Un compte est MONO-DEVISE quand l'annexe le dédouble (413FC / 413USD) : `racine` porte
    alors le code générique de l'annexe et `code` = racine + devise. Les comptes sans devise
    (`devise` vide) acceptent n'importe quelle devise de ligne — c'est le cas des comptes de
    résultat de change 613FX / 712FX, que l'annexe A laisse sans dédoublement.
    """

    code = models.CharField(max_length=32, unique=True, db_index=True)
    racine = models.CharField(max_length=24, db_index=True)
    intitule = models.CharField(max_length=200)
    classe = models.PositiveSmallIntegerField()
    nature = models.CharField(max_length=8, choices=Nature.choices)
    devise = models.CharField(max_length=3, choices=Devise.choices, blank=True)
    est_transitoire = models.BooleanField(
        default=False,
        help_text="Compte de passage (581, 588FX) dont le solde doit tendre vers zéro.",
    )
    cantonnement = models.CharField(
        max_length=64, blank=True, db_index=True,
        help_text="Référence de l'offre pour les sous-comptes de cantonnement 419-OFF-xxxx.",
    )
    actif = models.BooleanField(default=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="enfants",
    )
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "compte comptable"
        verbose_name_plural = "comptes comptables"

    def __str__(self) -> str:
        return f"{self.code} — {self.intitule}"

    def accepte_devise(self, devise: str) -> bool:
        return not self.devise or self.devise == devise

    def delete(self, *args, **kwargs):
        """Un compte mouvementé n'est JAMAIS supprimable (la FK `PROTECT` l'interdit déjà au
        niveau base ; on lève ici un message métier explicite plutôt qu'une `ProtectedError`
        opaque). Un compte non mouvementé se désactive plutôt qu'il ne se supprime."""
        if self.lignes.exists():
            raise ValidationFailed(
                f"Le compte {self.code} est mouvementé : suppression interdite. "
                "Désactivez-le (actif=False) — la comptabilité est append-only."
            )
        return super().delete(*args, **kwargs)


class PieceComptable(models.Model):
    """Une opération = une pièce = n lignes indivisibles.

    Cycle de vie : `BROUILLON → VALIDEE`. Aucun autre statut, aucun retour arrière : une
    pièce validée est immuable et se corrige par CONTREPASSATION (pièce inverse) suivie, le
    cas échéant, d'une pièce rectificative. Les trois pièces restent liées.
    """

    class Statut(models.TextChoices):
        BROUILLON = "BROUILLON", "Brouillon"
        VALIDEE = "VALIDEE", "Validée"

    reference = models.CharField(max_length=64, unique=True, db_index=True)
    date_operation = models.DateField(db_index=True)
    journal = models.CharField(max_length=3, choices=Journal.choices)
    libelle = models.CharField(max_length=255, blank=True)
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.BROUILLON)

    evenement = models.CharField(
        max_length=16, blank=True, db_index=True,
        help_text="Code du schéma du catalogue (B1…B16). Vide = opération diverse (OD).",
    )

    # --- Traçabilité de la correction (les trois pièces liées) ------------------------
    piece_contrepassee = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT,
        related_name="contrepassations",
        help_text="Renseigné sur la pièce INVERSE : désigne la pièce qu'elle annule.",
    )
    piece_rectifiee = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT,
        related_name="rectifications",
        help_text="Renseigné sur la pièce CORRIGÉE : désigne la pièce d'origine erronée.",
    )
    motif = models.TextField(blank=True)

    # --- Gouvernance du change --------------------------------------------------------
    taux_change = models.ForeignKey(
        "accounting.TauxChange", null=True, blank=True, on_delete=models.PROTECT,
        related_name="pieces",
        help_text="Taux journalisé — OBLIGATOIRE dès qu'une pièce porte plusieurs devises.",
    )

    # --- Lien vers l'événement métier d'origine ---------------------------------------
    origine_type = models.CharField(max_length=64, blank=True)
    origine_id = models.CharField(max_length=64, blank=True)

    cree_par = models.CharField(max_length=255, blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)
    valide_par = models.CharField(max_length=255, blank=True)
    valide_le = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date_operation", "-cree_le"]
        verbose_name = "pièce comptable"
        verbose_name_plural = "pièces comptables"
        indexes = [models.Index(fields=["statut", "date_operation"])]

    def __str__(self) -> str:
        return f"{self.reference} [{self.journal}] {self.date_operation} ({self.statut})"

    @property
    def est_validee(self) -> bool:
        return self.statut == self.Statut.VALIDEE

    def save(self, *args, **kwargs):
        """Garde d'append-only : une pièce déjà `VALIDEE` en base ne se ré-enregistre pas."""
        if self.pk:
            ancien = PieceComptable.objects.filter(pk=self.pk).values_list("statut", flat=True).first()
            if ancien == self.Statut.VALIDEE:
                raise ValidationFailed(
                    f"La pièce {self.reference} est validée : elle est immuable. "
                    "Utilisez la contrepassation (services.contrepasser_piece)."
                )
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationFailed(
            "DELETE n'existe pas en comptabilité : contrepassez la pièce "
            f"{self.reference} (services.contrepasser_piece)."
        )


class LigneEcriture(models.Model):
    """Une ligne porte SA devise — aucune agrégation multi-devises implicite n'est possible."""

    piece = models.ForeignKey(PieceComptable, on_delete=models.PROTECT, related_name="lignes")
    compte = models.ForeignKey(CompteComptable, on_delete=models.PROTECT, related_name="lignes")
    devise = models.CharField(max_length=3, choices=Devise.choices)
    debit = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0.00"))
    credit = models.DecimalField(max_digits=20, decimal_places=2, default=Decimal("0.00"))
    libelle = models.CharField(max_length=255, blank=True)
    ordre = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["piece_id", "ordre", "id"]
        verbose_name = "ligne d'écriture"
        verbose_name_plural = "lignes d'écriture"
        constraints = [
            models.CheckConstraint(condition=Q(debit__gte=0), name="acc_ligne_debit_positif"),
            models.CheckConstraint(condition=Q(credit__gte=0), name="acc_ligne_credit_positif"),
            models.CheckConstraint(
                condition=~(Q(debit__gt=0) & Q(credit__gt=0)),
                name="acc_ligne_pas_debit_et_credit",
            ),
            models.CheckConstraint(
                condition=Q(debit__gt=0) | Q(credit__gt=0),
                name="acc_ligne_non_nulle",
            ),
        ]
        indexes = [models.Index(fields=["compte", "devise"])]

    def __str__(self) -> str:
        return f"{self.compte_id} {self.devise} D:{self.debit} C:{self.credit}"

    @property
    def montant_signe(self) -> Decimal:
        return self.debit - self.credit

    def save(self, *args, **kwargs):
        if self.piece_id:
            statut = (
                PieceComptable.objects.filter(pk=self.piece_id)
                .values_list("statut", flat=True).first()
            )
            if statut == PieceComptable.Statut.VALIDEE:
                raise ValidationFailed(
                    "Impossible d'ajouter ou de modifier une ligne sur une pièce validée."
                )
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationFailed(
            "DELETE n'existe pas sur une ligne d'écriture : contrepassez la pièce."
        )


class TauxChange(models.Model):
    """Taux de change gouverné : un taux par jour ET par usage, historisé, source tracée.

    Convention : `taux` = nombre d'unités de `devise_contre` pour 1 unité de `devise_base`
    (ex. base=USD, contre=FC, taux=2800 → 1 USD = 2 800 FC).
    """

    class Usage(models.TextChoices):
        OPERATIONNEL = "OPERATIONNEL", "Opérationnel (transactions du jour)"
        CLOTURE = "CLOTURE", "Clôture (arrêté comptable)"

    class Source(models.TextChoices):
        BCC = "BCC", "Banque Centrale du Congo"
        INTERNE = "INTERNE", "Décision interne"
        MARCHE = "MARCHE", "Marché parallèle constaté"

    date_taux = models.DateField(db_index=True)
    usage = models.CharField(max_length=16, choices=Usage.choices)
    devise_base = models.CharField(max_length=3, choices=Devise.choices, default=Devise.USD)
    devise_contre = models.CharField(max_length=3, choices=Devise.choices, default=Devise.FC)
    taux = models.DecimalField(max_digits=18, decimal_places=6)

    source = models.CharField(max_length=16, choices=Source.choices, default=Source.BCC)
    source_reference = models.CharField(max_length=255, blank=True)

    saisi_par = models.CharField(max_length=255, blank=True)
    valide_par = models.CharField(max_length=255, blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date_taux", "usage"]
        verbose_name = "taux de change"
        verbose_name_plural = "taux de change"
        constraints = [
            models.UniqueConstraint(
                fields=["date_taux", "usage", "devise_base", "devise_contre"],
                name="acc_taux_unique_par_jour_et_usage",
            ),
            models.CheckConstraint(condition=Q(taux__gt=0), name="acc_taux_strictement_positif"),
            models.CheckConstraint(
                condition=~Q(devise_base=models.F("devise_contre")),
                name="acc_taux_devises_distinctes",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date_taux} {self.usage} 1 {self.devise_base} = {self.taux} {self.devise_contre}"


class EventEntryTemplate(models.Model):
    """Schéma d'écriture du catalogue (annexe B, B1→B16) — EN BASE, jamais en code.

    Le code exécute (`catalogue.construire_lignes`), le paramétrage décide.
    """

    code = models.CharField(max_length=16, unique=True, db_index=True)
    libelle = models.CharField(max_length=255)
    journal = models.CharField(max_length=3, choices=Journal.choices)
    description = models.TextField(blank=True)
    actif = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "schéma d'écriture"
        verbose_name_plural = "schémas d'écriture"

    def __str__(self) -> str:
        return f"{self.code} — {self.libelle}"


class EventEntryTemplateLine(models.Model):
    """Une ligne de schéma. Résolution à l'exécution :

    * `compte_racine` littéral (« 413 ») → résolu en 413FC/413USD selon la devise de la ligne ;
    * `compte_racine` commençant par « $ » → placeholder fourni par l'appelant
      (`$TRESORERIE`, `$CANTONNEMENT`) car l'annexe laisse le choix (501/511/53x) ;
    * `devise_regle` dit QUELLE devise s'applique (celle de l'opération, de la source ou de
      la cible d'un change, ou une devise fixe) ;
    * `montant_ref` est la clé du montant dans le contexte de l'événement ;
    * `condition` restreint la ligne à une variante (B16 : GAIN ou PERTE).
    """

    class Sens(models.TextChoices):
        DEBIT = "DEBIT", "Débit"
        CREDIT = "CREDIT", "Crédit"

    class DeviseRegle(models.TextChoices):
        OPERATION = "OPERATION", "Devise de l'opération"
        SOURCE = "SOURCE", "Devise source (change)"
        CIBLE = "CIBLE", "Devise cible (change)"
        FC = "FC", "Toujours FC"
        USD = "USD", "Toujours USD"

    template = models.ForeignKey(
        EventEntryTemplate, on_delete=models.CASCADE, related_name="lignes",
    )
    sens = models.CharField(max_length=6, choices=Sens.choices)
    compte_racine = models.CharField(max_length=32)
    devise_regle = models.CharField(
        max_length=12, choices=DeviseRegle.choices, default=DeviseRegle.OPERATION,
    )
    montant_ref = models.CharField(max_length=48)
    condition = models.CharField(
        max_length=16, blank=True,
        help_text="Vide = ligne toujours produite. Sinon, produite si la condition est active.",
    )
    libelle = models.CharField(max_length=255, blank=True)
    ordre = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["template_id", "ordre", "id"]
        verbose_name = "ligne de schéma"
        verbose_name_plural = "lignes de schéma"
        constraints = [
            models.UniqueConstraint(
                fields=["template", "ordre"], name="acc_template_ordre_unique",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.template_id} {self.ordre} {self.sens} {self.compte_racine}"
