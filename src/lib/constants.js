export const STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_VALIDATION: 'pending_validation',
  APPROVED: 'approved',
  POSTED: 'posted',
  REJECTED: 'rejected',
  REVERSED: 'reversed',
};

export const STATUS_LABELS = {
  [STATUS.DRAFT]: { label: 'Brouillon', color: 'bg-slate-500/20 text-slate-400' },
  [STATUS.SUBMITTED]: { label: 'Soumis', color: 'bg-blue-500/20 text-blue-400' },
  [STATUS.PENDING_VALIDATION]: { label: 'En attente', color: 'bg-yellow-500/20 text-yellow-400' },
  [STATUS.APPROVED]: { label: 'Approuvé', color: 'bg-emerald-500/20 text-emerald-400' },
  [STATUS.POSTED]: { label: 'Comptabilisé', color: 'bg-purple-500/20 text-purple-400' },
  [STATUS.REJECTED]: { label: 'Rejeté', color: 'bg-red-500/20 text-red-400' },
  [STATUS.REVERSED]: { label: 'Extourné', color: 'bg-orange-500/20 text-orange-400' },
};