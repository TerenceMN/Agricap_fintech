"""
Configuration Django — backend AGRICAP FINTECH (moteur d'analyse crédit).

Lecture d'environnement volontairement minimale (os.environ + .env optionnel),
sans dépendance supplémentaire : le projet reste isolé et léger.
"""
from pathlib import Path
import os
import sys

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
    "accounting",
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

# --- CORS (SPA FINTECH) -----------------------------------------------------
CORS_ALLOWED_ORIGINS = _env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
)

# --- Emplacement des classeurs de référence (amorçage CLI) ------------------
DOCUMENT_EXCEL_DIR = os.environ.get("DOCUMENT_EXCEL_DIR", str(BASE_DIR.parent / "Document Excel"))

SMS = {
    "API_URL": os.environ.get("SMS_API_URL", ""),
    "API_ID": os.environ.get("SMS_API_ID", ""),
    "API_PASSWORD": os.environ.get("SMS_API_PASSWORD", ""),
    "SENDER_ID": os.environ.get("SMS_SENDER_ID", "TEST-SMS"),
    # « U » = Unicode : indispensable aux accents français (cf. common/sms.py).
    "ENCODING": os.environ.get("SMS_ENCODING", "U"),
}

if "test" in sys.argv:
    SMS = {**SMS, "API_URL": "", "API_ID": "", "API_PASSWORD": ""}

# --- Plateforme de paiement Makuta (Wolf Technologies) ----------------------
# Authentification par signature RSA de nos requêtes ; cf. `common/makuta.py`,
# qui documente les trois écarts relevés dans la spécification fournisseur.
#
# La clé privée ne vit JAMAIS dans le dépôt : on passe le PEM par variable
# d'environnement, ou un chemin vers un fichier hors webroot. `SIGNATURE_HEADER`
# est configurable parce que la documentation se contredit sur son nom
# (`X-Makuta-Signature` dans le tableau normatif, `X-Signature` dans l'exemple).
MAKUTA = {
    "BASE_URL": os.environ.get("MAKUTA_BASE_URL", ""),
    "PRIVATE_KEY_PEM": os.environ.get("MAKUTA_PRIVATE_KEY_PEM", ""),
    "PRIVATE_KEY_PATH": os.environ.get("MAKUTA_PRIVATE_KEY_PATH", ""),
    "PRIVATE_KEY_PASSPHRASE": os.environ.get("MAKUTA_PRIVATE_KEY_PASSPHRASE", ""),
    #: Clé PUBLIQUE de Makuta, pour authentifier un éventuel rappel entrant.
    #: Non fournie à ce jour : la documentation ne couvre que partenaire → Makuta.
    "CALLBACK_PUBLIC_KEY_PEM": os.environ.get("MAKUTA_CALLBACK_PUBLIC_KEY_PEM", ""),
    "SIGNATURE_HEADER": os.environ.get("MAKUTA_SIGNATURE_HEADER", "X-Makuta-Signature"),
}

if "test" in sys.argv:
    # Même raison que pour le SMS : `.env` porte de vrais identifiants et la
    # suite ne doit atteindre aucun réseau. Les tests de signature fabriquent
    # leur propre paire de clés en mémoire.
    MAKUTA = {**MAKUTA, "BASE_URL": "", "PRIVATE_KEY_PEM": "", "PRIVATE_KEY_PATH": ""}

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
