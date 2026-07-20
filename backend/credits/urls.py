from django.urls import path
from credits import views

urlpatterns = [
    # Tableau de bord (Étape 7)
    path("dashboard/", views.credits_dashboard),
    # Préremplissage & utilitaires
    path("application/prefill/", views.prefill_application),
    path("needs-sheet/parse/", views.parse_needs_sheet_view),
    path("needs-sheet-template/", views.download_needs_sheet_template),
    path("simulate/", views.simulate_scoring),
    # Liste & détail
    path("applications/", views.list_applications),
    path("applications/<str:code>/", views.application_detail),
    # Scoring
    path("applications/<str:code>/score/", views.score_application),
    # Machine à états (Étape 5)
    path("applications/<str:code>/submit/", views.submit_application),
    path("applications/<str:code>/start-analysis/", views.start_analysis),
    path("applications/<str:code>/approve/", views.approve_application),
    path("applications/<str:code>/reject/", views.reject_application),
    path("applications/<str:code>/adjourn/", views.adjourn_application),
    path("applications/<str:code>/reopen-analysis/", views.reopen_analysis),
    path("applications/<str:code>/client-consent/", views.client_consent),
    # Décaissement (Étape 6)
    path("applications/<str:code>/disbursement/", views.disbursement_detail),
    path("applications/<str:code>/disbursement/request/", views.request_disbursement_view),
    path("applications/<str:code>/disbursement/confirm/", views.confirm_disbursement_view),
    path("applications/<str:code>/disbursement/cancel/", views.cancel_disbursement_view),
    # Demandes de caution — surface du GARANT, pas du dossier (SPEC §2.5).
    # Volontairement hors de `applications/<code>/` : le garant n'a pas accès au
    # dossier, il a accès à SON engagement.
    path("guarantee-requests/", views.list_guarantee_requests),
    path("guarantee-requests/<int:guarantee_id>/consent/", views.consent_guarantee_request),
    # Garanties (Étape 4)
    path("applications/<str:code>/guarantees/", views.list_guarantees),
    path("applications/<str:code>/guarantees/savings/", views.place_savings_guarantee),
    path("applications/<str:code>/guarantees/moral/", views.register_moral_guarantee),
    path("applications/<str:code>/guarantees/asset/", views.place_asset_guarantee_view),
    path("applications/<str:code>/guarantees/<int:guarantee_id>/confirm/", views.confirm_guarantee),
    path("applications/<str:code>/guarantees/<int:guarantee_id>/release/", views.release_guarantee),
    # Analyse documentaire (Partie H)
    path("applications/<str:code>/analysis-report/", views.analysis_report),
]
