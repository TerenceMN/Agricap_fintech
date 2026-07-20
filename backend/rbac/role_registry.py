"""Source de vérité unique des 16 rôles métier AGRICAP (+ rôles historiques admin/manager/
client déjà utilisés par `accounts.FintechUser.role`) et de leur matrice de capacités.

Le mock frontend (`src/pages/Users.jsx` `ROLES`/`PERMISSIONS_MATRIX`) ne définissait que 5
lignes sur 16 (commentaire "... others mapped similarly in real app") — ce module devient
la référence que le frontend consomme désormais via `GET /api/rbac/roles`, plutôt que de
la coder en dur.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoleDef:
    id: str
    label: str
    level: int
    type: str
    read: bool = False
    create: bool = False
    validate: bool = False
    disburse: bool = False
    audit: bool = False
    config: bool = False
    is_supervisor: bool = False
    mfa_step_up_required: bool = False


_ROLES = [
    RoleDef("dg", "Directeur Général", 1, "Direction",
            read=True, create=True, validate=True, disburse=True, audit=True, config=True,
            is_supervisor=True, mfa_step_up_required=True),
    RoleDef("dir_ops", "Directeur Opérations", 1, "Direction",
            read=True, create=True, validate=True, disburse=True, audit=True,
            is_supervisor=True, mfa_step_up_required=True),
    RoleDef("aud_tech", "Auditeur Technique", 2, "Audit",
            read=True, audit=True, is_supervisor=True, mfa_step_up_required=True),
    RoleDef("aud_fin", "Auditeur Financier", 2, "Audit",
            read=True, audit=True, is_supervisor=True, mfa_step_up_required=True),
    RoleDef("gest_credit", "Gestionnaire Crédits", 3, "Gestion",
            read=True, create=True, validate=True),
    RoleDef("gest_port", "Gestionnaire Portefeuille", 3, "Gestion",
            read=True, create=True, validate=True),
    RoleDef("gest_agents", "Gestionnaire Agents", 4, "Opérations",
            read=True, create=True),
    RoleDef("gest_zone", "Gestionnaire Zones", 4, "Opérations",
            read=True, create=True, validate=True),
    RoleDef("gest_caisse", "Gestionnaire Caisses", 4, "Opérations",
            read=True, create=True, validate=True, disburse=True),
    RoleDef("agent_terrain", "Agent Terrain", 5, "Terrain",
            read=True, create=True),
    RoleDef("agent_cash", "Agent Cash Express", 5, "Terrain",
            read=True, create=True, disburse=True),
    RoleDef("agri_op", "Opérateur Agricole", 0, "Client",
            read=True),
    RoleDef("invest", "Investisseur", 0, "Client",
            read=True, create=True),
    RoleDef("risk_analyst", "Analyste Risque", 0, "Support",
            read=True, audit=True),
    RoleDef("compliance", "Responsable Compliance", 0, "Support",
            read=True, validate=True, audit=True),
    RoleDef("support", "Support Client", 0, "Support",
            read=True, create=True),
    RoleDef("admin_it", "Admin IT", 0, "IT",
            read=True, validate=True, config=True),
    # Rôles historiques (déjà en usage sur accounts.FintechUser.role ET déjà seedés côté
    # IdP avant l'introduction de la hiérarchie à 16 rôles) — conservés pour compatibilité,
    # hors hiérarchie 16-rôles. Sans ces lignes, un utilisateur IdP déjà taggé
    # role="investor"/"partner" tomberait silencieusement sur le fallback "client"
    # (read-only) dans get_role().
    RoleDef("admin", "Administrateur (legacy)", 1, "Direction",
            read=True, create=True, validate=True, disburse=True, audit=True, config=True,
            is_supervisor=True),
    RoleDef("manager", "Manager (legacy)", 3, "Gestion",
            read=True, create=True, validate=True),
    RoleDef("client", "Client", 0, "Client", read=True),
    RoleDef("investor", "Investisseur (legacy)", 0, "Client", read=True, create=True),
    RoleDef("partner", "Partenaire / Fournisseur (legacy)", 0, "Client", read=True),
]

ROLE_REGISTRY: dict[str, RoleDef] = {r.id: r for r in _ROLES}

CAPABILITIES = ("read", "create", "validate", "disburse", "audit", "config")


def get_role(role_id: str) -> RoleDef:
    """Un `rbac.models.RoleOverride` (édité depuis Roles.jsx) remplace entièrement la
    définition d'usine pour ce `role_id` s'il en existe un — même interface par attribut
    que `RoleDef`, donc transparent pour tous les appelants existants (permissions, ABAC,
    serializers). Import différé : `role_registry` doit rester chargeable sans app Django
    prête (import à froid), seul l'appel (toujours en cours de requête) touche la DB."""
    from .models import RoleOverride
    override = RoleOverride.objects.filter(id=role_id).first()
    if override is not None:
        return override
    return ROLE_REGISTRY.get(role_id) or ROLE_REGISTRY["client"]
