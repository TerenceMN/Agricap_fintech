from django.urls import path

from . import views

urlpatterns = [
    path("overview", views.overview),
    path("compliance-score", views.compliance_score),
]
