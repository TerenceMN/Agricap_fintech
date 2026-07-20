/**
 * Statuts d'un dossier de crédit, tels que le CLIENT doit les lire.
 *
 * Les libellés du backoffice (« En analyse », « Ajourné ») décrivent le travail
 * de l'institution ; ceux-ci décrivent ce que le client doit comprendre et,
 * quand il y a lieu, ce qu'il peut faire. Un demandeur qui lit « Ajourné » ne
 * sait pas s'il doit attendre, refaire son dossier, ou appeler quelqu'un.
 *
 * Aucun statut n'est masqué : un dossier rejeté reste visible. C'est la trace
 * de sa démarche, et le motif du refus lui appartient.
 */

export const STATUTS_CLIENT = {
  draft: {
    label: 'Brouillon',
    couleur: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
    aide: "Cette demande n'a pas encore été envoyée.",
  },
  submitted: {
    label: 'Envoyée',
    couleur: 'text-blue-300 bg-blue-500/15 border-blue-500/30',
    aide: 'Votre demande est bien arrivée. Un analyste va la prendre en charge.',
  },
  in_analysis: {
    label: 'En cours d’examen',
    couleur: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
    aide: 'Un analyste étudie votre dossier. Aucune action de votre part.',
  },
  adjourned: {
    label: 'En attente d’informations',
    couleur: 'text-orange-300 bg-orange-500/15 border-orange-500/30',
    aide: 'Votre conseiller a besoin de précisions — contactez votre agence.',
  },
  approved: {
    label: 'Accordée',
    couleur: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    aide: 'Votre crédit est accordé. Le décaissement est en préparation.',
  },
  pending_disbursement: {
    label: 'Décaissement en cours',
    couleur: 'text-teal-300 bg-teal-500/15 border-teal-500/30',
    aide: 'Les fonds vont être versés sur votre portefeuille.',
  },
  active: {
    label: 'En cours de remboursement',
    couleur: 'text-green-300 bg-green-500/15 border-green-500/30',
    aide: 'Crédit actif — suivez vos échéances ci-dessus.',
  },
  closed: {
    label: 'Soldée',
    couleur: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
    aide: 'Ce crédit est intégralement remboursé.',
  },
  rejected: {
    label: 'Refusée',
    couleur: 'text-red-300 bg-red-500/15 border-red-500/30',
    aide: null, // le motif du refus est servi par le backend, il prime
  },
};

/** Un statut inconnu s'affiche tel quel, jamais rattaché au plus proche. */
export const statutClient = (code) =>
  STATUTS_CLIENT[code] || {
    label: code || '—',
    couleur: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
    aide: null,
  };

/** Dossiers encore en vie, à distinguer de l'historique. */
export const EN_COURS = new Set([
  'draft', 'submitted', 'in_analysis', 'adjourned',
  'approved', 'pending_disbursement', 'active',
]);
