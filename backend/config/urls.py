"""Routage central de l'API AGRICAP FINTECH."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from accounts import views as accounts_views
from common import views as common_views


def health(_request):
    from django.http import JsonResponse
    return JsonResponse({"status": "ok", "service": "agricap-fintech-backend"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health", health),
    path("api/sms/test", common_views.sms_test),
    path("api/me", accounts_views.me),
    path("api/portfolio/", include("portfolio.urls")),
    path("api/dataio/", include("dataio.urls")),
    path("api/referentiel/", include("referentiel.urls")),
    path("api/audit/", include("audit.urls")),
    path("api/rbac/", include("rbac.urls")),
    path("api/agencies/", include("agencies.urls")),
    path("api/caisses/", include("caisses.urls")),
    path("api/ledger/", include("ledger.urls")),
    # Socle comptable bi-monnaie natif (devise portée par la LIGNE, annexes A/B/E) —
    # distinct de `ledger` (SYSCOHADA, devise portée par la pièce), qui reste branché.
    path("api/accounting/", include("accounting.urls")),
    path("api/fx/", include("fx.urls")),
    path("api/transactions/", include("transactions.urls")),
    path("api/investments/", include("investments.urls")),
    path("api/savings/", include("savings.urls")),
    path("api/assets/", include("assets.urls")),
    path("api/contracts/", include("contracts.urls")),
    path("api/suppliers/", include("suppliers.urls")),
    path("api/compliance/", include("compliance.urls")),
    path("api/support/", include("support.urls")),
    path("api/reference-data/", include("reference_data.urls")),
    path("api/credits/", include("credits.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/partners/", include("partners.urls")),
    path("api/analytics/", include("analytics.urls")),
    path("api/alerts/", include("alerts.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
