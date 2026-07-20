// Libellés lisibles pour les codes d'action du journal d'audit (`agency.suspend`,
// `fx.set_rate`, ...) — affichés bruts jusqu'ici dans Supervision.jsx/AuditLog.jsx/
// ApiPartners.jsx. Centralisé ici pour que les 3 pages restent cohérentes entre elles.
const ACTION_LABELS = {
    'agency.create': "Création d'agence",
    'agency.suspend': "Suspension d'agence",
    'agency.close': "Fermeture d'agence",
    'agency.unlock_temporary': "Déverrouillage d'agence",
    'agency.reopen': "Réouverture d'agence",
    'agency.evolve_type': "Évolution du type d'agence",
    'agency.reconciliation.open': "Ouverture d'un rapprochement",
    'agency.reconciliation.assign': "Assignation d'un rapprochement",
    'agency.reconciliation.complete': "Clôture d'un rapprochement",
    'agency_action_request.create': "Demande d'action sur agence",
    'agency_action_request.approve': "Approbation d'action sur agence",
    'agency_action_request.reject': "Rejet d'action sur agence",

    'assets.create': "Ajout d'un actif/garantie",

    'caisses.adjust': "Ajustement de trésorerie",
    'caisses.convert': "Conversion de devise (portefeuille)",
    'caisses.create_account': "Création d'un compte de trésorerie",
    'caisses.deposit': "Dépôt sur portefeuille",
    'caisses.transfer': "Transfert entre comptes de trésorerie",
    'caisses.withdraw': "Retrait de portefeuille",

    'contract.sign': "Signature de contrat",

    'fx.set_rate': "Mise à jour du taux de change",

    'investments.subscribe': "Souscription à une offre d'investissement",
    'investments.performance_report.submit': "Soumission d'un rapport de performance",
    'investments.project.create': "Création d'un projet d'investissement",
    'investments.project.transition': "Changement de statut d'un projet",
    'investments.offer.create': "Création d'une offre d'investissement",

    'kyc.validate': "Validation KYC",

    'ledger.post_entry': "Écriture comptable",
    'ledger.reverse_entry': "Contre-passation d'écriture",

    'partner.sync': "Synchronisation partenaire",
    'partner.test': "Test de connexion partenaire",
    'partner.configure': "Configuration d'un partenaire",

    'portfolio.client_application.submit': "Soumission d'une demande de crédit",
    'portfolio.subwallet.pay': "Paiement depuis un sous-portefeuille",
    'portfolio.subwallet.rebalance': "Rééquilibrage de sous-portefeuille",

    'rbac.role.create': "Création d'un rôle",
    'rbac.role.update': "Modification d'un rôle",
    'rbac.user.update': "Modification d'un utilisateur",

    'savings.plan.create': "Création d'un plan d'épargne",
    'savings.plan.deposit': "Dépôt sur plan d'épargne",
    'savings.group.create': "Création d'un groupe d'épargne",
    'savings.group.update': "Modification d'un groupe d'épargne",
    'savings.group.integration_decision': "Décision d'adhésion à un groupe",

    'special_case.escalate': "Escalade d'un cas spécial",

    'support.ticket.create': "Création d'un ticket support",
    'support.ticket.update': "Mise à jour d'un ticket support",

    'transaction.create': "Création de transaction",
    'transaction.approve': "Approbation de transaction",
    'transaction.post': "Comptabilisation de transaction",
    'transaction.reject': "Rejet de transaction",
    'transaction.reverse': "Annulation de transaction",

    'alert.acknowledge': "Acquittement d'alerte",
    'alert.resolve': "Résolution d'alerte",
    'alert_rule.create': "Création d'une règle d'alerte",
    'alert_rule.update': "Modification d'une règle d'alerte",
};

// Un code non répertorié (nouveau type d'action ajouté côté backend sans mise à jour de
// cette table) se rabat sur un formatage automatique plutôt que d'afficher le code brut :
// "special_case.escalate" -> "Special case escalate".
const humanizeFallback = (action) => {
    const words = action.replace(/[._]/g, ' ').split(' ').filter(Boolean);
    return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
};

export const formatAuditAction = (action) => ACTION_LABELS[action] || humanizeFallback(action || '');

// Traduction des clés techniques les plus fréquentes dans `AuditEntry.details` (varie par
// type d'action — pas de schéma unique) : affiché brut jusqu'ici (`{"fields":["threshold"]}`).
const DETAIL_KEY_LABELS = {
    reason: 'Motif', document: 'Document', amount: 'Montant', currency: 'Devise',
    from: 'De', to: 'Vers', fields: 'Champs modifiés', code: 'Code', metric: 'Métrique',
    newType: 'Nouveau type', agency: 'Agence', periodStart: 'Début de période',
    periodEnd: 'Fin de période', deltaAmount: 'Écart constaté', note: 'Note',
    assignedTo: 'Assigné à', name: 'Nom', baseUrl: 'URL de test', ok: 'Résultat',
    auto_validated: 'Validation automatique', needed: 'Approbations requises',
    actionType: "Type d'action", total: 'Total', status: 'Statut',
};

const FIELD_NAME_LABELS = { threshold: 'seuil', enabled: 'activée', severity: 'sévérité', operator: 'opérateur' };

const formatDetailValue = (key, value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (Array.isArray(value)) {
        return key === 'fields' ? value.map(f => FIELD_NAME_LABELS[f] || f).join(', ') : value.join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

// Résumé lisible de `AuditEntry.details` — une ligne "Clé : valeur" par champ, clés
// traduites en français, plutôt que le JSON brut.
export const formatAuditDetails = (details) => {
    if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return '—';
    return Object.entries(details)
        .map(([key, value]) => `${DETAIL_KEY_LABELS[key] || key} : ${formatDetailValue(key, value)}`)
        .join(' · ');
};
