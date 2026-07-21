"""
Configuration Django — backend AGRICAP FINTECH (moteur d'analyse crédit).

Lecture d'environnement volontairement minimale (os.environ + .env optionnel),
sans dépendance supplémentaire : le projet reste isolé et léger.
"""
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Charge un .env simple (KEY=VALUE) sans écraser l'environnement existant."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(BASE_DIR / ".env")


def _env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = _env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "accounts",
    "referentiel",
    "dataio",
    "portfolio",
    "common",
    "audit",
    "rbac",
    "agencies",
    "caisses",
    "ledger",
    "fx",
    "transactions",
    "investments",
    "savings",
    "assets",
    "contracts",
    "suppliers",
    "compliance",
    "support",
    "notifications",
    "partners",
    "analytics",
    "alerts",
    "reference_data",
    "credits",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "common.middleware.RequestLoggingMiddleware",
]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "agricap": {"format": "[{asctime}] {message}", "style": "{", "datefmt": "%H:%M:%S"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "agricap"},
    },
    "loggers": {
        "agricap": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "agricap.requests": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "fx.bcc_sync": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        # `timeout` (busy_timeout) ne suffit PAS seul contre le provisioning JIT
        # concurrent : deux `update_or_create` simultanés font chacun SELECT puis
        # UPDATE, et l'upgrade verrou partagé → exclusif est un deadlock que SQLite
        # REFUSE tout de suite (« database is locked » en 60 ms, sans attendre les
        # 20 s). Le 500 observé sur /api/me venait de là.
        #   - `journal_mode=WAL`      : lecteurs et écrivain ne se bloquent plus ;
        #   - `transaction_mode=IMMEDIATE` : la transaction prend le verrou d'écriture
        #     dès le BEGIN, donc le second writer ATTEND (busy_timeout) au lieu de
        #     deadlocker sur l'upgrade — c'est ce qui transforme le 500 en attente ;
        #   - `synchronous=NORMAL`    : sûr sous WAL, évite un fsync par écriture.
        # `transaction_mode` et `init_command` sont supportés nativement par le
        # backend sqlite3 de Django ≥ 5.1 (ici 5.2).
        "OPTIONS": {
            "timeout": 20,
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Kinshasa"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- DRF : auth par jeton IdP (Bearer validé via /userinfo). ---------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.IdpBearerAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "config.exceptions.agricap_exception_handler",
}

# --- Intégration IdP AGRICAP ------------------------------------------------
IDP = {
    "ISSUER": os.environ.get("IDP_ISSUER", "http://localhost:8001"),
    "USERINFO_URL": os.environ.get("IDP_USERINFO_URL", "http://localhost:8001/userinfo"),
    "USERINFO_CACHE_TTL": int(os.environ.get("IDP_USERINFO_CACHE_TTL", "300")),
}

# --- Analyse assistée par IA (hybride : calculs déterministes + IA sur les
#     verdicts/message/décision, en s'appuyant sur les documents de la plateforme) ---
AI = {
    "PROVIDER": os.environ.get("AI_PROVIDER", "anthropic"),
    "API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
    "MODEL": os.environ.get("AI_MODEL", "claude-sonnet-5"),
    "BASE_URL": os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1/messages"),
    "ENABLED": os.environ.get("AI_ANALYSIS_ENABLED", "true").lower() == "true",
    "TIMEOUT": int(os.environ.get("AI_TIMEOUT", "45")),
}

# --- CORS (SPA FINTECH) -----------------------------------------------------
CORS_ALLOWED_ORIGINS = _env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
)

# --- Emplacement des classeurs de référence (amorçage CLI) ------------------
DOCUMENT_EXCEL_DIR = os.environ.get("DOCUMENT_EXCEL_DIR", str(BASE_DIR.parent / "Document Excel"))

# --- SMS (Dream Digital / aSMSC) — OTP par SMS (maker-checker) + notifications
#     ticket/alerte. Sans SMS_API_ID configuré, `common.sms.send_sms` dégrade en
#     log honnête (pas d'envoi simulé), même principe que `partners.services`. ---
SMS = {
    "API_URL": os.environ.get("SMS_API_URL", ""),
    "API_ID": os.environ.get("SMS_API_ID", ""),
    "API_PASSWORD": os.environ.get("SMS_API_PASSWORD", ""),
    "SENDER_ID": os.environ.get("SMS_SENDER_ID", "TEST-SMS"),
}

# --- Délégation d'approbation crédit (montant max en USD par rôle) ----------
# Clés = identifiants canoniques de `rbac.role_registry`. None = illimité.
#
# Cette table porte l'AUTORITÉ d'approbation crédit, distincte de la capacité
# RBAC `validate` : `admin_it` et `compliance` valident de la configuration et
# de la conformité, pas des engagements financiers — ils sont donc absents ici
# et ne peuvent approuver aucun dossier. Un rôle absent = aucune autorité.
#
# Le comité de crédit n'a pas de rôle propre (décision de juillet 2026 : aucun
# nouveau rôle) — il est exercé par `dg` et `admin`, en délégation illimitée.
#
# Correspondance avec l'ancien vocabulaire, supprimé car il ne correspondait à
# aucun identifiant réel de `accounts.FintechUser.role` :
#   agent → agent_terrain · gestionnaire/credit_officer → gest_credit
#   branch_manager → gest_zone · regional_director → dir_ops
#   credit_committee → dg + admin
# Les agents de terrain (`agent_terrain`, `agent_cash`) sont volontairement
# ABSENTS : ils ne portent pas la capacité `validate` dans le registre, ils
# montent et instruisent les dossiers mais n'engagent jamais les fonds.
# L'ancienne entrée « agent : 5 000 USD » visait un rôle qui n'a jamais existé.
CREDIT_DELEGATION_USD: dict[str, float | None] = {
    "gest_credit":        25_000,   # Gestionnaire Crédits
    "gest_port":          25_000,   # Gestionnaire Portefeuille
    "gest_zone":          25_000,   # Gestionnaire Zones (niveau agence)
    "gest_caisse":        25_000,   # Gestionnaire Caisses
    "manager":            25_000,   # Manager (legacy)
    "dir_ops":           100_000,   # Directeur Opérations
    "dg":                   None,   # Directeur Général — illimité
    "admin":                None,   # Administrateur (legacy) — illimité
}

# Fenêtre de consentement client pour les demandes on_behalf_of (heures)
CREDIT_CONSENT_WINDOW_HOURS: int = 72

# Taux CDF/USD de SECOURS pour le contrôle de délégation uniquement.
# Ce n'est pas un taux du jour et il n'est pas journalisé : son usage émet un
# warning. À remplacer par le convertisseur du module Accounting.
CREDIT_FALLBACK_CDF_PER_USD: int = 2800
