from django.urls import path

from . import views

urlpatterns = [
    path("rates", views.rates),
    path("rates/current", views.current),
    path("rates/sync-bcc", views.sync_bcc),
    path("convert", views.convert),
]
