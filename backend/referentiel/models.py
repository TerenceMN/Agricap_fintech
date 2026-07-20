"""
Tables de référence AGRICAP — peuplées automatiquement à l'upload d'un classeur
Excel (PROMPT : accès en lecture au référentiel + config institution).

Côté admin : `import_referentiel` / l'endpoint d'upload écrivent ici.
Côté client : la vérification (contrôles de vraisemblance) LIT ces tables.

NB : le référentiel v3 n'a PAS un schéma uniforme (le végétal parle de « Culture »
et de rendement t/ha, l'élevage de « Spéculation », l'aquaculture d'« Espèce » et de
densité/survie…). On capture donc TOUTES les colonnes dans `columns` (JSON) et on
dérive au mieux les concepts communs (coût, prix, rendement, perte, cycle) par
correspondance sémantique d'en-têtes — sans jamais inventer une valeur absente.
"""
from __future__ import annotations

from django.db import models


class ReferentielVersion(models.Model):
    """Une version du référentiel (traçabilité : `version_referentiel` du JSON §8.3)."""
    label = models.CharField(max_length=120)
    source_filename = models.CharField(max_length=255, blank=True)
    imported_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-imported_at"]

    def __str__(self) -> str:
        return f"{self.label} ({self.imported_at:%Y-%m-%d})"

    @classmethod
    def active(cls) -> "ReferentielVersion | None":
        return cls.objects.filter(is_active=True).order_by("-imported_at").first()


class ReferenceWorkbook(models.Model):
    """Classeur de référence téléversé (fichier source conservé pour audit/relecture)."""
    file = models.FileField(upload_to="referentiels/")
    original_name = models.CharField(max_length=255)
    uploaded_by = models.CharField(max_length=255, blank=True)  # sub IdP
    uploaded_at = models.DateTimeField(auto_now_add=True)
    version = models.ForeignKey(
        ReferentielVersion, null=True, blank=True, on_delete=models.SET_NULL, related_name="workbooks"
    )
    parsed_ok = models.BooleanField(default=False)
    parse_log = models.TextField(blank=True)

    def __str__(self) -> str:
        return self.original_name


class ReferenceRange(models.Model):
    """
    Une ligne du référentiel (une spéculation/culture/espèce d'une chaîne) : plages
    indicatives servant aux contrôles de vraisemblance (PROMPT §4).
    Concepts dérivés (numériques) + `columns` (toutes les colonnes, texte source).
    """
    version = models.ForeignKey(ReferentielVersion, on_delete=models.CASCADE, related_name="ranges")

    chain_code = models.CharField(max_length=2)          # "01".."14"
    chain_slug = models.CharField(max_length=40)
    chain_libelle = models.CharField(max_length=80)

    name = models.CharField(max_length=160)              # 1re colonne (Culture/Spéculation/Espèce/Activité)
    systeme = models.CharField(max_length=160, blank=True)
    cycle_months = models.FloatField(null=True, blank=True)

    # Paramètre technique clé (rendement / production / densité…) — bornes + libellé.
    parametre_cle = models.CharField(max_length=160, blank=True)
    unite = models.CharField(max_length=60, blank=True)
    rendement_min = models.FloatField(null=True, blank=True)
    rendement_max = models.FloatField(null=True, blank=True)

    cout_text = models.CharField(max_length=120, blank=True)
    cout_min = models.FloatField(null=True, blank=True)
    cout_max = models.FloatField(null=True, blank=True)

    prix_text = models.CharField(max_length=120, blank=True)
    prix_min = models.FloatField(null=True, blank=True)
    prix_max = models.FloatField(null=True, blank=True)

    perte_text = models.CharField(max_length=120, blank=True)
    perte_max = models.FloatField(null=True, blank=True)  # fraction 0..1 (mortalité/perte ; survie inversée)

    statut = models.CharField(max_length=60, blank=True)     # « À valider », « Validé »…
    source = models.CharField(max_length=255, blank=True)
    date_maj = models.CharField(max_length=40, blank=True)
    zone = models.CharField(max_length=200, blank=True)
    observations = models.TextField(blank=True)

    columns = models.JSONField(default=dict, blank=True)     # {en-tête: valeur brute} — toutes les colonnes

    class Meta:
        indexes = [models.Index(fields=["version", "chain_code"])]
        ordering = ["chain_code", "name"]

    def __str__(self) -> str:
        return f"[{self.chain_code}] {self.name}"

    @property
    def a_valider(self) -> bool:
        """Statut non validé → garde-fou §9 (décision abaissée)."""
        return "valider" in (self.statut or "").lower()


