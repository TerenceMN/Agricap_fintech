import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
 
/**
 * Combines tailwind classes safely.
 * @param {...(string|undefined|null|false)} inputs - Class names to combine
 * @returns {string} - Combined class string
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a number as a currency string.
 * @param {number|string} amount - The amount to format
 * @param {string} [currency='USD'] - The currency code (e.g., 'USD', 'CDF', 'EUR')
 * @returns {string} - Formatted currency string
 */
export const formatCurrency = (amount, currency = 'USD') => {
  const num = Number(amount) || 0;
  if (currency === 'USD') {
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} $`;
  }
  return `${num.toLocaleString()} ${currency}`;
};

/**
 * Formats a date string or object into a specified format.
 * @param {string|Date} date - The date to format
 * @param {string} [format='MM/DD/YYYY'] - Target format (simple implementation for basic formats)
 * @returns {string} - Formatted date string
 */
export const formatDate = (date, format = 'MM/DD/YYYY') => {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Invalid Date';
  
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();

  if (format === 'DD/MM/YYYY') return `${day}/${month}/${year}`;
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  
  return `${month}/${day}/${year}`;
};

/**
 * Formats a value as a percentage.
 * @param {number|string} value - The numerical value
 * @returns {string} - Formatted percentage string
 */
export const formatPercentage = (value) => {
  const num = Number(value) || 0;
  return `${num.toFixed(1)}%`;
};

/**
 * Calculates the number of days remaining until a specific due date.
 * @param {string|Date} dueDate - The target due date
 * @returns {number} - Number of days remaining (0 if past due)
 */
export const calculateDaysUntilDue = (dueDate) => {
  if (!dueDate) return 0;
  const target = new Date(dueDate).getTime();
  const now = new Date().getTime();
  const diff = target - now;
  if (diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

/**
 * Returns a Tailwind color class based on status.
 * @param {string} status - The status string
 * @returns {string} - Tailwind color classes
 */
export const getStatusColor = (status) => {
  const normalized = String(status).toLowerCase();
  switch (normalized) {
    case 'active':
    case 'completed':
    case 'paid':
    case 'approved':
    case 'validated':
    case 'settled':
      return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30';
    case 'pending':
    case 'draft':
    case 'in validation':
    case 'in subscription':
      return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
    case 'cancelled':
    case 'defaulted':
    case 'rejected':
      return 'bg-red-500/20 text-red-500 border-red-500/30';
    case 'repayment':
    case 'in repayment':
      return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
};

/**
 * Returns a human-readable label for a given status.
 * @param {string} status - The raw status string
 * @returns {string} - Formatted label
 */
export const getStatusLabel = (status) => {
  if (!status) return 'Inconnu';
  const labels = {
    'active': 'Actif',
    'completed': 'Terminé',
    'paid': 'Payé',
    'pending': 'En attente',
    'draft': 'Brouillon',
    'validated': 'Validé',
    'cancelled': 'Annulé',
    'defaulted': 'En Défaut',
    'rejected': 'Rejeté',
    'in validation': 'En Validation',
    'in subscription': 'En Souscription',
    'in repayment': 'En Remboursement',
    'settled': 'Réglé'
  };
  return labels[String(status).toLowerCase()] || status;
};