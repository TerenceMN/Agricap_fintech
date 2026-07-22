import { PROJECT_STATUS_CODES } from './investorSpaceData';

// ==========================================
// SUBSCRIPTION -> COMMITMENT ADAPTER
// ==========================================

const SUBSCRIPTION_STATUS_LABEL = {
  PENDING: 'Pending', ACTIVE: 'Active', REPAYMENT: 'Repayment',
  COMPLETED: 'Completed', DEFAULTED: 'Defaulted', CANCELLED: 'Cancelled',
};

/** Assemble les souscriptions réelles (`api.investments.subscriptions.*`) + leurs offres
 * + projets en objets "commitment" au format attendu par l'UI existante (statuts en
 * Title Case, maturité dérivée de la date de souscription + durée de l'offre). */
export const buildCommitments = (subscriptions = [], offers = [], projects = []) => {
  return subscriptions.map((s) => {
    const offer = offers.find((o) => o.id === s.offerId);
    const project = offer ? projects.find((p) => p.id === offer.projectId) : null;
    let expectedMaturity = null;
    if (offer?.maturityMonths) {
      const d = new Date(s.subscriptionDate);
      d.setMonth(d.getMonth() + offer.maturityMonths);
      expectedMaturity = d.toISOString().split('T')[0];
    }
    return {
      id: `SUB-${s.id}`,
      subscriptionId: s.id,
      offerId: s.offerId,
      offerCode: offer?.code ?? null,
      typeOfTitle: offer?.typeOfTitle ?? null,
      projectId: project?.id ?? offer?.projectId ?? null,
      projectCode: project?.code ?? null,
      projectName: project?.title || (offer ? `Offre ${offer.code}` : `Offre #${s.offerId}`),
      promoter: project?.promoter ?? null,
      managerSub: project?.managerSub ?? null,
      investorId: s.investorId,
      amount: s.amount,
      bonds: s.bonds,
      subscriptionDate: s.subscriptionDate,
      expectedMaturity,
      status: SUBSCRIPTION_STATUS_LABEL[s.status] || s.status,
      couponRate: s.couponRate,
      nextPaymentDate: s.nextPaymentDate,
      totalReceived: s.totalReceived,
    };
  });
};

// ==========================================
// MÉTRIQUES DE PORTEFEUILLE — DÉLIBÉRÉMENT ABSENTES D'ICI
// ==========================================
//
// `calculatePortfolioMetrics` et `calculatePortfolioHealth` vivaient ici. Elles
// recomposaient dans le navigateur le total investi, la valeur du portefeuille,
// le « TRI pondéré », le taux de défaut, l'indice de concentration et un score de
// santé — à partir de constantes locales (2 % par point de défaut, −10 au-delà de
// 30 % de concentration) qui n'existaient nulle part ailleurs dans le système.
// Deux conséquences, l'une pire que l'autre :
//
//   - le « TRI pondéré » était une moyenne de taux AFFICHÉS, pas un XIRR : un
//     chiffre qui porte le nom d'un autre ;
//   - la valeur du portefeuille était extrapolée (`monthsElapsed × coupon`), donc
//     un gain latent présenté sans être étiqueté latent.
//
// Ces grandeurs sont désormais calculées par `backend/investments/metrics.py`
// (annexe D) sur flux datés réels, et servies par `GET /investments/metrics/mine`.
// Les projections d'affichage vivent dans `src/lib/investorSpaceWire.ts`.
// Ne réintroduisez pas de calcul financier dans ce fichier.

// ==========================================
// STATUS CODE HELPERS
// ==========================================

export const getStatusBadgeClass = (statusCode) => {
  return PROJECT_STATUS_CODES[statusCode]?.color || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
};

export const getStatusLabel = (statusCode) => {
  return PROJECT_STATUS_CODES[statusCode]?.label || statusCode;
};

export const isProjectInvestable = (statusCode) => {
  return ['P06'].includes(statusCode);
};

// ==========================================
// DATE & CURRENCY HELPERS
// ==========================================

export const formatCurrency = (amount, currency = 'USD') => {
  // `0` reste `0 $` : un montant nul est une information, pas une absence. Seuls
  // l'absence réelle et le non-numérique donnent un tiret — sans ce garde, un
  // champ manquant faisait planter l'écran entier sur `.toLocaleString`.
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  if (currency === 'USD') {
    return `${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} $`;
  }
  return `${amount.toLocaleString()} ${currency}`;
};

export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const calculateMonthsRemaining = (maturityDate) => {
  const now = new Date();
  const maturity = new Date(maturityDate);
  const months = Math.max(0, Math.floor((maturity - now) / (1000 * 60 * 60 * 24 * 30)));
  return months;
};

export const calculateDaysRemaining = (targetDate) => {
  const now = new Date();
  const target = new Date(targetDate);
  const days = Math.max(0, Math.floor((target - now) / (1000 * 60 * 60 * 24)));
  return days;
};

// ==========================================
// RISK SCORING
// ==========================================

export const getRiskLabel = (riskScore) => {
  if (riskScore <= 3) return { label: 'Faible', color: 'text-green-400', bg: 'bg-green-500/20' };
  if (riskScore <= 5) return { label: 'Modéré', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
  if (riskScore <= 7) return { label: 'Élevé', color: 'text-orange-400', bg: 'bg-orange-500/20' };
  return { label: 'Très Élevé', color: 'text-red-400', bg: 'bg-red-500/20' };
};

export const getRiskFlagColor = (riskFlag) => {
  const colors = {
    'Low': 'text-green-400 bg-green-500/20',
    'Medium': 'text-yellow-400 bg-yellow-500/20',
    'High': 'text-red-400 bg-red-500/20',
  };
  return colors[riskFlag] || 'text-gray-400 bg-gray-500/20';
};

// ==========================================
// COMMITMENT STATUS HELPERS
// ==========================================

export const getCommitmentStatusColor = (status) => {
  const colors = {
    'Active': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'Repayment': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'Completed': 'bg-green-600/20 text-green-400 border-green-600/30',
    'Defaulted': 'bg-red-500/20 text-red-400 border-red-500/30',
    'Pending': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  return colors[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
};

// Les transformateurs d'exposition sectorielle et géographique ont été retirés
// avec les graphiques qu'ils alimentaient : ils agrégeaient les montants par
// secteur et par zone côté navigateur, à côté d'un indice de concentration
// calculé localement. Le serveur mesure déjà la concentration (Herfindahl) — mais
// au niveau institution seulement. Tant qu'il ne la sert pas par investisseur,
// l'espace investisseur affiche l'absence de la mesure plutôt qu'une mesure
// maison (`MISSING_INVESTOR_METRICS` dans `investorSpaceWire.ts`).