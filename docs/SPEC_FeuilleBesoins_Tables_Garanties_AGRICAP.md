# AGRICAP — Feuille de besoins en tables & garanties opposables
## Chantier 1 : chaque fichier uploadé devient une table (dataio) · Chantier 2 : garanties vérifiées (actifs & caution solidaire)

**Base :** architecture réelle documentée dans CREDIT_MODULE_STATUS.md (juillet 2026)
**Apps concernées :** `credits`, `dataio`, `reference_data`, `portfolio` (lecture), + nouvelle app `assets`
**Version :** 1.0 — Juillet 2026

---

# CHANTIER 1 — La feuille de besoins client devient un DataSource

## 1.1 Constat sur l'existant

`POST /api/credits/needs-sheet/parse/` parse le classeur **en mémoire** : les totaux de `5_Synthese_Besoins` alimentent la simulation puis le fichier disparaît du circuit de données. Conséquences :

- Pas de trace ligne à ligne de ce que le client a réellement soumis (seuls les 8 totaux survivent) ;
- Impossible de rejouer ou d'auditer une simulation (le score dépend d'un fichier qui n'est plus consultable en tables) ;
- Le détail de `4_Besoins_Financiers` (Rubrique, Quantité, Prix, Total) est perdu, alors que c'est la matière première de l'analyse de plausibilité (prix unitaires vs référentiel).

Or l'infrastructure existe déjà : `dataio` ingère n'importe quel classeur en tables génériques **sans migration** (`DataSource → DataTable → DataColumn → DataRecord`), avec versionnage par `dataset_key` (`revision`, `is_current`, `supersedes`). Il suffit de l'étendre au parcours client.

## 1.2 Principe

> **Règle : ce qui est scoré = ce qui est en base.** Le simulateur et le scoring ne lisent plus jamais un fichier ; ils lisent les `DataRecord` de la révision courante du DataSource lié au dossier.

```
Client uploade feuille_besoins.xlsx
        │
        ▼
POST /api/credits/needs-sheet/parse/            (endpoint conservé, comportement étendu)
        │
        ├─ 1. Validation structurelle (feuilles 4 & 5, colonnes, types)   ── 422 + errors[]
        ├─ 2. Ingestion dataio : DataSource kind="FEUILLE_BESOINS"
        │       dataset_key = "fb__{application_code}"        → 1 dossier = 1 lignée versionnée
        │       tables ingérées : 4_Besoins_Financiers, 5_Synthese_Besoins
        │       commit immédiat (pas de phase STAGED pour le parcours client)
        │       re-upload → nouvelle revision, is_current bascule, l'historique reste
        ├─ 3. Extraction des 8 totaux depuis les DataRecord de 5_Synthese_Besoins
        │       (mapping rubrique → code module du §5.3 existant)
        └─ 4. Réponse au front : totaux par module + needs_source_id + revision
```

## 1.3 Modifications backend

**a) `dataio` — nouveau `kind` et rattachement au dossier.**

```python
# dataio/models.py — ajouts
class DataSource(models.Model):
    KIND_CHOICES = [..., ("FEUILLE_BESOINS", "Feuille de besoins client")]
    # Rattachement optionnel à un dossier de crédit (null pour les autres kinds)
    credit_application = models.ForeignKey(
        "credits.CreditApplication", null=True, blank=True,
        on_delete=models.PROTECT, related_name="needs_sources")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                    on_delete=models.SET_NULL)
    sha256 = models.CharField(max_length=64, blank=True)   # intégrité du fichier source
```

`on_delete=PROTECT` sur les deux sens : on ne supprime jamais un DataSource lié à un dossier (même clôturé) — exigence d'audit. Le `DELETE /api/dataio/sources/<id>` existant doit **refuser** (409) les sources `FEUILLE_BESOINS` liées à un dossier non-`draft`.

**b) Détection et validation spécifiques.** Un classeur client n'est pas un simulateur (≥15 feuilles) ni un référentiel : marqueurs = présence de `4_Besoins_Financiers` **et** `5_Synthese_Besoins`, ≤ 10 feuilles. Validation avant commit :

