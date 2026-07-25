/**
 * Cellules présentées de la vue « Caisses » — atomes SANS état ni réseau, donc
 * testables isolément (aucun `Layout`, aucun contexte, aucun portail Radix).
 *
 * Chaque montant passe par le formateur unique du projet (`formatMontant`, fr-FR,
 * devise portée par la donnée). Aucun « $ » ni pourcentage dérivé du niveau de
 * risque : la vue restitue des faits servis, elle n'en fabrique pas.
 */
import React from 'react';
import { AlertTriangle, Clock, Snowflake } from 'lucide-react';
import { formatMontant, formatDateFr } from '@/components/guarantees/format';
import type { CashRegisterSessionRow } from '@/types/api';
import type { CeilingGaugeState, Closure } from '@/pages/caissesWire';

/** Jauge de plafond journalier — trois états servis, jamais une jauge rassurante
 *  sans séance ouverte. */
export const CeilingGauge = ({
  gauge, currency,
}: { gauge: CeilingGaugeState; currency: string }): React.ReactElement => {
  if (gauge.kind === 'unlimited') {
    return <span className="text-xs text-slate-400">Non plafonné</span>;
  }
  if (gauge.kind === 'no-session') {
    return (
      <span className="text-xs text-slate-500" title="Le cumul journalier n'existe que pendant une séance ouverte.">
        Plafond non actif : aucune séance ouverte
      </span>
    );
  }
  const pct = Math.min(100, Math.max(0, Math.round(gauge.ratio * 100)));
  const barColor = gauge.over ? 'bg-red-500' : gauge.nearLimit ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="min-w-[9rem]">
      <div className="flex items-center justify-between text-xs">
        <span className={gauge.nearLimit ? 'text-amber-400' : 'text-slate-300'}>
          {formatMontant(gauge.used, currency)} / {formatMontant(gauge.ceiling, currency)}
        </span>
        {gauge.nearLimit && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

/** Séance de caisse OUVERTE — « ouverte depuis » ou « aucune séance ». */
export const SeanceCell = ({
  openSession,
}: { openSession: CashRegisterSessionRow | null }): React.ReactElement => {
  if (!openSession) return <span className="text-xs text-slate-500">Aucune séance</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <Clock className="w-3.5 h-3.5" />
      Ouverte depuis le {formatDateFr(openSession.openedAt)}
    </span>
  );
};

/** Dernier écart de clôture — met en avant le gel (`DISCREPANCY`). */
export const EcartGelCell = ({
  closure, currency,
}: { closure: Closure | null; currency: string }): React.ReactElement => {
  if (!closure) return <span className="text-xs text-slate-500">—</span>;
  if (closure.frozen) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400" title="Écart au-delà de la tolérance : caisse gelée.">
        <Snowflake className="w-3.5 h-3.5" />
        Gel · écart {formatMontant(closure.discrepancy, currency)}
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-400">
      Écart {formatMontant(closure.discrepancy, currency)}
    </span>
  );
};

const STATUS_STYLE: Record<string, string> = {
  ACTIF: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  EN_TRAITEMENT: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  EN_OBSERVATION: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  BLOQUE: 'text-red-400 border-red-500/30 bg-red-500/10',
  ARCHIVE: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIF: 'Actif', EN_TRAITEMENT: 'En traitement', EN_OBSERVATION: 'En observation',
  BLOQUE: 'Gelé', ARCHIVE: 'Archivé',
};

/** Badge de statut du compte — 5 valeurs servies, jamais devinées. */
export const CaisseStatusBadge = ({ status }: { status: string }): React.ReactElement => (
  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
    STATUS_STYLE[status] ?? 'text-slate-400 border-slate-500/30 bg-slate-500/10'}`}>
    {status === 'BLOQUE' && <Snowflake className="w-3 h-3" />}
    {STATUS_LABEL[status] ?? status}
  </span>
);
