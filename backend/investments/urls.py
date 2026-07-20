from django.urls import path

from . import views

urlpatterns = [
    path("projects", views.projects),
    path("projects/<str:code>", views.project_detail),
    path("projects/<str:code>/action", views.project_action),
    path("projects/<str:code>/technical-analysis", views.project_technical_analysis),
    path("projects/<str:code>/financial-analysis", views.project_financial_analysis),
    path("offers", views.offers),
    path("offers/open", views.offers_open),
    path("offers/<int:offer_id>/collateral", views.offer_collateral),
    path("investors", views.investors),
    path("investors/me", views.my_investor_profile),
    path("investors/<int:investor_id>/action", views.investor_action),
    path("subscriptions", views.subscriptions),
    path("subscriptions/mine", views.my_subscriptions),
    path("movements", views.movements),
    path("schedules", views.schedules),
    path("sub-portfolios", views.sub_portfolios),
    path("observations", views.observations),
    path("questions", views.questions),
    path("questions/<int:question_id>/answer", views.question_answer),
    path("performance-reports", views.performance_reports),
    path("obligations", views.obligations),
    path("obligations/<int:position_id>/withdraw", views.obligation_withdraw),
    path("obligations/<int:position_id>/convert", views.obligation_convert),
    path("obligations/<int:position_id>/withdrawals", views.obligation_withdrawals),
    path("obligations/<int:position_id>/conversions", views.obligation_conversions),
    path("secondary-market", views.secondary_market),
    path("dashboard-metrics", views.dashboard_metrics),
    path("portfolio-allocation", views.my_portfolio_allocation),
]