class InstitutionConfig(models.Model):
    """
    Paramètres de l'institution (PROMPT §8.1 : « jamais codés en dur »), issus de
    la feuille `16_Calibrage_Gouvernance`. Un seul actif à la fois.
    """
    version = models.ForeignKey(
        ReferentielVersion, null=True, blank=True, on_delete=models.SET_NULL, related_name="configs"
    )
    is_active = models.BooleanField(default=True)

    # Seuils prudentiels (feuille 16, section A).
    seuil_dscr = models.FloatField(default=1.20)
    seuil_dscr_stresse = models.FloatField(default=1.00)
    couverture_min = models.FloatField(default=1.00)          # 100 %
    score_global_min = models.FloatField(default=70.0)

    # Pondérations du score (§8.1). Somme attendue = 100.
    poids_technique = models.FloatField(default=25.0)
    poids_financier = models.FloatField(default=20.0)
    poids_stress = models.FloatField(default=10.0)
    poids_comportemental = models.FloatField(default=30.0)
    poids_garanties = models.FloatField(default=15.0)

    # Paramètres crédit.
    taux_interet_annuel = models.FloatField(default=0.24)     # 24 %/an par défaut
    frais_dossier = models.FloatField(default=0.02)           # 2 % du montant
    commissions = models.FloatField(default=0.01)
    duree_max_mois = models.IntegerField(default=24)
    plafond_delegue = models.FloatField(default=25000.0)      # USD
    decote_garantie = models.FloatField(default=0.30)

    # Caution solidaire (SPEC §2.5). Principe 8 : ces seuils gouvernent qui peut
    # engager quoi — ils appartiennent au comité, pas à un déploiement. Lus par
    # `credits.guarantor`, qui logge un warning s'il doit retomber sur ses
    # valeurs de secours.
    caution_ratio_epargne = models.FloatField(default=2.0)        # k : Σ cautions ≤ k × épargne
    caution_max_actives = models.IntegerField(default=3)          # cautions vivantes par garant
    caution_consent_window_hours = models.IntegerField(default=72)  # fenêtre de consentement
    # Décote de la caution morale : elle sécurise socialement, pas financièrement.
    # Distincte de `decote_garantie`, qui s'applique aux actifs gagés.
    decote_caution_morale = models.FloatField(default=0.70)

    # Phase de déploiement (§9 : validation humaine échantillonnée).
    phase_deploiement = models.CharField(max_length=20, default="PHASE_1")  # PHASE_1|2|3

    raw = models.JSONField(default=dict, blank=True)          # lignes brutes feuille 16

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Config institution (DSCR>={self.seuil_dscr}, score>={self.score_global_min})"

    @classmethod
    def active(cls) -> "InstitutionConfig":
        cfg = cls.objects.filter(is_active=True).order_by("-updated_at").first()
        return cfg or cls()  # défauts si aucune importée (jamais None)

    @property
    def taux_echantillon(self) -> float:
        """Fraction de dossiers contre-analysés selon la phase (§9)."""
        return {"PHASE_1": 1.0, "PHASE_2": 0.30, "PHASE_3": 0.10}.get(self.phase_deploiement, 1.0)