| Contrôle | Règle | Erreur |
|---|---|---|
| Feuilles | `4_Besoins_Financiers` et `5_Synthese_Besoins` présentes | `FEUILLE_MANQUANTE` |
| Colonnes feuille 4 | Rubrique, Désignation, Quantité, Prix unitaire, Total | `COLONNE_MANQUANTE` |
| Rubriques feuille 5 | les 8 rubriques du mapping §5.3 + TOTAL GÉNÉRAL | `RUBRIQUE_MANQUANTE` |
| Cohérence 4↔5 | Σ lignes feuille 4 par rubrique = total feuille 5 (±0,01) | `INCOHERENCE_INTERNE` |
| Types | Quantité, Prix, Total numériques ≥ 0 | `TYPE_INVALIDE` |
| Total | TOTAL GÉNÉRAL = Σ des 8 rubriques (±0,01) | `TOTAL_INCOHERENT` |

Le contrôle `INCOHERENCE_INTERNE` est nouveau et important : il détecte un classeur dont les formules Excel ont été écrasées à la main (feuille 5 modifiée sans passer par la feuille 4) — signal de manipulation à remonter dans le rapport d'analyse documentaire existant (`analysis-report`).

**c) `credits/needs_sheet.py` (ou équivalent) — la fonction de parse devient :**

```python
def parse_and_ingest(file, application, user) -> dict:
    wb_errors = validate_needs_sheet(file)                # tableau ci-dessus
    if wb_errors:
        raise NeedsSheetValidationError(wb_errors)        # → 422 {errors: [...]}

    source = dataio_ingest(                               # réutilise ingest_workbook
        file, kind="FEUILLE_BESOINS",
        dataset_key=f"fb__{application.code}",
        credit_application=application, uploaded_by=user,
        sheets=["4_Besoins_Financiers", "5_Synthese_Besoins"],
        commit=True)                                      # pas de STAGED côté client

    totals = extract_module_totals(source)                # lit les DataRecord, pas le fichier
    application.needs_source = source                     # FK "révision courante" sur le dossier
    application.save(update_fields=["needs_source"])
    return {"needs_source_id": source.id, "revision": source.revision,
            "totals": totals, "grand_total": sum(totals.values())}
```

```python
def extract_module_totals(source) -> dict[str, Decimal]:
    """Calque ligne à ligne : chaque ligne de 5_Synthese_Besoins alimente
    exactement un module du simulateur, via le mapping rubrique→code (§5.3)."""
    table = source.tables.get(name="5_Synthese_Besoins", is_current=True)
    totals = {code: Decimal("0") for code in MODULE_CODES}   # les 8 codes
    for rec in table.records.all():
        code = RUBRIQUE_TO_MODULE.get(normalize(rec.values["Rubrique"]))
        if code:
            totals[code] = Decimal(str(rec.values["Total"]))
    return totals
```

**d) `POST /api/credits/simulate/` et `.../score/`** ne reçoivent plus de montants par module dans le payload : ils prennent `application_code`, chargent `application.needs_source` (révision courante) et recalculent les totaux depuis les `DataRecord`. Si le client re-uploade entre simulation et soumission, la révision change — le front reçoit `revision` et affiche « feuille mise à jour, re-simulez ». Le rapport de scoring stocke `needs_source_id + revision + sha256` : une simulation est rejouable à l'identique.

## 1.4 Modifications frontend (SimulateurIntelligent)

Le comportement actuel (coûts initialisés au `Math.random()`, sliders libres) est remplacé par le **calque strict** :

1. À l'étape 2, tant qu'aucune feuille n'est uploadée : les 8 modules sont **vides et désactivés**, avec un encart « Téléchargez le template officiel [lien `GET /needs-sheet-template/?value_chain_code=…`], remplissez la feuille 4, uploadez-la ».
2. Après upload réussi : chaque module affiche son **Coût estimé en lecture seule**, valeur issue de la ligne correspondante de `5_Synthese_Besoins` (réponse de `parse/`). Les modules à 0 dans le fichier apparaissent grisés/inactifs.
3. Le seul curseur restant est **« Financement demandé % »** par module (part du besoin que le client demande à AGRICAP) — c'est ce qui produit le « Montant total financé » (1 050 USD sur un besoin de 1 330 dans l'exemple).
4. « ⚡ Simuler via l'API » appelle `POST /simulate/` sans montants (le backend lit les tables) et affiche le score réel.
5. Pour modifier un coût, le client modifie **son fichier Excel** et re-uploade — jamais l'interface. Un badge `révision n` s'affiche ; l'historique des révisions reste consultable côté analyste (`GET /api/dataio/history?key=fb__<code>`).

Ce choix ferme la faille actuelle : impossible de saisir dans l'UI des chiffres différents de ceux du fichier, donc impossible que l'analyste et le client regardent deux réalités différentes.

