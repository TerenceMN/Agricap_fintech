/**
 * Briques d'affichage de l'écran d'instruction. Volontairement autonomes : les
 * modules `analyse/` et `admin/credits/` appartiennent à d'autres agents, et une
 * dépendance à leur palette ferait de chacun de leurs remaniements une
 * régression ici.
 */
import React from 'react';

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => (
  <section className={`bg-white/5 border border-white/10 rounded-xl overflow-hidden ${className}`}>
    {children}
  </section>
);

export const CardHead: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ title, subtitle, right }) => (
  <header className="flex flex-wrap items-start justify-between gap-3 p-4 border-b border-white/10">
    <div className="min-w-0">
      <h3 className="text-white font-semibold">{title}</h3>
      {subtitle && (
        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">{subtitle}</p>
      )}
    </div>
    {right && <div className="shrink-0">{right}</div>}
  </header>
);

export type Tone = 'neutre' | 'info' | 'attention' | 'alerte' | 'ok';

const TONES: Record<Tone, string> = {
  neutre: 'text-slate-300 bg-slate-500/20 border-slate-400/20',
  info: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
  attention: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  alerte: 'text-red-300 bg-red-500/15 border-red-500/30',
  ok: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
};

export const Pill: React.FC<{ label: string; tone?: Tone; title?: string }> = ({
  label, tone = 'neutre', title,
}) => (
  <span
    title={title}
    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${TONES[tone]}`}
  >
    {label}
  </span>
);

export const Note: React.FC<{ children: React.ReactNode; tone?: Tone; title?: string }> = ({
  children, tone = 'neutre', title,
}) => (
  <div className={`border rounded-lg p-3 text-xs leading-relaxed ${TONES[tone]}`}>
    {title && <p className="font-semibold mb-1">{title}</p>}
    {children}
  </div>
);

/**
 * Grandeur affichée AVEC sa base : §4.6 — pas de moyenne sans effectif, pas de
 * pourcentage sans base. `base` n'est pas décorative, elle est obligatoire dès
 * qu'un chiffre pourrait être lu hors contexte.
 */
export const Grandeur: React.FC<{
  label: string;
  valeur: string;
  base?: React.ReactNode;
  tone?: 'blanc' | 'ambre' | 'rouge' | 'vert';
}> = ({ label, valeur, base, tone = 'blanc' }) => {
  const couleur = {
    blanc: 'text-white', ambre: 'text-amber-300', rouge: 'text-red-300', vert: 'text-emerald-300',
  }[tone];
  return (
    <div className="bg-slate-900/50 rounded-lg p-3 border border-white/5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-bold mt-0.5 tabular-nums ${couleur}`}>{valeur}</p>
      {base && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{base}</p>}
    </div>
  );
};

export const Champ: React.FC<{
  id: string;
  label: string;
  aide?: string;
  children: React.ReactNode;
}> = ({ id, label, aide, children }) => (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-xs font-medium text-slate-300">{label}</label>
    {children}
    {aide && <p className="text-[11px] text-slate-500 leading-relaxed">{aide}</p>}
  </div>
);

export const classeChamp =
  'w-full bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white '
  + 'focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50';

export const Bouton: React.FC<{
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primaire' | 'neutre' | 'discret';
  type?: 'button' | 'submit';
  children: React.ReactNode;
}> = ({ onClick, busy, disabled, variant = 'neutre', type = 'button', children }) => {
  const styles = {
    primaire: 'bg-emerald-600/90 hover:bg-emerald-600 text-white',
    neutre: 'bg-white/10 hover:bg-white/20 text-white',
    discret: 'bg-transparent hover:bg-white/10 text-slate-300 border border-white/10',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={`px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${styles}`}
    >
      {busy ? 'En cours…' : children}
    </button>
  );
};
