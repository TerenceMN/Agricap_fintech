from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from rbac.permissions import HasCapability

from .sms import send_sms


@api_view(["POST"])
@permission_classes([HasCapability("config")])
def sms_test(request):
    """Envoi SMS de test manuel — réservé aux administrateurs (capacité config)."""
    data = request.data or {}
    phone = (data.get("phone") or "").strip()
    message = (data.get("message") or "").strip()
    if not phone or not message:
        return Response({"detail": "phone et message sont requis."}, status=400)
    sent = send_sms(phone=phone, message=message)
    return Response({"sent": sent, "phone": phone, "message": message})
