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
// PORTFOLIO METRICS CALCULATION
// ==========================================

/** Calcule les métriques de portefeuille à partir de données réelles (souscriptions +
 * projets déjà chargés par l'appelant depuis l'API) — ne lit plus de données mock. */
export const calculatePortfolioMetrics = (commitments = [], projects = [], availableCash = 0) => {
  const activeCommitments = commitments.filter(c => c.status === 'Active' || c.status === 'Repayment');
  
  const totalInvested = commitments.reduce((sum, c) => sum + c.amount, 0);
  const totalValue = commitments.reduce((sum, c) => {
    if (c.status === 'Completed') return sum + c.amount + c.totalReceived;
    if (c.status === 'Defaulted') return sum + c.totalReceived;
    // For active, estimate current value
    const monthsElapsed = Math.floor((new Date() - new Date(c.subscriptionDate)) / (1000 * 60 * 60 * 24 * 30));
    const estimatedInterest = c.amount * (c.couponRate / 100) * (monthsElapsed / 12);
    return sum + c.amount + estimatedInterest;
  }, 0);

  const weightedReturnRate = activeCommitments.length > 0
    ? activeCommitments.reduce((sum, c) => sum + c.couponRate * c.amount, 0) / activeCommitments.reduce((sum, c) => sum + c.amount, 0)
    : 0;

  const defaultedAmount = commitments.filter(c => c.status === 'Defaulted').reduce((sum, c) => sum + c.amount, 0);
  const defaultRate = totalInvested > 0 ? (defaultedAmount / totalInvested) * 100 : 0;

  // Next payment
  const upcomingPayments = activeCommitments
    .filter(c => c.nextPaymentDate)
    .sort((a, b) => new Date(a.nextPaymentDate) - new Date(b.nextPaymentDate));
  const nextPayment = upcomingPayments.length > 0 ? upcomingPayments[0] : null;

  // Average duration
  const avgDuration = activeCommitments.length > 0
    ? activeCommitments.reduce((sum, c) => {
        const remaining = Math.max(0, (new Date(c.expectedMaturity) - new Date()) / (1000 * 60 * 60 * 24 * 30));
        return sum + remaining;
      }, 0) / activeCommitments.length
    : 0;

  // Sector exposure
  const sectorExposure = {};
  commitments.forEach(c => {
    const project = projects.find(p => p.id === c.projectId);
    if (project) {
      sectorExposure[project.sector] = (sectorExposure[project.sector] || 0) + c.amount;
    }
  });

  // Geographic exposure
  const geoExposure = {};
  commitments.forEach(c => {
    const project = projects.find(p => p.id === c.projectId);
    if (project) {
      geoExposure[project.location] = (geoExposure[project.location] || 0) + c.amount;
    }
  });

  // Risk concentration (Herfindahl index)
  const totalActiveInvested = activeCommitments.reduce((sum, c) => sum + c.amount, 0);
  const riskConcentration = totalActiveInvested > 0
    ? activeCommitments.reduce((sum, c) => {
        const weight = c.amount / totalActiveInvested;
        return sum + weight * weight;
      }, 0) * 100
    : 0;

  return {
    totalInvested,
    totalValue,
    weightedReturnRate,
    defaultRate,
    availableCash,
    nextPayment,
    avgDuration,
    sectorExposure,
    geoExposure,
    riskConcentration,
    activeCount: activeCommitments.length,
    totalCount: commitments.length,
  };
};

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

// ==========================================
// CHART DATA TRANSFORMERS
// ==========================================

export const transformSectorExposure = (sectorExposure) => {
  return Object.entries(sectorExposure).map(([sector, amount]) => ({
    name: sector,
    value: amount,
  }));
};

export const transformGeoExposure = (geoExposure) => {
  return Object.entries(geoExposure).map(([location, amount]) => ({
    name: location,
    value: amount,
  }));
};

// ==========================================
// PORTFOLIO HEALTH SCORE
// ==========================================

export const calculatePortfolioHealth = (metrics) => {
  let score = 100;
  
  // Penalize high default rate
  score -= metrics.defaultRate * 2;
  
  // Penalize high concentration
  if (metrics.riskConcentration > 30) score -= 10;
  if (metrics.riskConcentration > 50) score -= 20;
  
  // Reward diversification
  const sectorCount = Object.keys(metrics.sectorExposure).length;
  if (sectorCount >= 4) score += 5;
  
  // Ensure between 0-100
  score = Math.max(0, Math.min(100, score));
  
  let status = 'Excellent';
  let color = 'text-green-400';
  if (score < 80) { status = 'Bon'; color = 'text-blue-400'; }
  if (score < 60) { status = 'Acceptable'; color = 'text-yellow-400'; }
  if (score < 40) { status = 'Préoccupant'; color = 'text-orange-400'; }
  if (score < 20) { status = 'Critique'; color = 'text-red-400'; }
  
  return { score, status, color };
};