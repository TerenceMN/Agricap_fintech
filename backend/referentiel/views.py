"""API référentiel : exposer les plages (transparence, PROMPT §6) et les versions."""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .chains import CHAINS
from .models import InstitutionConfig, ReferenceRange, ReferentielVersion


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def ranges(request):
    """Plages de la version active, filtrables par ?chain=09."""
    version = ReferentielVersion.active()
    if not version:
        return Response({"version": None, "ranges": []})
    qs = ReferenceRange.objects.filter(version=version)
    chain = request.GET.get("chain")
    if chain:
        qs = qs.filter(chain_code=chain)
    return Response({
        "version": version.label,
        "ranges": [{
            "chain_code": r.chain_code, "chain_libelle": r.chain_libelle, "name": r.name,
            "systeme": r.systeme, "unite": r.unite, "cycle_months": r.cycle_months,
            "parametre_cle": r.parametre_cle, "rendement": [r.rendement_min, r.rendement_max],
            "cout": [r.cout_min, r.cout_max], "prix": [r.prix_min, r.prix_max],
            "perte_max": r.perte_max, "statut": r.statut, "a_valider": r.a_valider,
        } for r in qs],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chains(request):
    """Les 14 chaînes de valeur (référence indicative AGRICAP)."""
    return Response([{"code": c.code, "libelle": c.libelle, "specialite": c.specialite} for c in CHAINS])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def config(request):
    """Configuration institution active (seuils/pondérations, §8.1)."""
    c = InstitutionConfig.active()
    return Response({
        "seuil_dscr": c.seuil_dscr, "seuil_dscr_stresse": c.seuil_dscr_stresse,
        "couverture_min": c.couverture_min, "score_global_min": c.score_global_min,
        "poids": {"technique": c.poids_technique, "financier": c.poids_financier,
                  "stress": c.poids_stress, "comportemental": c.poids_comportemental,
                  "garanties": c.poids_garanties},
        "taux_interet_annuel": c.taux_interet_annuel, "plafond_delegue": c.plafond_delegue,
        "phase_deploiement": c.phase_deploiement,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def versions(request):
    """Historique des versions du référentiel typé."""
    return Response([{
        "id": v.id, "label": v.label, "imported_at": v.imported_at, "is_active": v.is_active,
        "n_ranges": v.ranges.count(),
    } for v in ReferentielVersion.objects.all()])
