"""Permissions FX — composées à partir de `rbac.permissions.HasCapability` (nomenclature
unique, principe 6) plutôt que réimplémentées.

`GET /api/fx/rates` et `POST /api/fx/rates` partagent une URL (contrat consommé par
`src/services/api.ts`), mais pas la même exigence : lire un taux est un droit de personnel,
en publier un est un acte de configuration institutionnelle. Une permission déclarative
sensible à la méthode évite le contre-modèle « contrôle dans le corps de la vue » proscrit
par CLAUDE.md §5.
"""
from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission

from rbac.permissions import HasCapability


def CapabilityByMethod(*, safe: str = "read", unsafe: str = "config"):
    safe_perm = HasCapability(safe)()
    unsafe_perm = HasCapability(unsafe)()

    class _CapabilityByMethod(BasePermission):
        def has_permission(self, request, view) -> bool:
            if request.method in SAFE_METHODS:
                self.message = f"Capacité requise : {safe}."
                return safe_perm.has_permission(request, view)
            self.message = f"Capacité requise : {unsafe}."
            return unsafe_perm.has_permission(request, view)

    return _CapabilityByMethod
