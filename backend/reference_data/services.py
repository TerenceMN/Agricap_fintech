"""
Services métier du module reference_data.
- process_upload : parse + valide le fichier Excel, calcule le diff
- activate_file  : maker-checker, crée les ValueChain, invalide le cache
"""
from __future__ import annotations

import os
import tempfile

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from .models import ReferenceFileUpload, ValueChain
from .validators import validate_value_chains_sheet, ExcelStructureError

CACHE_KEY_ACTIVE = "reference_data:value_chains:active"


def _compute_diff(new_rows: list[dict]) -> dict:
    """Compare les nouvelles lignes (par code) aux ValueChains actuellement actives."""
    active = {
        vc.code: vc
        for vc in ValueChain.objects.filter(
            source_file__status=ReferenceFileUpload.Status.ACTIVE,
            active=True,
        )
    }
    new_codes = {r["code"] for r in new_rows}

    added = [r["code"] for r in new_rows if r["code"] not in active]
    removed = [code for code in active if code not in new_codes]
    modified: list[dict] = []

    for row in new_rows:
        code = row["code"]
        if code not in active:
            continue
        vc = active[code]
        changes = []
        if float(vc.base_rate) != float(row["base_rate"]):
            changes.append(f"taux {vc.base_rate} → {row['base_rate']} %")
        if vc.cycle_months != row["cycle_months"]:
            changes.append(f"cycle {vc.cycle_months} → {row['cycle_months']} mois")
        if vc.min_score_required != row["min_score_required"]:
            changes.append(f"score_min {vc.min_score_required} → {row['min_score_required']}")
        if float(vc.risk_factor) != float(row["risk_factor"]):
            changes.append(f"risk_factor {vc.risk_factor} → {row['risk_factor']}")
        if changes:
            modified.append({"code": code, "label": row["label"], "changes": changes})

    return {
        "added": added,
        "removed": removed,
        "modified": modified,
        "unchanged": len(new_rows) - len(added) - len(modified),
        "totalNew": len(new_rows),
    }


def process_upload(upload: ReferenceFileUpload) -> dict:
    """
    Valide le fichier Excel rattaché à `upload`.
    Met à jour upload.status, upload.validation_report, upload.diff_summary.
    Retourne le résultat de validation (dict).
    """
    if upload.file_type != ReferenceFileUpload.FileType.VALUE_CHAINS:
        upload.status = ReferenceFileUpload.Status.REJECTED
        upload.validation_report = {
            "valid": False,
            "errors": ["Type de fichier non supporté pour la validation automatique."],
        }
        upload.save(update_fields=["status", "validation_report"])
        return upload.validation_report

    # Copier sur disque pour openpyxl (évite les problèmes de curseur Django Storage)
    with upload.file.open("rb") as fh:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(fh.read())
            tmp_path = tmp.name

    try:
        result = validate_value_chains_sheet(tmp_path)
    except ExcelStructureError as exc:
        upload.status = ReferenceFileUpload.Status.REJECTED
        report = {"valid": False, "structureError": str(exc), "errors": [str(exc)], "rows": []}
        upload.validation_report = report
        upload.save(update_fields=["status", "validation_report"])
        return report
    finally:
        os.unlink(tmp_path)

    if not result["valid"]:
        upload.status = ReferenceFileUpload.Status.REJECTED
        upload.validation_report = result
        upload.row_count = len(result.get("rows", []))
        upload.save(update_fields=["status", "validation_report", "row_count"])
        return result

    # Valide → calculer le diff avant activation
    diff = _compute_diff(result["rows"])
    upload.status = ReferenceFileUpload.Status.PENDING_VALIDATION
    upload.validation_report = result
    upload.diff_summary = diff
    upload.row_count = len(result["rows"])
    upload.save(update_fields=["status", "validation_report", "diff_summary", "row_count"])
    return {**result, "diff": diff}


def activate_file(upload: ReferenceFileUpload, activator_sub: str) -> None:
    """
    Maker-checker : archive l'actif courant, crée les nouvelles ValueChains.
    Lève ValueError si les préconditions ne sont pas remplies.
    """
    if upload.status != ReferenceFileUpload.Status.PENDING_VALIDATION:
        raise ValueError(
            f"Ce fichier ne peut pas être activé (statut actuel : {upload.status}). "
            "Seuls les fichiers en statut «pending_validation» peuvent être activés."
        )
    if upload.uploaded_by == activator_sub:
        raise ValueError(
            "Le même utilisateur ne peut pas téléverser ET activer un référentiel "
            "(principe maker-checker : l'activation doit être faite par un second administrateur)."
        )

    parsed_rows = upload.validation_report.get("rows", [])
    if not parsed_rows:
        raise ValueError(
            "Aucune donnée parsée disponible. Re-uploadez le fichier pour régénérer le rapport."
        )

    with transaction.atomic():
        # Archiver l'actif courant du même type
        ReferenceFileUpload.objects.filter(
            file_type=upload.file_type,
            status=ReferenceFileUpload.Status.ACTIVE,
        ).update(status=ReferenceFileUpload.Status.ARCHIVED)

        # Créer les nouvelles ValueChains
        ValueChain.objects.bulk_create([
            ValueChain(source_file=upload, **row)
            for row in parsed_rows
        ])

        # Activer
        upload.status = ReferenceFileUpload.Status.ACTIVE
        upload.activated_by = activator_sub
        upload.activated_at = timezone.now()
        upload.save(update_fields=["status", "activated_by", "activated_at"])

    # Invalider le cache dropdown
    cache.delete(CACHE_KEY_ACTIVE)
