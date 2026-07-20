"""
Couche générique d'ingestion — le système s'ADAPTE à n'importe quel fichier de
données : chaque feuille devient une table (DataTable), chaque en-tête une colonne
(DataColumn), chaque ligne un enregistrement (DataRecord). Aucune migration n'est
nécessaire quand un nouveau fichier a d'autres tables/colonnes.

Enregistrement MANUEL : à l'upload le fichier est seulement stocké + un aperçu est
calculé (statut STAGED, aucune ligne écrite). L'admin déclenche ensuite « Enregistrer »
(commit) pour écrire les tables/colonnes/lignes ET, si c'est un référentiel, alimenter
les tables typées que le moteur lit (hybride).

Historique : réuploader un fichier de même nom = nouvelle révision COURANTE ; les
révisions précédentes sont conservées (is_current=False) pour l'historique.
"""
from __future__ import annotations

from django.db import models

KIND_REFERENTIEL = "REFERENTIEL"
KIND_SIMULATEUR = "SIMULATEUR"
KIND_ANNEXE = "ANNEXE"
KIND_AUTRE = "AUTRE"
KIND_CHOICES = [(k, k) for k in (KIND_REFERENTIEL, KIND_SIMULATEUR, KIND_ANNEXE, KIND_AUTRE)]

STATUS_STAGED = "STAGED"        # uploadé, analysé, PAS encore enregistré
STATUS_COMMITTED = "COMMITTED"  # enregistré manuellement en base
STATUS_CHOICES = [(s, s) for s in (STATUS_STAGED, STATUS_COMMITTED)]


class DataSource(models.Model):
    """
    Un classeur téléversé. Le fichier est conservé ; les lignes ne sont écrites qu'au
    commit (manuel). Le versionnage se fait par nom de fichier : `dataset_key`.
    """
    file = models.FileField(upload_to="datasources/")
    original_name = models.CharField(max_length=255)
    dataset_key = models.CharField(max_length=255, db_index=True)  # clé logique (nom normalisé)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_AUTRE)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_STAGED)

    # Versionnage / historique.
    revision = models.IntegerField(default=1)
    is_current = models.BooleanField(default=False)  # devient True au commit
    supersedes = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="superseded_by"
    )

    uploaded_by = models.CharField(max_length=255, blank=True)   # sub IdP
    uploaded_at = models.DateTimeField(auto_now_add=True)
    committed_at = models.DateTimeField(null=True, blank=True)
    committed_by = models.CharField(max_length=255, blank=True)

    # Aperçu calculé à l'upload (feuilles, en-têtes, échantillon) — sans écrire de lignes.
    preview = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self) -> str:
        return f"{self.original_name} r{self.revision} [{self.status}]"


class DataTable(models.Model):
    """Une table découverte (= une feuille). Créée au commit."""
    source = models.ForeignKey(DataSource, on_delete=models.CASCADE, related_name="tables")
    name = models.CharField(max_length=200)          # nom de la feuille
    position = models.IntegerField(default=0)
    n_rows = models.IntegerField(default=0)
    n_cols = models.IntegerField(default=0)

    class Meta:
        ordering = ["position"]
        unique_together = ("source", "name")

    def __str__(self) -> str:
        return self.name


class DataColumn(models.Model):
    """Une colonne découverte (= un en-tête). Le type est inféré des valeurs."""
    TEXT, NUMBER, PERCENT, RANGE, DATE = "text", "number", "percent", "range", "date"
    table = models.ForeignKey(DataTable, on_delete=models.CASCADE, related_name="columns")
    name = models.CharField(max_length=255)
    position = models.IntegerField(default=0)
    dtype = models.CharField(max_length=12, default=TEXT)

    class Meta:
        ordering = ["position"]

    def __str__(self) -> str:
        return f"{self.name} ({self.dtype})"


class DataRecord(models.Model):
    """Une ligne, valeurs indexées par nom de colonne (flexible)."""
    table = models.ForeignKey(DataTable, on_delete=models.CASCADE, related_name="records")
    row_index = models.IntegerField()
    values = models.JSONField(default=dict)

    class Meta:
        ordering = ["row_index"]
        indexes = [models.Index(fields=["table", "row_index"])]
