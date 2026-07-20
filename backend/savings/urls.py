from django.urls import path

from . import views

urlpatterns = [
    path("plans/mine", views.my_plans),
    path("plans/<int:plan_id>/deposit", views.plan_deposit),
    path("plans", views.all_plans),
    path("groups", views.groups),
    path("groups/mine", views.my_groups),
    path("groups/<int:group_id>", views.group_detail),
    path("groups/<int:group_id>/requests", views.group_integration_requests),
    path("groups/<int:group_id>/requests/join", views.request_group_integration),
    path("groups/requests/<int:request_id>/decide", views.decide_group_integration),
    path("requests/mine", views.my_group_requests),
    path("requests", views.all_group_requests),
]
