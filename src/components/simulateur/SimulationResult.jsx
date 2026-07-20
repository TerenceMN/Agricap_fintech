/**
 * Restitution de `POST /credits/simulate/` — affichage pur.
 *
 * Aucun chiffre métier n'est produit ici : score, éligibilité, taux, DSCR,
 * échéancier et lignage viennent tous de la réponse serveur. Le composant
 * n'affiche rien tant que le moteur n'a pas répondu (le fallback historique
 * qui fabriquait une note à partir du montant et de la superficie a été retiré).
 *
 * Réserve connue et signalée : `scoreLetter` applique encore des seuils
 * (85/70/50) codés côté front. C'est la dernière règle métier résiduelle du
 * navigateur — elle doit descendre du serveur avec le score (cf. rapport lot 3).
 */
import React from 'react';
import { motion } from 'framer-motion';
import { formatMontant } from '@/components/guarantees/format';

/** Lettre associée à un score serveur. Présentation, pas calcul de score. */
export const scoreLetterOf = (score) => (score > 85 ? 'A' : score > 70 ? 'B' : score > 50 ? 'C' : 'D');

export const DonutChartScore = ({ score }) => {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  if (score == null || !Number.isFinite(Number(score))) {
    return (
      <div className="relative flex items-center justify-center w-48 h-48">
        <svg className="w-full h-full" viewBox="0 0 150 150" aria-hidden="true">
          <circle cx="75" cy="75" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="15" />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center px-6">
          <span className="text-sm text-gray-400">Score</span>
          <span className="text-4xl font-black text-gray-600">—</span>
          <span className="text-[11px] text-gray-500 mt-1">Lancez la simulation pour obtenir votre score</span>
        </div>
      </div>
    );
  }

  const value = Number(score);
  const offset = circumference - (value / 100) * circumference;
  const scoreColor = value > 85 ? '#34d399' : value > 70 ? '#60a5fa' : value > 50 ? '#fbbf24' : '#f87171';

  return (
    <div className="relative flex items-center justify-center w-48 h-48">
      <svg className="w-full h-full" viewBox="0 0 150 150" aria-hidden="true">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="15" />
        <motion.circle
          cx="75" cy="75" r={radius} fill="none" stroke={scoreColor} strokeWidth="15"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 75 75)"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-sm text-gray-400">Score</span>
        <span className="text-5xl font-black" style={{ color: scoreColor }}>{scoreLetterOf(value)}</span>
        <span className="font-bold">{value.toFixed(0)}/100</span>
      </div>
    </div>
  );
};

/** Détail par critère — barème non exposé, seuls les points le sont. */
export const ScoreBreakdown = ({ simResult }) => {
  if (!simResult?.breakdown?.length) return null;
  return (
    <div className="glass-effect p-5 rounded-2xl space-y-3">
      <h4 className="font-bold text-white mb-1">Analyse par critère</h4>
      {simResult.breakdown.map((c) => (
        <div key={c.code}>
          <div className="flex justify-between text-sm mb-1 gap-3">
            <span className="text-gray-300">{c.label}</span>
            <span className="font-semibold text-white shrink-0 tabular-nums">
              {c.points}/100{' '}
              <span className="text-gray-500 font-normal">
                × {Math.round(c.weight * 100)}% = {c.weightedScore.toFixed(1)} pts
              </span>
            </span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${c.points}%`,
                background: c.points >= 70 ? '#10b981' : c.points >= 50 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
          {c.detail && <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>}
        </div>
      ))}
      {simResult.refData && (
        <div className="mt-2 pt-2 border-t border-white/10 text-xs text-gray-500 space-y-0.5">
          <p>Référentiel : <span className="text-gray-400">{simResult.refData.source}</span></p>
          {simResult.refData.dscr && (
            <p>DSCR calculé : <span className="text-blue-300">{simResult.refData.dscr}</span></p>
          )}
          <p>
            Durée : {simResult.refData.durationMonths} mois · Différé :{' '}
            {simResult.refData.deferredMonths} mois · Taux :{' '}
            {(simResult.refData.rateAnnual * 100).toFixed(1)} %/an
          </p>
        </div>
      )}
      {simResult.needsSource?.revision != null && (
        <p className="text-[11px] text-gray-600 pt-1">
          Simulation calculée sur la révision {simResult.needsSource.revision} de votre feuille de
          besoins{simResult.needsSource.sha256
            ? ` (empreinte ${String(simResult.needsSource.sha256).slice(0, 12)}…)`
            : ''}.
        </p>
      )}
    </div>
  );
};

/** Échéancier prévisionnel : les 6 premières lignes servies par le moteur. */
export const SchedulePreview = ({ simResult, currency }) => {
  const schedule = simResult?.scheduleDraft;
  if (!schedule?.length) return null;
  return (
    <div className="glass-effect p-5 rounded-2xl overflow-x-auto">
      <h4 className="font-bold text-white mb-3">Échéancier prévisionnel</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-white/10">
            <th className="text-left pb-2">Mois</th>
            <th className="text-right pb-2">Principal</th>
            <th className="text-right pb-2">Intérêts</th>
            <th className="text-right pb-2">Mensualité</th>
            <th className="text-right pb-2">Solde</th>
          </tr>
        </thead>
        <tbody>
          {schedule.slice(0, 6).map((row) => (
            <tr key={row.month} className="border-b border-white/5 text-gray-300 tabular-nums">
              <td className="py-1">{row.month}</td>
              <td className="py-1 text-right">{formatMontant(row.principal, '', { decimals: 0 })}</td>
              <td className="py-1 text-right text-amber-400">{formatMontant(row.interest, '', { decimals: 0 })}</td>
              <td className="py-1 text-right font-semibold text-emerald-400">
                {formatMontant(row.payment, currency, { decimals: 0 })}
              </td>
              <td className="py-1 text-right text-gray-400">{formatMontant(row.balance, '', { decimals: 0 })}</td>
            </tr>
          ))}
          {schedule.length > 6 && (
            <tr className="text-gray-500 text-xs">
              <td colSpan={5} className="pt-2">
                … {schedule.length - 6} échéances supplémentaires · {schedule.length} au total
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
