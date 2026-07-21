/**
 * Petites briques de chrome partagées par les quatre sections de l'écran
 * « Données de référence ». Rien de métier ici : ni seuil, ni calcul, ni règle —
 * uniquement de la mise en forme (CLAUDE.md §5 « Frontend »).
 */
import React from 'react';

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`bg-white/5 border border-white/10 rounded-xl ${className}`}>{children}</div>
);

export const CardHead: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}> = ({ title, subtitle, right }) => (
  <div className="px-4 py-3 border-b border-white/10 flex items-start justify-between gap-3 flex-wrap">
    <div>
      <h2 className="font-semibold text-sm text-slate-200 uppercase tracking-wide">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-1 max-w-3xl">{subtitle}</p>}
    </div>
    {right && <div className="flex items-center gap-2">{right}</div>}
  </div>
);

export const Pill: React.FC<{ label: string; color: string; title?: string }> = ({
  label,
  color,
  title,
}) => (
  <span title={title} className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${color}`}>
    {label}
  </span>
);

/** Bouton d'action neutre. `busy` désactive et signale l'appel en cours. */
export const Btn: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  tone?: 'neutral' | 'primary' | 'danger';
  type?: 'button' | 'submit';
}> = ({ children, onClick, disabled, busy, title, tone = 'neutral', type = 'button' }) => {
  const tones: Record<string, string> = {
    neutral: 'bg-white/10 hover:bg-white/20 text-white',
    primary: 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30',
    danger: 'bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={`px-3 py-2 rounded-lg text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {busy ? 'En cours…' : children}
    </button>
  );
};

/**
 * Bandeau maker-checker : rend LISIBLE qui a proposé et qui peut activer.
 *
 * Le bouton d'activation reste rendu, désactivé, quand l'utilisateur connecté
 * est le maker : masquer purement le contrôle laisserait croire à une panne. Le
 * serveur re-vérifie de toute façon (`MAKER_EGAL_CHECKER` / `MAKER_CHECKER_VIOLATION`).
 */
export const MakerChecker: React.FC<{
  makerSub: string | null | undefined;
  makerLabel: string;
  isSelf: boolean;
  extra?: string;
}> = ({ makerSub, makerLabel, isSelf, extra }) => (
  <div className="text-xs rounded-lg px-3 py-2 border border-white/10 bg-black/20 text-slate-400 space-y-1">
    <p>
      <span className="text-slate-500">Proposé par </span>
      <span className="font-mono text-slate-300" title={makerSub || undefined}>{makerLabel}</span>
      {extra && <span className="text-slate-500"> · {extra}</span>}
    </p>
    <p className={isSelf ? 'text-amber-300' : 'text-slate-500'}>
      {isSelf
        ? 'Vous êtes l’auteur de cette proposition : son activation revient à un second '
          + 'administrateur (maker ≠ checker). Le serveur refuserait votre activation.'
        : 'Vous n’êtes pas l’auteur : vous pouvez activer (maker ≠ checker respecté).'}
    </p>
  </div>
);

/** Message d'information neutre — sert aussi à annoncer une lacune de contrat. */
export const Note: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' | 'ok' }> = ({
  children,
  tone = 'info',
}) => {
  const tones: Record<string, string> = {
    info: 'bg-white/5 border-white/10 text-slate-400',
    warn: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    ok: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
  };
  return <div className={`text-xs rounded-lg border px-3 py-2 leading-relaxed ${tones[tone]}`}>{children}</div>;
};

/** Liste de jetons (feuilles, rubriques, colonnes) — lecture seule. */
export const Tokens: React.FC<{ items: string[]; empty?: string; highlight?: string[] }> = ({
  items,
  empty = '—',
  highlight = [],
}) => {
  if (items.length === 0) return <span className="text-slate-500 text-xs">{empty}</span>;
  const hi = new Set(highlight);
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span
          key={it}
          className={`text-[11px] px-2 py-0.5 rounded font-mono ${
            hi.has(it) ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-slate-300'
          }`}
        >
          {it}
        </span>
      ))}
    </div>
  );
};
