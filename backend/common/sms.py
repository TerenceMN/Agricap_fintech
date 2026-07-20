"""Envoi SMS (Dream Digital / aSMSC) — utilisé pour l'OTP par SMS (maker-checker) et les
notifications de cycle de vie ticket/alerte. Sans identifiants configurés (`settings.SMS`),
dégrade en log honnête plutôt qu'un envoi simulé — même principe que `partners.services`
(pas de résultat fabriqué quand rien n'est réellement configuré)."""
from __future__ import annotations

import logging

import requests
from django.conf import settings

logger = logging.getLogger("agricap")

_TIMEOUT_SECONDS = 10


def send_sms(*, phone: str, message: str) -> bool:
    """Envoie un SMS texte. Retourne True si le fournisseur a accepté le message (statut
    "S"), False sinon (numéro/identifiants absents, erreur réseau, refus du fournisseur) —
    ne lève jamais d'exception : un échec d'envoi SMS ne doit jamais faire échouer
    l'opération métier qui le déclenche (canal secondaire, pas le seul canal)."""
    if not phone:
        logger.warning("[SMS] SKIP — numéro de téléphone vide")
        return False

    config = settings.SMS
    if not config.get("API_URL") or not config.get("API_ID") or not config.get("API_PASSWORD"):
        logger.warning("[SMS] SKIP — identifiants manquants (SMS_API_*) to=%s", phone)
        return False

    normalized_phone = phone.lstrip("+")
    logger.info("[SMS] ENVOI → to=%s sender=%s msg=%r", normalized_phone, config.get("SENDER_ID"), message)
    try:
        response = requests.get(config["API_URL"], params={
            "api_id": config["API_ID"], "api_password": config["API_PASSWORD"],
            "sms_type": "T", "encoding": "T", "sender_id": config["SENDER_ID"],
            "phonenumber": normalized_phone, "textmessage": message,
        }, timeout=_TIMEOUT_SECONDS)
        data = response.json()
        ok = data.get("status") == "S"
        if ok:
            logger.info("[SMS] OK ✓ to=%s response=%s", normalized_phone, data)
        else:
            logger.warning("[SMS] ÉCHEC — refusé par l'API to=%s response=%s", normalized_phone, data)
        return ok
    except (requests.RequestException, ValueError) as exc:
        logger.error("[SMS] ERREUR réseau to=%s err=%s", normalized_phone, exc)
        return False


def send_sms_to_user(*, user_sub: str, message: str) -> bool:
    """Résout le numéro de téléphone d'un utilisateur via son sub IdP puis envoie — les
    fonctions OTP/notification appelantes n'ont besoin de connaître qu'un sub, pas un
    numéro de téléphone."""
    from accounts.models import FintechUser
    logger.info("[SMS] Résolution utilisateur sub=%r", user_sub)
    user = FintechUser.objects.filter(sub=user_sub).first()
    if not user:
        logger.warning("[SMS] SKIP — utilisateur introuvable sub=%r", user_sub)
        return False
    if not user.phone:
        logger.warning("[SMS] SKIP — numéro absent sub=%r email=%s", user_sub, getattr(user, "email", "?"))
        return False
    logger.info("[SMS] Utilisateur trouvé sub=%r phone=%s → envoi", user_sub, user.phone)
    return send_sms(phone=user.phone, message=message)
