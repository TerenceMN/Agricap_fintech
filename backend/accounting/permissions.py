"""Gardes d'accès de l'API comptable.

Deux règles, posées ici une fois pour toutes plutôt que répétées dans chaque vue :

1. **La comptabilité n'a pas de vue client.** `HasCapability("read")` ne suffit PAS à
   protéger le grand livre : dans `rbac.role_registry`, les rôles de type « Client »
   (`client`, `agri_op`, `invest`, `partner`) portent `read=True`. Sans un garde `IsStaff`
   cumulé, un investisseur lirait les écritures de l'institution (principe 7 de MKOPO —
   anti-gaming, et principe 7 de HAZINA — asymétrie maîtrisée).

2. **Une vue multi-méthodes n'a pas une seule permission.** `GET /taux` est de la lecture,
   `POST /taux` est un acte. `CapaciteSelonMethode` rend la matrice explicite dans la
   déclaration de la vue, au lieu de la cacher dans un `if request.method` du corps —
   « toute vue sans permission explicite est un bug » (CLAUDE.md §5).
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from accounts.permissions import IsStaff
from rbac.permissions import HasCapability


def CapaciteSelonMethode(**par_methode: str):
    """Fabrique une permission qui exige une capacité DIFFÉRENTE selon la méthode HTTP.

    Usage : `CapaciteSelonMethode(GET="read", POST="create")`. Une méthode absente de la
    table est REFUSÉE — le défaut est fermé, jamais ouvert.
    """
    table = {methode.upper(): capacite for methode, capacite in par_methode.items()}

    class _CapaciteSelonMethode(BasePermission):
        message = "Capacité insuffisante pour cette méthode."

        def has_permission(self, request, view) -> bool:
            capacite = table.get((request.method or "").upper())
            if capacite is None:
                return False
            self.message = f"Capacité requise : {capacite}."
            return HasCapability(capacite)().has_permission(request, view)

    return _CapaciteSelonMethode


#: Combinaisons prêtes à l'emploi (toujours cumulées avec `IsStaff`).
LIRE = [IsStaff, HasCapability("read")]
SAISIR = [IsStaff, HasCapability("create")]
VALIDER = [IsStaff, HasCapability("validate")]
PARAMETRER = [IsStaff, HasCapability("config")]
