/**
 * Briques d'affichage du Référentiel. Volontairement autonomes (pas d'emprunt à
 * la palette d'un autre écran dont le propriétaire diffère) : carte, en-tête,
 * pastille d'état, note contextuelle, bouton d'action léger.
 */
import React from 'react';

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => (
  <div className={`bg-white/5 border border-white/10 rounded-xl overflow-hidden ${className}`}>
    {children}
  </div>
);

export const CardHead: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}> = ({ title, subtitle, right }) => (
  <div className="flex items-start justify-between gap-3 p-4 border-b border-white/10">
    <div>
      <h3 className="text-white font-semibold">{title}</h3>
      {subtitle && <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">{subtitle}</p>}
    </div>
    {right && <div className="shrink-0">{right}</div>}
  </div>
);

export const Pill: React.FC<{ label: string; color?: string }> = ({
  label, color = 'text-slate-300 bg-slate-500/20',
}) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
    {label}
  </span>
);

export const Note: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' }> = ({
  children, tone = 'info',
}) => {
  const cls = tone === 'warn'
    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
    : 'bg-white/5 border-white/10 text-slate-400';
  return (
    <div className={`border rounded-lg p-3 text-xs leading-relaxed ${cls}`}>{children}</div>
  );
};

export const Btn: React.FC<{
  onClick?: () => void;
  busy?: boolean;
  children: React.ReactNode;
}> = ({ onClick, busy, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {busy ? '…' : children}
  </button>
);
