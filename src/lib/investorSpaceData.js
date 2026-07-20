// Codes de statut réels des projets (P01..P13, `investments.Project.Status` côté backend)
// — libellés + couleurs utilisés par investorSpaceUtils.js (getStatusBadgeClass/getStatusLabel).
export const PROJECT_STATUS_CODES = {
  P01: { code: 'P01', label: 'Prospection', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  P02: { code: 'P02', label: 'Analyse Initiale', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  P03: { code: 'P03', label: 'Due Diligence', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  P04: { code: 'P04', label: 'Comité d\'Investissement', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  P05: { code: 'P05', label: 'Approbation Conditionnelle', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  P06: { code: 'P06', label: 'Levée de Fonds Active', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  P07: { code: 'P07', label: 'Souscription Clôturée', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  P08: { code: 'P08', label: 'Décaissement', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  P09: { code: 'P09', label: 'En Cours', color: 'bg-blue-600/20 text-blue-400 border-blue-600/30' },
  P10: { code: 'P10', label: 'Remboursement', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  P11: { code: 'P11', label: 'Clôturé avec Succès', color: 'bg-green-600/20 text-green-400 border-green-600/30' },
  P12: { code: 'P12', label: 'Défaut', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  P13: { code: 'P13', label: 'Annulé', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
};