## 1.5 Vue analyste

Dans `ApplicationDetail.tsx`, ajouter un panneau « Feuille de besoins » : tableau des lignes de `4_Besoins_Financiers` (via `GET /api/dataio/sources/<id>/tables`), colonne « vs référentiel » calculée (prix unitaire client vs plage min/max de `/api/referentiel/ranges?chain=…`), badge rouge hors plage, et sélecteur de révision. La troncature silencieuse à 500 lignes de l'endpoint dataio est sans risque ici (une feuille de besoins fait quelques dizaines de lignes), mais afficher quand même `total_rows` par honnêteté d'interface.

---

# CHANTIER 2 — Garanties opposables

## 2.1 Constat sur l'existant

Les endpoints existent (`guarantees/savings/`, `guarantees/moral/`, `guarantees/<id>/confirm/`, `guarantees/<id>/release/`) mais rien ne garantit aujourd'hui :

- qu'une garantie « actif » désigne un actif **réel, vérifié, appartenant au client et libre de tout gage** (le front lit `localStorage.agricap_assets`) ;
- qu'une caution morale a été **acceptée par le garant lui-même**, ni que ce garant appartient au groupe/coopérative du demandeur ;
- que le type de garantie est **admis pour la filière** (`ValueChain.eligible_guarantees` existe mais n'est pas contrôlé à la pose).

## 2.2 Alignement de nomenclature (préalable obligatoire)

Quatrième cas de nomenclatures divergentes du projet : le front utilise `actif, immobilier, epargne, morale, Gage matériel, Hypothèque` ; `ValueChain.eligible_guarantees` utilise `epargne, morale, foncier, materiel`. **Nomenclature canonique retenue (backend fait foi)** :

| Code canonique | Libellé front | Correspond à |
|---|---|---|
| `epargne` | Nantissement Épargne | hold wallet (existant) |
| `morale` | Caution Solidaire | garant du groupe/coopérative |
| `materiel` | Gage matériel | actif mobilier enregistré |
| `foncier` | Hypothèque / Foncier | actif immobilier enregistré |

Le `GUARANTEE_CONFIG` du front est réécrit sur ces 4 codes ; `actif` et `immobilier` deviennent des alias d'affichage de `materiel` et `foncier`. À la pose, le backend rejette (`422 GUARANTEE_TYPE_NOT_ELIGIBLE`) tout type absent de `ValueChain.eligible_guarantees` de la filière du dossier.

## 2.3 Registre d'actifs (`assets` — nouvelle app backend)

Le front `AssetsInventory.jsx` existe sans backend. Modèle :

```python
class Asset(models.Model):
    class Statut(models.TextChoices):
        DECLARE = "declare", "Déclaré"          # saisi par le client
        VERIFIE = "verifie", "Vérifié"          # contrôlé par un agent terrain
        REJETE = "rejete", "Rejeté"
        GAGE = "gage", "Gagé"                   # nanti sur un crédit actif
        LIBERE = "libere", "Libéré"             # gage levé → redevient vérifié

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                              related_name="assets")
    categorie = models.CharField(max_length=20,
        choices=[("materiel", "Matériel/Équipement"), ("foncier", "Foncier/Immobilier"),
                 ("vehicule", "Véhicule"), ("stock", "Stock/Récolte")])
    designation = models.CharField(max_length=200)
    valeur_declaree = models.DecimalField(max_digits=16, decimal_places=2)
    valeur_retenue = models.DecimalField(max_digits=16, decimal_places=2, null=True)
    devise = models.CharField(max_length=3, default="USD")
    localisation = models.CharField(max_length=200, blank=True)
    documents = models.JSONField(default=list)      # réfs preuves (titre, facture, photos)
    statut = models.CharField(max_length=10, choices=Statut.choices, default="declare")
    verifie_par = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="+")
    verifie_le = models.DateTimeField(null=True)
    gage_application = models.ForeignKey("credits.CreditApplication", null=True,
                                         blank=True, on_delete=models.PROTECT,
                                         related_name="assets_gages")
```

`valeur_retenue` = valeur après vérification terrain et décote institutionnelle (30 % dans `InstitutionConfig`) — c'est **elle** qui compte dans la couverture, jamais la valeur déclarée.

**Endpoints** (`/api/assets/`, permissions à brancher sur le RBAC une fois l'anomalie `request.roles` corrigée — voir §2.6) : CRUD client sur ses propres actifs (`declare` uniquement), `POST /api/assets/<id>/verify/` (agent terrain : fixe `valeur_retenue`, passe `verifie`), `POST .../reject/`.

## 2.4 Pose d'une garantie sur actif — règles bloquantes

Nouvel endpoint `POST /api/credits/applications/<code>/guarantees/asset/` avec `{"asset_id": ...}` :

| # | Règle | Erreur 422 |
|---|---|---|
| 1 | L'actif existe et `asset.owner == application.client` | `ASSET_NOT_OWNED` |
| 2 | `asset.statut == "verifie"` (jamais `declare` ni `gage`) | `ASSET_NOT_VERIFIED` / `ASSET_ALREADY_PLEDGED` |
| 3 | Catégorie compatible : `materiel\|vehicule\|stock → materiel` ; `foncier → foncier` | `ASSET_CATEGORY_MISMATCH` |
| 4 | Type résultant ∈ `ValueChain.eligible_guarantees` | `GUARANTEE_TYPE_NOT_ELIGIBLE` |
| 5 | `valeur_retenue` non nulle | `ASSET_NO_RETAINED_VALUE` |

Effet : création de la `Guarantee(type, asset_fk, montant=valeur_retenue, statut=proposed)`. La **confirmation** (`guarantees/<id>/confirm/`, endpoint existant, réservé agent) passe l'actif en `gage` + `gage_application` renseigné — verrou atomique (`select_for_update`) pour empêcher le double gage simultané sur deux dossiers. `guarantees/<id>/release/` (existant) fait l'inverse : actif → `libere`.

Côté front (`ConfigurationGaranties`) : « Mes Actifs Enregistrés » ne lit plus `localStorage` mais `GET /api/assets/?statut=verifie&libre=true`. Un client **sans actif vérifié** voit l'encart « Aucun actif disponible — déclarez un actif dans Mes Actifs ; il devra être vérifié par un agent avant de servir de garantie » et **ne peut pas** cocher ce type. Posséder l'objet dans le système est obligatoire, pas déclaratif.

## 2.5 Caution solidaire — le garant doit consentir

Modèle du flux, calqué sur le mécanisme de consentement 72 h déjà implémenté pour les dossiers « pour le compte de » (`client-consent`) :

```
Client (étape 3) : désigne un garant
  → recherche parmi LES MEMBRES DE SON/SES GROUPES ou coopérative uniquement
  → POST guarantees/moral/  {"guarantor_id":..., "montant_couvert":...}
        ↳ contrôles : garant ≠ demandeur · membre actif d'un groupe commun ·
        ↳ compte actif · pas en défaut (portfolio.Loan status ∉ {default, blocked}) ·
        ↳ cumul de ses cautions actives + montant ≤ plafond (cf. règles)
        ▼
Guarantee(type=morale, statut=pending_consent, expires_at = now + 72h)
        ↳ notification au garant (ClientNotifications existant)
        ▼
Garant : GET /api/credits/guarantee-requests/        (ses demandes en attente)
         POST /api/credits/guarantee-requests/<id>/consent/   {"accept": true|false}
        ↳ accept → statut=consented   (horodatage + IP + user journalisés)
        ↳ refuse → statut=declined    · timeout 72 h → statut=expired
        ▼
Agent : guarantees/<id>/confirm/ (existant)  → statut=constituted
        ↳ la soumission du dossier exige : toutes les garanties morales
        ↳ en statut ≥ consented (sinon 422 GUARANTOR_CONSENT_MISSING)
```

**Règles de fond sur le garant** (paramétrables dans `InstitutionConfig`) :

1. **Appartenance commune obligatoire** : `garant ∈ membres(groupes du demandeur)` — s'appuie sur les groupes du module Épargne (`AdminGroupsTable` / `AssignGroupModal` existants). Un dossier au nom d'une coopérative accepte tout membre actif de la coopérative. Erreur sinon : `GUARANTOR_NOT_IN_GROUP`.
2. **Capacité d'engagement** : Σ(cautions actives du garant) + nouvelle caution ≤ `k ×` son épargne AGRICAP (défaut k = 2) **et** nombre de cautions actives ≤ 3. Erreurs : `GUARANTOR_OVEREXTENDED`, `GUARANTOR_TOO_MANY_PLEDGES`.
3. **Solvabilité comportementale** : le garant ne doit avoir aucun prêt en `default` ni caution appelée non soldée. Erreur : `GUARANTOR_IN_DEFAULT`.
4. **Réciprocité croisée interdite** : A caution B et B caution A sur des dossiers actifs simultanés → refus (`CROSS_GUARANTEE_FORBIDDEN`) — les cautions circulaires vident la garantie de sa substance.
5. La caution morale entre dans la couverture avec sa **décote de 70 %** (poids 0.3 dans le scoring C5) : elle sécurise socialement, pas financièrement.

**Modèle** (extension de la table Guarantee existante) :

```python
class Guarantee(models.Model):
    # champs existants +
    class Statut(models.TextChoices):
        PROPOSED = "proposed"; PENDING_CONSENT = "pending_consent"
        CONSENTED = "consented"; DECLINED = "declined"; EXPIRED = "expired"
        CONSTITUTED = "constituted"; RELEASED = "released"; CALLED = "called"
    guarantor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                  on_delete=models.PROTECT, related_name="cautions_donnees")
    montant_couvert = models.DecimalField(max_digits=16, decimal_places=2, null=True)
    consent_expires_at = models.DateTimeField(null=True)
    consent_meta = models.JSONField(default=dict)   # horodatage, canal, IP
    asset = models.ForeignKey("assets.Asset", null=True, blank=True,
                              on_delete=models.PROTECT)
```

Le statut `CALLED` (caution appelée en cas de défaut du débiteur) prépare le lien futur avec `portfolio` — hors périmètre ici, mais le champ doit exister dès maintenant pour l'historique.

**Front garant** : nouvel écran (ou section de `ClientNotifications`) « Demandes de caution » : identité du demandeur, filière, montant du crédit, montant couvert, engagement en clair (« en cas de défaut de X, vous vous engagez solidairement à hauteur de Y »), boutons Accepter / Refuser, compte à rebours 72 h. Le texte d'engagement doit être explicite — c'est un acte juridique, pas un clic social.

## 2.6 Dépendances vers les anomalies connues

Deux anomalies du STATUS bloquent partiellement ce chantier et doivent être corrigées **avant ou avec** lui :

1. **`request.roles` jamais défini** → `guarantees/<id>/confirm/` et `assets/verify/` (réservés agent) seraient inopérants ou non protégés. Correctif minimal : un middleware qui pose `request.roles` depuis le profil utilisateur, avec **une seule** nomenclature de rôles (trancher entre les 4 jeux existants — recommandation : celle de `rbac/role_registry.py`, puis mapper `CREDIT_DELEGATION_USD` dessus).
2. **`eligible_guarantees` non contrôlé** : le contrôle du §2.4 règle le cas à la pose ; ajouter le même contrôle dans `submit/` (défense en profondeur, un dossier draft ancien peut contenir un type devenu inéligible après mise à jour du référentiel filière).

## 2.7 Traçabilité

Chaque transition de garantie et d'actif écrit dans le journal du dossier (même mécanique que le workflow §6 du STATUS) : qui, quand, quoi, ancien → nouveau statut. Le consentement du garant conserve `consent_meta` de façon immuable — en cas de contentieux sur une caution appelée, c'est la preuve du consentement.

---

# Ordre d'implémentation

| # | Lot | Contenu | Estimation |
|---|---|---|---|
| 1 | Nomenclature garanties | Codes canoniques + réécriture `GUARANTEE_CONFIG` front + contrôle `eligible_guarantees` | ½ j |
| 2 | Feuille de besoins → dataio | kind `FEUILLE_BESOINS`, FK dossier, validation 6 contrôles, `extract_module_totals`, refonte `simulate`/`score` en lecture DataRecord | 2 j |
| 3 | Front simulateur en calque | Modules read-only depuis le fichier, curseur % financement seul, gestion des révisions | 1,5 j |
| 4 | App `assets` | Modèle, CRUD client, verify/reject agent, branchement `AssetsInventory.jsx` | 1,5 j |
| 5 | Garantie actif | Endpoint + 5 règles + gage/libération atomiques + front `ConfigurationGaranties` sur API | 1 j |
| 6 | Caution solidaire | Workflow consentement 72 h, 5 règles garant, écran garant, notifications | 2 j |
| 7 | Middleware `request.roles` | Correctif transverse (débloque aussi approve et dashboard admin) | 1 j |

**Total : ~9,5 jours-homme.** Le lot 7 peut être fait en premier — il débloque au passage l'anomalie `delegation_exceeded` qui casse aujourd'hui toute approbation.
