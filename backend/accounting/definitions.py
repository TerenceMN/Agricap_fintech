"""Données de référence du socle comptable : plan comptable (annexe A) et catalogue des
écritures automatiques (annexe B). Ces structures ne sont QUE la source de la commande de
chargement idempotente `seed_accounting` — à l'exécution, le moteur ne lit que la BASE.

Conventions de codification
---------------------------
* `racine` = le code tel qu'écrit dans les annexes (413, 501, 588, 613FX…).
* Un compte dédoublé par devise donne un code par devise : racine + devise (413FC, 413USD).
* Un compte non dédoublé garde son code = racine (613FX, 712FX, 581, 101…).

Points signalés au fondateur (cf. rapport) : l'annexe A écrit « 613 » en classe 6 alors que
les annexes B et E écrivent « 613FX » ; on retient « 613FX » (et symétriquement « 712FX »)
parce que c'est la forme que le catalogue référence. Les comptes 611/641/691/791 sont des
concrétisations des mentions génériques « 6xx » / « 7xx » des schémas B6 et B7.
"""
from __future__ import annotations

# --------------------------------------------------------------------------- ANNEXE A
# (racine, intitulé, classe, nature, devises, est_transitoire)
# devises = () → compte unique, toutes devises acceptées sur les lignes.
PLAN_COMPTABLE: list[tuple[str, str, int, str, tuple[str, ...], bool]] = [
    # ------------------------------------------------------------------- CLASSE 1
    ("101", "Capital", 1, "PASSIF", (), False),
    ("106", "Réserves", 1, "PASSIF", (), False),
    ("108", "Résultat de l'exercice", 1, "PASSIF", (), False),
    ("137", "Provisions pour risques de crédit", 1, "PASSIF", ("FC", "USD"), False),
    # ------------------------------------------------------------------- CLASSE 2
    ("201", "Logiciels", 2, "ACTIF", (), False),
    ("211", "Matériel", 2, "ACTIF", (), False),
    # ------------------------------------------------------------------- CLASSE 4
    ("412", "Clients — comptes épargne", 4, "PASSIF", ("FC", "USD"), False),
    ("413", "Crédits à court terme (encours sains)", 4, "ACTIF", ("FC", "USD"), False),
    ("416", "Crédits en souffrance (> 90 j)", 4, "ACTIF", ("FC", "USD"), False),
    ("419", "Souscriptions investisseurs reçues", 4, "PASSIF", ("FC", "USD"), False),
    ("421", "Fournisseurs", 4, "PASSIF", (), False),
    # ------------------------------------------------------------------- CLASSE 5
    ("501", "Caisse", 5, "ACTIF", ("FC", "USD"), False),
    ("511", "Banque", 5, "ACTIF", ("FC", "USD"), False),
    ("531", "Mobile money — Airtel Money", 5, "ACTIF", ("FC",), False),
    ("532", "Mobile money — Orange Money", 5, "ACTIF", ("FC",), False),
    ("533", "Mobile money — M-Pesa", 5, "ACTIF", ("FC", "USD"), False),
    ("581", "Transitoire — opérations internes", 5, "ACTIF", (), True),
    ("588", "Transitoire FX (588FX) — doit tendre vers zéro", 5, "ACTIF", ("FC", "USD"), True),
    # ------------------------------------------------------------------- CLASSE 6
    ("611", "Services extérieurs", 6, "CHARGE", (), False),
    ("613FX", "Pertes de change", 6, "CHARGE", (), False),
    ("641", "Charges de personnel", 6, "CHARGE", (), False),
    ("691", "Dotations aux provisions pour risques de crédit", 6, "CHARGE", (), False),
    # ------------------------------------------------------------------- CLASSE 7
    ("701", "Intérêts sur crédits", 7, "PRODUIT", ("FC", "USD"), False),
    ("702", "Commissions", 7, "PRODUIT", ("FC", "USD"), False),
    ("712FX", "Gains de change", 7, "PRODUIT", (), False),
    ("719", "Produits des placements et projets", 7, "PRODUIT", ("FC", "USD"), False),
    ("791", "Reprises de provisions pour risques de crédit", 7, "PRODUIT", (), False),
]

# Racine du transitoire de change, référencée par le mécanisme de l'annexe E.
RACINE_TRANSITOIRE_FX = "588"
COMPTE_GAIN_CHANGE = "712FX"
COMPTE_PERTE_CHANGE = "613FX"

