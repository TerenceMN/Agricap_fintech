# AGRICAP FINTECH

Plateforme fintech agricole (RDC) : crédit, épargne, investissement, wallet, caisses, comptabilité.

- **Frontend** — React 18 + Vite 7 + TypeScript/JSX + Tailwind, à la racine du dépôt (`src/`).
- **Backend** — Django 5 + DRF, dans [backend/](backend/), base SQLite en développement.
- **Données de référence** — classeurs Excel versionnés dans [Document Excel/](Document%20Excel/) ; ils
  alimentent le référentiel technico-économique et les 14 simulateurs par filière.

## Dépendance externe : l'IdP AGRICAP

L'authentification n'est **pas** dans ce dépôt. Le SPA obtient un jeton auprès de l'**IdP AGRICAP**
(OIDC / Authorization Code + PKCE, `http://localhost:8001` par défaut) et le backend valide chaque
jeton en appelant `/userinfo` sur ce même IdP ([backend/accounts/authentication.py](backend/accounts/authentication.py)).

Conséquence pour un poste neuf : **sans IdP joignable, on peut lancer les deux serveurs mais pas se
connecter** — toute route `/api/*` protégée répond 401. Deux options :

1. faire tourner l'IdP AGRICAP en local sur le port 8001 (dépôt séparé), ou
2. pointer `VITE_IDP_ISSUER` (frontend) et `IDP_ISSUER` / `IDP_USERINFO_URL` (backend) vers une
   instance IdP partagée, avec le client `agricap-fintech` déclaré et l'URI de redirection
   `http://localhost:5173/auth/callback` autorisée.

---

## 1. Prérequis

| Outil  | Version | Vérification    |
|--------|---------|-----------------|
| Python | 3.12 (3.10 minimum — Django 5) | `python --version` |
| Node   | 22 LTS (cf. [.nvmrc](.nvmrc)) | `node --version` |
| Git    | récent  | `git --version` |

### Windows (PowerShell)

```powershell
winget install --id Python.Python.3.12 -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Fermer puis rouvrir le terminal pour que le `PATH` soit rechargé, puis vérifier :

```powershell
python --version ; node --version ; git --version
```

### macOS

```bash
brew install python@3.12 node@22 git
```

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3-pip git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 2. Cloner

```bash
git clone https://github.com/TerenceMN/Agricap_fintech.git
cd Agricap_fintech
```

---

## 3. Backend (Django, port 8000)

### 3.1 Environnement virtuel et dépendances

**Windows (PowerShell)**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # si bloqué : Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 3.2 Configuration

```bash
cp .env.example .env        # Windows PowerShell : Copy-Item .env.example .env
```

Les valeurs par défaut suffisent en développement. À ajuster si besoin :

| Variable | Défaut | Rôle |
|---|---|---|
| `DJANGO_SECRET_KEY` | `dev-insecure-change-me` | à changer hors développement |
| `DJANGO_DEBUG` | `true` | sert `media/` et les tracebacks |
| `IDP_ISSUER`, `IDP_USERINFO_URL` | `http://localhost:8001` | IdP AGRICAP (cf. plus haut) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,...` | origines du SPA |
| `DOCUMENT_EXCEL_DIR` | `../Document Excel` | chemin **relatif au dossier `backend/`** — lancer `manage.py` depuis `backend/` |

`MAKUTA_*` (paiement) et `SMS_*` restent vides en développement : les appels correspondants sont
inactifs, aucun réseau n'est sollicité.

### 3.3 Windows uniquement — sortie console en UTF-8

Plusieurs commandes d'amorçage impriment des caractères hors cp1252 (`≠`, `²`). Sur une console
Windows par défaut, `seed_feuille_besoins_template` se termine par un `UnicodeEncodeError`
**après** avoir écrit en base — le travail est fait mais la sortie est illisible. À poser une fois
par terminal :

```powershell
$env:PYTHONUTF8 = "1"
```

### 3.4 Base de données et amorçage

`backend/db.sqlite3` n'est **pas** versionné : la base se construit à la première installation.
Toutes ces commandes sont idempotentes et se rejouent sans risque, dans cet ordre.

