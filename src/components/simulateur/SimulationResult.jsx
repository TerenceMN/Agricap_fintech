/**
 * Restitution de `POST /credits/simulate/` — affichage pur.
 *
 * Aucun chiffre métier n'est produit ici : score, éligibilité, taux, DSCR,
 * échéancier et lignage viennent tous de la réponse serveur. Le composant
 * n'affiche rien tant que le moteur n'a pas répondu (le fallback historique
 * qui fabriquait une note à partir du montant et de la superficie a été retiré).
 *
 * Réserve connue : `SCORE_BANDS` recopie une grille qui vit désormais en base
 * (`BaremeScore.DECISION.parametres.lettres`) et que le serveur sait servir —
 * `credits/analyse.py::score_lettre`, exposé en `scoreLettre` sur `analyse/` et
 * `analyse-resume/`. `simulate/` ne le sert pas encore : d'ici là, cette copie
 * reste nécessaire.
 *
 * ⚠ NE PAS « aligner » ces seuils sur les échelles 85/70/**55** en `>=` que l'on
 * trouve dans `scoring.py` et `dataio_simulator.py` : ce sont les bandes
 * d'ajustement du TAUX et de la note de valorisation, un concept distinct. La
 * grille de la LETTRE est bien 85/70/50 en `>` strict, bornes de la SPEC §6
 * conservées délibérément côté serveur (cf. `LETTRES_DEFAUT` et le test
 * `test_lettre_de_score` : 85 → B, 70 → C, 50 → D). Les valeurs ci-dessous sont
 * donc CORRECTES et identiques au moteur ; le défaut est la duplication, pas les
 * chiffres. Une version antérieure de ce commentaire prescrivait l'inverse.
 *
 * Le vrai correctif : que `simulate/` serve `scoreLettre` comme `analyse/`, puis
 * supprimer `SCORE_BANDS` — sinon cette copie dérivera le jour où le comité
 * recalibrera la grille en base, silencieusement.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { formatMontant } from '@/components/guarantees/format';

/**
 * Grille de classement du score — **une seule échelle** pour ce module.
 *
 * Lettre et couleur en dérivaient auparavant par deux ternaires distincts, à
 * vingt lignes d'écart : deux occasions de diverger pour une même règle. Elles
 * partagent désormais la même définition. Les seuils sont inchangés (le
 * réalignement sur le moteur est une tâche transverse, cf. en-tête).
 */
const SCORE_BANDS = [
  { min: 85, letter: 'A', color: '#34d399' },
  { min: 70, letter: 'B', color: '#60a5fa' },
  { min: 50, letter: 'C', color: '#fbbf24' },
  { min: -Infinity, letter: 'D', color: '#f87171' },
];

/** Bande d'un score serveur. Présentation d'un chiffre reçu, pas un calcul. */
const scoreBand = (score) => SCORE_BANDS.find(b => Number(score) > b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];

/** Lettre associée à un score serveur. Présentation, pas calcul de score. */
export const scoreLetterOf = (score) => scoreBand(score).letter;

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
  const { letter, color: scoreColor } = scoreBand(value);

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
        <span className="text-5xl font-black" style={{ color: scoreColor }}>{letter}</span>
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

/**
 * Échéancier prévisionnel COMPLET — toutes les échéances servies par le moteur.
 *
 * Plus de troncature à 6 lignes : le demandeur voit l'intégralité de son plan de
 * remboursement, en-tête figé et corps défilant au-delà de ~12 lignes pour ne
 * pas déborder la page. Les totaux (`scheduleTotals`) viennent du SERVEUR — le
 * front ne somme jamais l'échéancier (règle §5). Les mois en différé (principal
 * à 0, intérêts seuls) sont signalés d'un point pour que l'écart de mensualité
 * s'explique de lui-même.
 */
export const SchedulePreview = ({ simResult, currency }) => {
  const schedule = simResult?.scheduleDraft;
  if (!schedule?.length) return null;
  const totals = simResult?.scheduleTotals;
  const enDiffere = (row) => Number(row.principal) === 0;
  return (
    <div className="glass-effect p-5 rounded-2xl">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h4 className="font-bold text-white">Échéancier prévisionnel</h4>
        <span className="text-xs text-gray-500">{schedule.length} échéances</span>
      </div>
      <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-lg border border-white/5">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
            <tr className="text-gray-400 border-b border-white/10">
              <th className="text-left py-2 px-2">Mois</th>
              <th className="text-right py-2 px-2">Principal</th>
              <th className="text-right py-2 px-2">Intérêts</th>
              <th className="text-right py-2 px-2">Mensualité</th>
              <th className="text-right py-2 px-2">Solde</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => (
              <tr key={row.month} className="border-b border-white/5 text-gray-300 tabular-nums">
                <td className="py-1 px-2">
                  {row.month}
                  {enDiffere(row) && (
                    <span className="ml-1 text-[10px] text-amber-400/80" title="Différé : intérêts seuls, capital non encore amorti">•</span>
                  )}
                </td>
                <td className="py-1 px-2 text-right">{formatMontant(row.principal, '', { decimals: 0 })}</td>
                <td className="py-1 px-2 text-right text-amber-400">{formatMontant(row.interest, '', { decimals: 0 })}</td>
                <td className="py-1 px-2 text-right font-semibold text-emerald-400">
                  {formatMontant(row.payment, currency, { decimals: 0 })}
                </td>
                <td className="py-1 px-2 text-right text-gray-400">{formatMontant(row.balance, '', { decimals: 0 })}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="sticky bottom-0 bg-slate-900/95 backdrop-blur">
              <tr className="border-t border-white/15 text-white font-semibold tabular-nums">
                <td className="py-2 px-2">Total</td>
                <td className="py-2 px-2 text-right">{formatMontant(totals.totalPrincipal, '', { decimals: 0 })}</td>
                <td className="py-2 px-2 text-right text-amber-300">{formatMontant(totals.totalInterest, '', { decimals: 0 })}</td>
                <td className="py-2 px-2 text-right text-emerald-300">{formatMontant(totals.totalPayments, currency, { decimals: 0 })}</td>
                <td className="py-2 px-2 text-right text-gray-500">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