# Placeholders résolus par l'appelant (l'annexe laisse le choix du compte de trésorerie).
PLACEHOLDER_TRESORERIE = "$TRESORERIE"
PLACEHOLDER_TRESORERIE_SOURCE = "$TRESORERIE_SOURCE"
PLACEHOLDER_CONTREPARTIE_CIBLE = "$CONTREPARTIE_CIBLE"
PLACEHOLDER_CANTONNEMENT = "$CANTONNEMENT"

CONDITION_GAIN = "GAIN"
CONDITION_PERTE = "PERTE"

# ------------------------------------------------- GRILLE DE CLASSIFICATION PAR
# (code, libellé, jours_min, jours_max, taux_provision, en_souffrance, ordre)
#
# VALEURS PAR DÉFAUT DE SECOURS uniquement (principe 8 : « le code ne contient que des
# mécanismes, jamais des seuils métier en dur »). Elles reprennent la gradation usuelle du
# provisionnement IMF (instruction BCC n° 1 sur le classement des crédits) mais N'ONT PAS
# ÉTÉ VALIDÉES par le fondateur : elles servent d'amorce au premier chargement, et se
# modifient ensuite en base (`ClasseRisque`, endpoint `provisions/classes`) sans
# redéploiement. Le rapport de livraison signale explicitement ce point d'arbitrage.
#
# Les bornes doivent couvrir [0, ∞[ sans trou ni recouvrement (contrôlé par
# `provisions.verifier_couverture`, verrouillé par un test).
CLASSES_RISQUE: list[tuple[str, str, int, int | None, str, bool, int]] = [
    ("SAIN",    "Crédits sains (retard < 30 j)",              0,   29,   "0.0100", False, 1),
    ("PAR30",   "Portefeuille à risque 30 j (30–89 j)",       30,  89,   "0.2500", False, 2),
    ("PAR90",   "Portefeuille à risque 90 j (90–179 j)",      90,  179,  "0.5000", True,  3),
    ("DOUTEUX", "Créances douteuses (≥ 180 j)",               180, None, "1.0000", True,  4),
]

