"""
Permissions DRF déclaratives du module crédit.

Le standard du projet (§5) est explicite : « `permission_classes` déclaratives
sur CHAQUE vue, jamais de contrôle uniquement dans le corps ». Le module crédit
y dérogeait par des helpers appelés en première ligne de vue (`_require_group`),
qui fonctionnent mais laissent la règle invisible depuis la signature de la vue —
et qu'un `return` mal placé suffit à contourner.

Pour la caution solidaire, où le contrôle d'identité EST la garantie juridique,
la règle est portée par une classe de permission : elle s'exécute dans
`initial()`, avant le corps de la vue, et elle est lisible sur le décorateur.
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission


class IsDesignatedGuarantor(BasePermission):
    """Seul le garant désigné agit sur sa propre demande de caution.

    Ni l'agent qui a monté le dossier, ni le demandeur, ni un admin : consentir
    à la place de quelqu'un annulerait exactement ce que le consentement établit.
    C'est la seule permission du module où le rôle ne donne aucun droit.

    La demande est résolue depuis `view.kwargs` — DRF renseigne `self.kwargs`
    avant d'appeler `check_permissions()` dans `initial()`, y compris pour les
    vues fonctionnelles enveloppées par `@api_view`.

    Une demande inexistante laisse passer : c'est à la vue de répondre 404, pas
    à la permission de répondre 403 — sans quoi le code d'erreur renseignerait
    sur l'existence d'une caution qu'on n'a pas le droit de voir.
    """

    message = "Seul le garant désigné peut répondre à cette demande de caution."

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False

        guarantee_id = (getattr(view, "kwargs", None) or {}).get("guarantee_id")
        if guarantee_id is None:
            return False

        from credits.models import CreditGuarantee
        guarantor_id = (
            CreditGuarantee.objects
            .filter(pk=guarantee_id)
            .values_list("guarantor_id", flat=True)
            .first()
        )
        if guarantor_id is None:
            # Inexistante, ou sans garant lié (caution déclarative historique).
            # La vue tranchera en 404 / 403 avec le code métier approprié.
            return True

        return str(guarantor_id) == str(getattr(user, "pk", ""))
