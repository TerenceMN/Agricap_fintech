from django.urls import path

from . import views

urlpatterns = [
    path("sources", views.sources),
    path("sources/<int:pk>", views.source_detail),
    path("sources/<int:pk>/commit", views.commit_source),
    path("sources/<int:pk>/tables", views.source_tables),
    path("tables/<int:pk>", views.table_detail),
    path("tables/<int:pk>/records", views.update_table_records),
    path("history", views.history),
]
