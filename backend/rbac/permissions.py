"""Vérification de capacité (RBAC) — lit `ROLE_REGISTRY` plutôt qu'un champ booléen figé
(`is_staff_role`) pour retrouver la granularité voulue par `Users.jsx` sans introduire de
`Group`/`Permission` Django."""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from .role_registry import get_role


def HasCapability(capability: str):
    class _HasCapability(BasePermission):
        message = f"Capacité requise : {capability}."

        def has_permission(self, request, view) -> bool:
            user = getattr(request, "user", None)
            if not user or not getattr(user, "is_authenticated", False):
                return False
            # Un profil suspendu perd immédiatement TOUTE capacité, y compris "read" —
            # sans ça, "Suspendre" un utilisateur (Users.jsx) ne bloquerait rien réellement.
            profile = getattr(user, "staff_profile", None)
            if profile is not None and profile.locked:
                return False
            role = get_role(getattr(user, "role", ""))
            return bool(getattr(role, capability, False))

    return _HasCapability