# --------------------------------------------------------------------------- ANNEXE B
# code → {libelle, journal, description, lignes: [(ordre, sens, compte_racine,
#                                                   devise_regle, montant_ref, condition)]}
CATALOGUE: dict[str, dict] = {
    "B1": {
        "libelle": "Décaissement de crédit",
        "journal": "JCR",
        "description": "Mise à disposition du capital au client : l'encours sain naît au débit.",
        "lignes": [
            (1, "DEBIT", "413", "OPERATION", "capital", ""),
            (2, "CREDIT", PLACEHOLDER_TRESORERIE, "OPERATION", "capital", ""),
        ],
    },
    "B2": {
        "libelle": "Remboursement de crédit — capital",
        "journal": "JCR",
        "description": "Encaissement de la quote-part capital d'une échéance.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE, "OPERATION", "capital", ""),
            (2, "CREDIT", "413", "OPERATION", "capital", ""),
        ],
    },
    "B3": {
        "libelle": "Remboursement de crédit — intérêts",
        "journal": "JCR",
        "description": "Encaissement de la quote-part intérêts d'une échéance.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE, "OPERATION", "interets", ""),
            (2, "CREDIT", "701", "OPERATION", "interets", ""),
        ],
    },
    "B4": {
        "libelle": "Commission",
        "journal": "JCR",
        "description": "Commission de dossier ou de service encaissée.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE, "OPERATION", "commission", ""),
            (2, "CREDIT", "702", "OPERATION", "commission", ""),
        ],
    },
    "B5": {
        "libelle": "Déclassement PAR90 — passage en souffrance",
        "journal": "JCR",
        "description": "Transfert automatique 413 → 416 de l'encours restant dû (jamais manuel).",
        "lignes": [
            (1, "DEBIT", "416", "OPERATION", "encours", ""),
            (2, "CREDIT", "413", "OPERATION", "encours", ""),
        ],
    },
    "B6": {
        "libelle": "Dotation aux provisions pour risque de crédit (clôture)",
        "journal": "JOD",
        "description": "Encours × taux PAR paramétré. Le compte de dotation 691 concrétise le « 6xx » de l'annexe B.",
        "lignes": [
            (1, "DEBIT", "691", "OPERATION", "dotation", ""),
            (2, "CREDIT", "137", "OPERATION", "dotation", ""),
        ],
    },
    "B7": {
        "libelle": "Reprise de provision",
        "journal": "JOD",
        "description": "Ajustement à l'amélioration du risque. Le compte 791 concrétise le « 7xx » de l'annexe B.",
        "lignes": [
            (1, "DEBIT", "137", "OPERATION", "reprise", ""),
            (2, "CREDIT", "791", "OPERATION", "reprise", ""),
        ],
    },
    "B8": {
        "libelle": "Dépôt d'épargne",
        "journal": "JEP",
        "description": "L'épargne du membre est une dette de l'institution (412 au crédit).",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE, "OPERATION", "depot", ""),
            (2, "CREDIT", "412", "OPERATION", "depot", ""),
        ],
    },
    "B9": {
        "libelle": "Retrait d'épargne",
        "journal": "JEP",
        "description": "Extinction partielle de la dette d'épargne.",
        "lignes": [
            (1, "DEBIT", "412", "OPERATION", "retrait", ""),
            (2, "CREDIT", PLACEHOLDER_TRESORERIE, "OPERATION", "retrait", ""),
        ],
    },
    "B10": {
        "libelle": "Encaissement d'une souscription investisseur",
        "journal": "JIN",
        "description": "La souscription RÉSERVE ; c'est l'encaissement qui crée l'écriture. "
                       "Le crédit va au sous-compte de cantonnement de l'offre (419-OFF-xxxx).",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE, "OPERATION", "souscription", ""),
            (2, "CREDIT", PLACEHOLDER_CANTONNEMENT, "OPERATION", "souscription", ""),
        ],
    },
    "B11": {
        "libelle": "Décaissement vers le projet financé",
        "journal": "JIN",
        "description": "MONTAGE À VALIDER AVEC LE FONDATEUR (note annexe B). Le cantonnement "
                       "419-OFF reste l'invariant quel que soit le montage retenu.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_CANTONNEMENT, "OPERATION", "decaissement", ""),
            (2, "CREDIT", PLACEHOLDER_TRESORERIE, "OPERATION", "decaissement", ""),
        ],
    },
    "B12": {
        "libelle": "Encaissement d'un retour de projet",
        "journal": "JIN",
        "description": "MONTAGE À VALIDER AVEC LE FONDATEUR. Ventilation capital / rendement "
                       "selon l'échéancier de retour.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE, "OPERATION", "retour_total", ""),
            (2, "CREDIT", PLACEHOLDER_CANTONNEMENT, "OPERATION", "capital_rembourse", ""),
            (3, "CREDIT", "719", "OPERATION", "rendement", ""),
        ],
    },
    "B13": {
        "libelle": "Distribution aux investisseurs",
        "journal": "JIN",
        "description": "MONTAGE À VALIDER AVEC LE FONDATEUR. Prorata calculé DEPUIS la "
                       "comptabilité (soldes 419-OFF), jamais depuis une table parallèle.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_CANTONNEMENT, "OPERATION", "distribution", ""),
            (2, "CREDIT", PLACEHOLDER_TRESORERIE, "OPERATION", "distribution", ""),
        ],
    },
    "B14": {
        "libelle": "Change — jambe 1 (entrée dans le transitoire FX)",
        "journal": "JFX",
        "description": "Annexe E, étape 1 : la devise apportée entre en trésorerie, "
                       "la contrepartie va au transitoire 588FX dans CETTE devise.",
        "lignes": [
            (1, "DEBIT", PLACEHOLDER_TRESORERIE_SOURCE, "SOURCE", "montant_source", ""),
            (2, "CREDIT", "588", "SOURCE", "montant_source", ""),
        ],
    },
    "B15": {
        "libelle": "Change — jambe 2 (sortie du transitoire FX)",
        "journal": "JFX",
        "description": "Annexe E, étape 2 : le transitoire 588FX est débité dans la devise "
                       "CIBLE, la contrepartie métier est soldée dans cette même devise.",
        "lignes": [
            (1, "DEBIT", "588", "CIBLE", "montant_cible", ""),
            (2, "CREDIT", PLACEHOLDER_CONTREPARTIE_CIBLE, "CIBLE", "montant_cible", ""),
        ],
    },
    "B16": {
        "libelle": "Constat du gain ou de la perte de change",
        "journal": "JFX",
        "description": "Annexe E, étape 3 : l'écart entre la contre-valeur apportée et la "
                       "contre-valeur due se constate en 712FX (gain) ou 613FX (perte). "
                       "Les deux variantes cohabitent dans le schéma, filtrées par condition.",
        "lignes": [
            (1, "DEBIT", "588", "SOURCE", "ecart", CONDITION_GAIN),
            (2, "CREDIT", COMPTE_GAIN_CHANGE, "SOURCE", "ecart", CONDITION_GAIN),
            (3, "DEBIT", COMPTE_PERTE_CHANGE, "SOURCE", "ecart", CONDITION_PERTE),
            (4, "CREDIT", "588", "SOURCE", "ecart", CONDITION_PERTE),
        ],
    },
}
