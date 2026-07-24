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
    "B17": {
        "libelle": "Reclassement en encours sain (retour à bonne fin)",
        "journal": "JCR",
        "description": "EXTENSION HORS ANNEXE B — symétrique de B5 (416 → 413). L'annexe ne "
                       "prévoit que l'aller : un crédit revenu sain restait indéfiniment en "
                       "souffrance au grand livre, ce qui surévalue le PAR comptable. Le "
                       "schéma inverse est mécanique (mêmes comptes, sens permutés) et ne "
                       "détourne PAS la contrepassation, qui corrige une erreur et non un "
                       "événement économique. Le code « B17 » est celui pressenti par la "
                       "dette signalée dans `tests_provisions`. À faire entrer dans l'annexe "
                       "B lors de sa prochaine révision.",
        "lignes": [
            (1, "DEBIT", "413", "OPERATION", "encours", ""),
            (2, "CREDIT", "416", "OPERATION", "encours", ""),
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


# ------------------------------------------------- CONSOMMATION DES ÉVÉNEMENTS MÉTIER
#: Source des événements consommés par `accounting.consommation` (file append-only
#: `investments.InvestmentEvent`, champs `consumed_at` / `journal_reference`).
SOURCE_INVESTISSEMENT = "investments.InvestmentEvent"

#: File du CRÉDIT (B1→B4). Ce littéral duplique volontairement
#: `credits.events.SOURCE_CREDIT` : importer l'app productrice ICI créerait une dépendance
#: au CHARGEMENT de la comptabilité sur une app qui, elle, ne doit rien savoir de nous.
#: La synchronisation des deux constantes est verrouillée par un test
#: (`tests_consommation.ContratDesFilesProductricesTests`), pas par un import.
SOURCE_CREDIT = "credits.CreditEvent"

#: File de l'ÉPARGNE (B8/B9). Même parti pris que ci-dessus : duplication assumée de
#: `savings.events.SOURCE_EPARGNE`, synchronisation verrouillée par un test.
SOURCE_EPARGNE = "savings.SavingsEvent"

# (code, modele, libellé, préfixe de référence, note)
#
# Les FILES d'événements métier que la comptabilité lit. Amorce uniquement : la table
# `SourceEvenements` est le paramétrage vivant, et déclarer une nouvelle file est un geste
# d'exploitation (`manage.py parametrer_consommation source …`), pas un déploiement.
#
SOURCES_EVENEMENTS: list[tuple[str, str, str, str, str]] = [
    (
        SOURCE_INVESTISSEMENT, "", "File des événements d'investissement (B10→B13)", "INV",
        "File append-only produite par `investments.funding`. La comptabilité y écrit "
        "« consumed_at » et « journal_reference », et rien d'autre.",
    ),
    (
        SOURCE_CREDIT, "", "File des événements de crédit (B1→B4)", "CRE",
        "File append-only produite par `credits.events`. Un fait = un événement = UN "
        "montant : une échéance encaissée produit deux lignes de file (capital B2, "
        "intérêts B3), jamais un total à ventiler.",
    ),
    (
        SOURCE_EPARGNE, "", "File des événements d'épargne (B8/B9)", "EPA",
        "File append-only produite par `savings.events`. Deux types distincts pour les deux "
        "sens : un retrait s'émet avec un montant POSITIF, le sens vient du schéma B9.",
    ),
]

#: Compte de trésorerie par DÉFAUT des schémas B10→B13, qui laissent le choix 501/511/53x.
#:
#: ARBITRAGE SIGNALÉ AU FONDATEUR (cf. rapport) : l'annexe B écrit littéralement
#: « 501/511 » pour l'encaissement d'une souscription, mais la décision « une seule
#: porte » fait venir cet argent du PORTEFEUILLE du souscripteur (`caisses`), pas d'un
#: versement externe. Économiquement, la contrepartie d'un encaissement de souscription
#: est alors l'extinction d'une dette de portefeuille, pas une entrée de caisse — le
#: cash, lui, était déjà entré au moment de l'alimentation du wallet. On retient ici le
#: compte littéral de l'annexe (511) et on rend le choix PARAMÉTRABLE EN BASE
#: (`RegleConsommation.compte_tresorerie`) : le corriger est une décision de
#: paramétrage, jamais un redéploiement.
COMPTE_TRESORERIE_DEFAUT = "511"

#: Contrepartie d'amorce des flux INTERNES — ceux dont le producteur affirme, preuve à
#: l'appui, qu'AUCUN cash ne bouge (décision « une seule porte » : un dépôt d'épargne
#: débite le PORTEFEUILLE du membre, dont l'argent était entré plus tôt).
#:
#: Débiter 501/511/53x pour un tel flux compterait deux fois le même franc en trésorerie et
#: fausserait le rapprochement mobile money dans les deux sens. L'annexe A ne porte pas
#: encore de compte « dette de portefeuille client » : en attendant l'arbitrage du
#: fondateur, la contrepartie va au TRANSITOIRE d'opérations internes (581), dont le solde
#: est censé tendre vers zéro — un 581 qui gonfle est exactement le signal visible qu'il
#: faut, au lieu d'une fausse entrée de caisse invisible.
#:
#: La dette 412 (épargne des membres), elle, est enregistrée JUSTE : c'est le côté qui
#: compte pour le bilan et pour le membre. Ne rien écrire du tout serait pire.
COMPTE_CONTREPARTIE_INTERNE = "581"

# (source, type_evenement, mode, schema, evenement_origine, compte_tresorerie, note)
#
# VALEURS D'AMORCE uniquement : la table `RegleConsommation` est le paramétrage vivant,
# et `seed_accounting` ne l'écrase JAMAIS après la première pose (même règle que la
# grille PAR — un mapping ajusté par le comptable ne se fait pas remettre d'usine).
REGLES_CONSOMMATION: list[tuple[str, str, str, str, str, str, str]] = [
    (
        SOURCE_INVESTISSEMENT, "SUBSCRIPTION_SETTLED", "PIECE", "B10", "",
        COMPTE_TRESORERIE_DEFAUT,
        "Annexe B10 : l'encaissement (jamais la réservation) crédite le sous-compte de "
        "cantonnement 419-OFF de l'offre.",
    ),
    (
        SOURCE_INVESTISSEMENT, "SUBSCRIPTION_REFUNDED", "CONTREPASSATION", "",
        "SUBSCRIPTION_SETTLED", "",
        "Annexe C, P13 : « souscriptions remboursées (contrepassation B10) ». On "
        "contrepasse la pièce B10 réellement passée pour CETTE souscription — jamais une "
        "écriture inverse reconstruite à la main, qui pourrait ne pas correspondre au "
        "montant encaissé.",
    ),
    (
        SOURCE_INVESTISSEMENT, "PROJECT_DISBURSED", "PIECE", "B11", "",
        COMPTE_TRESORERIE_DEFAUT,
        "Annexe B11 : le cantonnement de l'offre est débité au profit du promoteur.",
    ),
    (
        SOURCE_INVESTISSEMENT, "PROJECT_RETURN_RECEIVED", "PIECE", "B12", "",
        COMPTE_TRESORERIE_DEFAUT,
        "Annexe B12 : la ventilation capital / rendement est « selon l'échéancier ». Elle "
        "n'est PAS déductible du seul montant encaissé : tant que l'événement ne la porte "
        "pas (clés « capital_rembourse » et « rendement » de son payload), il reste en "
        "file — une écriture fausse est pire qu'une écriture absente.",
    ),
    (
        SOURCE_INVESTISSEMENT, "DISTRIBUTION_PAID", "PIECE", "B13", "",
        COMPTE_TRESORERIE_DEFAUT,
        "Annexe B13 : une pièce PAR LIGNE de distribution (l'événement est émis par "
        "bénéficiaire), ce qui rend la quote-part de chaque investisseur auditable pièce "
        "par pièce.",
    ),
    (
        SOURCE_INVESTISSEMENT, "PROJECT_DEFAULTED", "SANS_ECRITURE", "", "", "",
        "AUCUN schéma de l'annexe B ne couvre le défaut d'un projet d'investissement : "
        "B6/B7 provisionnent le risque de CRÉDIT (grille PAR sur `portfolio.Loan`), pas "
        "une créance de projet. L'événement reste donc en file, visible, jusqu'à ce que "
        "le fondateur arbitre le schéma de provisionnement des projets (base de calcul, "
        "compte de dotation, décote). Ne rien écrire est ici la seule réponse honnête.",
    ),
    # ------------------------------------------------------------------ CRÉDIT (B1→B4)
    #
    # Compte de trésorerie d'amorce : 511 (Banque). Ce n'est PAS un choix par défaut de
    # confort — c'est celui que l'autre grand livre du projet applique déjà au décaissement
    # (`credits.disbursement` porte DR 4121 / CR 5211, « banque principale »). Prendre un
    # compte différent ici ferait diverger deux comptabilités sur le MÊME fait, ce qui est
    # exactement l'incident de données que le principe 11 interdit. Le jour où les
    # décaissements passeront par la caisse (501) ou le mobile money (53x), le corriger est
    # un geste de paramétrage — ou l'événement portera « compteTresorerie » lui-même.
    (
        SOURCE_CREDIT, "CREDIT_DISBURSED", "PIECE", "B1", "", COMPTE_TRESORERIE_DEFAUT,
        "Annexe B1 : l'encours sain (413) naît au débit à la mise à disposition des fonds. "
        "Sans cet événement au grand livre, 413 restait muet et `provisions._declasser` "
        "refusait — à juste titre — de déclasser un encours qu'il ne voyait pas.",
    ),
    (
        SOURCE_CREDIT, "CREDIT_PRINCIPAL_REPAID", "PIECE", "B2", "", COMPTE_TRESORERIE_DEFAUT,
        "Annexe B2 : quote-part CAPITAL d'une échéance. Événement distinct de B3 — les deux "
        "ne mouvementent ni les mêmes comptes ni les mêmes classes, et un total « échéance "
        "encaissée » ne se ventile pas après coup.",
    ),
    (
        SOURCE_CREDIT, "CREDIT_INTEREST_COLLECTED", "PIECE", "B3", "", COMPTE_TRESORERIE_DEFAUT,
        "Annexe B3 : quote-part INTÉRÊTS d'une échéance, produit du compte 701.",
    ),
    (
        SOURCE_CREDIT, "CREDIT_COMMISSION_COLLECTED", "PIECE", "B4", "", COMPTE_TRESORERIE_DEFAUT,
        "Annexe B4 : commission de dossier ou de service, produit du compte 702.",
    ),
    # ----------------------------------------------------------------- ÉPARGNE (B8/B9)
    #
    # ARBITRAGE SIGNALÉ AU FONDATEUR — la contrepartie va au transitoire interne 581, pas à
    # 501/511/53x (cf. COMPTE_CONTREPARTIE_INTERNE). C'est la MÊME question que celle déjà
    # signalée pour B10 (encaissement de souscription), laissée à 511 par fidélité littérale
    # à l'annexe : les deux devraient être tranchées ENSEMBLE, et le jour où elles le seront,
    # c'est une commande, pas un déploiement :
    #     manage.py parametrer_consommation regle --source investments.InvestmentEvent \
    #         --type SUBSCRIPTION_SETTLED --tresorerie <compte> --par "dg"
    (
        SOURCE_EPARGNE, "SAVINGS_DEPOSITED", "PIECE", "B8", "", COMPTE_CONTREPARTIE_INTERNE,
        "Annexe B8 : l'épargne du membre est une DETTE de l'institution (412 au crédit) — "
        "c'est le côté qui compte, et il est juste. La contrepartie est le portefeuille du "
        "membre (flux interne), faute de compte dédié à l'annexe A : 581 la rend visible.",
    ),
    (
        SOURCE_EPARGNE, "SAVINGS_WITHDRAWN", "PIECE", "B9", "", COMPTE_CONTREPARTIE_INTERNE,
        "Annexe B9 : extinction partielle de la dette d'épargne. Le montant est POSITIF ; "
        "le sens vient du schéma, jamais du signe.",
    ),
]
