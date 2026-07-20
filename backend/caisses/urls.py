from django.urls import path

from . import views

urlpatterns = [
    path("accounts", views.accounts),
    path("accounts/<str:code>", views.account_detail),
    path("accounts/<str:code>/action", views.account_action),
    path("accounts/<str:code>/register-sessions", views.account_register_sessions),
    path("wallets/mine", views.my_wallets),
    path("wallets/mine/deposit", views.my_deposit),
    path("wallets/mine/withdraw", views.my_withdraw),
    path("wallets/mine/convert", views.my_convert),
    path("wallets/mine/movements", views.my_movements),
    path("wallets/mine/withdrawal-requests", views.my_withdrawal_requests),
    path("wallets/for-user/<str:sub>", views.wallet_for_user),
    path("withdrawal-requests", views.withdrawal_requests),
    path("withdrawal-requests/<int:request_id>/approve", views.withdrawal_request_approve),
    path("withdrawal-requests/<int:request_id>/reject", views.withdrawal_request_reject),
    path("withdrawal-requests/<int:request_id>/otp", views.withdrawal_otp_request),
    path("withdrawal-requests/<int:request_id>/otp/verify", views.withdrawal_otp_verify),
    path("regularization-orders", views.regularization_orders),
    path("regularization-orders/<int:order_id>/approve", views.regularization_order_approve),
    path("regularization-orders/<int:order_id>/reject", views.regularization_order_reject),
    path("regularization-orders/<int:order_id>/otp", views.regularization_otp_request),
    path("regularization-orders/<int:order_id>/otp/verify", views.regularization_otp_verify),
]