```bash
python manage.py migrate

python manage.py import_referentiel                 # référentiel technico-économique v3 (14 filières)
python manage.py ingest_simulateurs                 # 14 simulateurs Excel → tables dataio versionnées
python manage.py seed_analyse                       # barèmes de score + référentiels filière du moteur
python manage.py seed_accounting                    # plan comptable + catalogue d'écritures
python manage.py seed_feuille_besoins_template      # template de feuille de besoins (statut « pending »)
python manage.py seed_feuille_besoins_template --activate --maker seed --checker admin-2
```

La dernière ligne applique le maker-checker : le template n'est actif — donc opposable aux fichiers
client — qu'activé par un acteur différent de celui qui l'a déposé.

Optionnel, pour l'admin Django (`/admin/`, comptes locaux distincts des comptes IdP) :

```bash
python manage.py createsuperuser
```

### 3.5 Lancer

```bash
python manage.py runserver 8000
```

Contrôle : `http://localhost:8000/api/health` → `{"status": "ok", "service": "agricap-fintech-backend"}`

---

## 4. Frontend (Vite, port 5173)

Depuis la **racine** du dépôt, dans un second terminal :

```bash
npm ci
cp .env.example .env        # Windows PowerShell : Copy-Item .env.example .env
npm run dev
```

`.env` (frontend) :

| Variable | Défaut | Rôle |
|---|---|---|
| `VITE_IDP_ISSUER` | `http://localhost:8001` | IdP AGRICAP |
| `VITE_IDP_CLIENT_ID` | `agricap-fintech` | client OIDC déclaré côté IdP |
| `VITE_IDP_REDIRECT_URI` | `http://localhost:5173/auth/callback` | URI de redirection à autoriser côté IdP |

Le serveur Vite proxifie `/api` vers `http://localhost:8000` ([vite.config.js](vite.config.js)) : le
backend doit tourner pour que l'application affiche des données.

Application : `http://localhost:5173`

---

## 5. Résumé — poste neuf, de zéro à l'application

```bash
# 1. outils : Python 3.12, Node 22, Git (cf. §1)
git clone https://github.com/TerenceMN/Agricap_fintech.git
cd Agricap_fintech

# 2. backend — terminal A
cd backend
python -m venv .venv && .\.venv\Scripts\Activate.ps1      # macOS/Linux : source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py import_referentiel
python manage.py ingest_simulateurs
python manage.py seed_analyse
python manage.py seed_accounting
python manage.py seed_feuille_besoins_template
python manage.py seed_feuille_besoins_template --activate --maker seed --checker admin-2
python manage.py runserver 8000

# 3. frontend — terminal B, à la racine du dépôt
npm ci
cp .env.example .env
npm run dev

# 4. IdP AGRICAP sur le port 8001 — terminal C (dépôt séparé), sinon pas de connexion possible
```

---

## 6. Tests

```bash
# backend (depuis backend/, venv activé)
python manage.py test              # suite complète
python manage.py test caisses      # une application

# frontend (depuis la racine)
npm run test:run
npm run lint
```

Les identifiants SMS et Makuta sont neutralisés automatiquement pendant les tests
([backend/config/settings.py](backend/config/settings.py)) : aucune suite ne sort sur le réseau.

---

## 7. Pièges connus

- **`manage.py` se lance depuis `backend/`.** `DOCUMENT_EXCEL_DIR=../Document Excel` est relatif au
  répertoire courant ; ailleurs, les commandes d'amorçage ne trouvent pas les classeurs.
- **Aucune base n'est versionnée.** `db.sqlite3` et `backend/media/` sont ignorés : un clone neuf
  part d'une base vide, d'où le §3.4.
- **`.env` n'est jamais versionné** — seuls les `.env.example` le sont. Aucun secret ne part dans le dépôt.
- **401 sur toutes les routes `/api`** = IdP injoignable ou jeton expiré, pas un bug applicatif.
- **`database is locked`** : SQLite en écriture concurrente. Ne pas lancer deux `runserver` sur la
  même base ; le mode WAL est déjà activé côté configuration.

## 8. Documentation interne

- [CLAUDE.md](CLAUDE.md) — les 11 principes non négociables du module crédit ; à lire avant toute contribution.
- [CREDIT_MODULE_STATUS.md](CREDIT_MODULE_STATUS.md) — état du module crédit et anomalies connues.
- [docs/](docs/) — spécifications (moteur d'analyse, feuille de besoins, garanties).
- [SystemDesignDocument.md](SystemDesignDocument.md) — vue d'ensemble système.
