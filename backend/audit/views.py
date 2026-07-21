"""API de lecture du journal d'audit (`AuditLog.jsx`, `AuditJournal.tsx`) — réservée au
personnel disposant de la capacité `audit`. LECTURE SEULE ABSOLUE : aucune écriture n'est
possible depuis cet écran (c'est l'écran de l'auditeur)."""
from __future__ import annotations

from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from rbac.permissions import HasCapability

from .models import AuditEntry

#: Plafond de lignes renvoyées (aligné sur `AUDIT_ROWS_CAP` du front). Au-delà, `totalRows`
#: signale la troncature pour que l'auditeur affine ses filtres plutôt que de croire tout voir.
ROWS_CAP = 500

# Préfixes d'action = opérations financières/métier réellement effectuées sur la
# plateforme (Supervision.jsx « Activités Récentes ») — PAR OPPOSITION à `agency.*`/
# `rbac.*`, qui sont des actions de configuration/administration système, pas des
# opérations d'AGRICAP FINTECH à superviser financièrement. Liste blanche délibérée (pas
# une exclusion) : un futur type d'action système ne fuite pas silencieusement dans ce
# flux tant qu'il n'est pas explicitement ajouté ici.
FINANCIAL_ACTION_PREFIXES = (
    "transaction.", "investments.", "portfolio.", "caisses.", "savings.",
    "contract.", "fx.", "ledger.", "kyc.", "assets.",
)


def _row(e: AuditEntry, names_by_sub: dict[str, str]) -> dict:
    return {
        "id": e.id,
        "timestamp": e.created_at.isoformat(),
        "user": e.actor,
        "userName": names_by_sub.get(e.actor, e.actor or "Système"),
        "role": e.actor_role,
        "action": e.action,
        "entityType": e.entity_type,
        "entityId": e.entity_id,
        "details": e.details,
        "ip": e.ip_address,
    }


def _apply_filters(qs, params):
    """Applique les filtres de lecture. Tous optionnels, tous additifs — aucun n'écrit rien.

    Filtres du contrat (§4) : `dossier`, `acteur`, `etape`, `depuis`, `jusqu`.
    Filtres historiques conservés : `entity_type`, `entity_id`, `actor`, `category`.
    """
    entity_type = params.get("entity_type")
    entity_id = params.get("entity_id")
    # `acteur` (contrat) ou `actor` (historique) — même cible : le sub de l'acteur.
    actor = params.get("acteur") or params.get("actor")
    category = params.get("category")
    # Le code du dossier de crédit vit dans `details.applicationCode` (clé canonique posée
    # par `credits.analyse`/`credits.guarantees`) — jamais dans une colonne dédiée.
    dossier = params.get("dossier")
    # L'« étape » d'instruction = le nom d'action (workflow). Sous-chaîne : « analyse »
    # attrape `credits.analyse.execute` et `credits.analyse.justifier`.
    etape = params.get("etape")
    depuis = params.get("depuis")
    jusqu = params.get("jusqu")

    if entity_type:
        qs = qs.filter(entity_type=entity_type)
    if entity_id:
        qs = qs.filter(entity_id=entity_id)
    if actor:
        qs = qs.filter(actor=actor)
    if dossier:
        qs = qs.filter(Q(details__applicationCode=dossier) | Q(details__reference=dossier))
    if etape:
        qs = qs.filter(action__icontains=etape)
    if category == "financial":
        prefix_filter = Q()
        for prefix in FINANCIAL_ACTION_PREFIXES:
            prefix_filter |= Q(action__startswith=prefix)
        qs = qs.filter(prefix_filter)

    if depuis:
        dt = parse_datetime(depuis)
        if dt is not None:
            qs = qs.filter(created_at__gte=dt)
        else:
            d = parse_date(depuis)
            if d is not None:
                qs = qs.filter(created_at__date__gte=d)
    if jusqu:
        dt = parse_datetime(jusqu)
        if dt is not None:
            qs = qs.filter(created_at__lte=dt)
        else:
            d = parse_date(jusqu)
            if d is not None:
                # Borne haute inclusive du jour entier.
                qs = qs.filter(created_at__date__lte=d)
    return qs


@api_view(["GET"])
@permission_classes([HasCapability("audit")])
def entries(request):
    qs = _apply_filters(AuditEntry.objects.all(), request.GET)

    total = qs.count()
    rows = list(qs[:ROWS_CAP])
    truncated = total > ROWS_CAP

    # Résolution `sub` -> nom lisible en un seul aller-retour (pas de FK AuditEntry ->
    # FintechUser : l'acteur d'une action système peut être vide/inexistant, une FK stricte
    # casserait l'écriture de l'entrée d'audit elle-même).
    from accounts.models import FintechUser
    actors = {e.actor for e in rows if e.actor}
    names_by_sub = {
        u.sub: (u.full_name or u.email)
        for u in FintechUser.objects.filter(sub__in=actors)
    }
    data = [_row(e, names_by_sub) for e in rows]

    # `totalRows` / troncature (contrat §4). Rétro-compatibilité : la réponse reste une
    # LISTE nue par défaut (les consommateurs existants — Dashboard, Supervision, Users,
    # Transactions… — la lisent comme un tableau). Le total est TOUJOURS exposé en en-tête ;
    # `?meta=1` le renvoie aussi dans le corps pour l'écran auditeur qui l'affiche.
    if request.GET.get("meta") in ("1", "true", "yes"):
        response = Response({
            "entries": data,
            "totalRows": total,
            "returned": len(data),
            "truncated": truncated,
            "cap": ROWS_CAP,
        })
    else:
        response = Response(data)
    response["X-Total-Rows"] = str(total)
    response["X-Truncated"] = "1" if truncated else "0"
    return response
