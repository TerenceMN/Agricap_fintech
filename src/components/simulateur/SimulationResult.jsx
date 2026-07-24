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
import { AlertTriangle, Building2, CheckCircle2, Info, Lock } from 'lucide-react';
import { formatMontant } from '@/components/guarantees/format';
// Blocs d'état déjà en service ailleurs (backoffice, instruction) : on les
// APPELLE plutôt que d'en écrire une variante. `toFieldErrors` déplie en prime
// un 422 structuré en une erreur par cause (principe 5), ce qu'une simple
// chaîne d'erreur ne saurait pas faire.
import { Empty, ErrorPanel, Loading, toFieldErrors } from '@/components/backoffice/States';
import { moduleConfig } from './modules';
import { construireRapport, syntheseNonEvalues } from './rapportCriteres';

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

/** Cadre commun du panneau — mêmes bordures pour le rapport, l'attente, l'erreur
 *  et le vide : un état dégradé qui change de forme se lit comme un bug. */
const CadreCriteres = ({ children }) => (
  <div className="glass-effect p-5 rounded-2xl space-y-3">
    <div className="flex items-baseline justify-between gap-3 flex-wrap">
      <h4 className="font-bold text-white">Ce que votre dossier fait examiner</h4>
      <span className="text-xs text-gray-500 flex items-center gap-1">
        <Lock className="w-3 h-3" aria-hidden="true" /> détail du calcul réservé à l'analyste
      </span>
    </div>
    {children}
  </div>
);

/**
 * Critères examinés — restitution CLIENT (principe 7, anti-gaming).
 *
 * CE QUI A ÉTÉ RETIRÉ ET POURQUOI. Ce panneau s'appelait `ScoreBreakdown` et
 * affichait, sur l'espace du DEMANDEUR : le poids de chaque critère
 * (`maxPoints` / `weight`), ses points pondérés, le nom du référentiel de
 * comparaison, le DSCR calculé, la durée, le différé et le taux annuel retenus.
 * C'est la carte du moteur. Le principe 7 l'interdit mot pour mot — « il ne voit
 * JAMAIS : les barèmes, les seuils, les tolérances par module, les plages du
 * référentiel » — et pour une raison concrète : un demandeur qui sait que
 * l'historique comportemental pèse 30 points et que le technique en pèse 25
 * n'améliore pas son projet, il déplace ses chiffres vers le critère le plus
 * rentable. Le détail chiffré vit désormais sur `/credit/dossiers/<code>/scoring`,
 * réservé au personnel.
 *
 * CE QUI A ÉTÉ AJOUTÉ, ET POURQUOI. Ce panneau se contentait auparavant de
 * marquer « — non évalué à ce stade » puis concluait : « votre agent AGRICAP
 * peut vous dire ce qui manque ». Il CONSTATAIT un vide et s'en déchargeait sur
 * un humain, sans jamais nommer ce qui manquait — le demandeur ne savait ni
 * quoi corriger, ni quoi fournir. Chaque critère porte désormais son rapport
 * (`rapportCriteres.construireRapport`) : évalué → sur quelles informations de
 * SON dossier ; non évalué → le fait, la cause et l'action (CLAUDE.md §4.6).
 * Et la liste de ce qui manque a remplacé le renvoi à l'agent, avec la
 * distinction qui compte : ce que le demandeur doit fournir, et ce qui relève
 * d'une configuration AGRICAP sur laquelle il n'a aucune prise.
 *
 * ⚠ Ne pas réintroduire `points`, `weight`, `maxPoints`, `detail`, `refData`,
 * `tarification` ni `proposedRate` ici : `detail` porte des phrases d'analyste
 * (« Écart moyen de 42 % au référentiel MAIS-v3 »), et `tarification` porte la
 * grille de taux. Ces trois blocs sont servis par le backend au même endpoint,
 * mais ils ne sont pas destinés à cet écran. Les motifs affichés sont RÉDIGÉS
 * dans `rapportCriteres.ts` à partir d'un code : aucune phrase du serveur ne
 * traverse cette frontière.
 *
 * `loading`, `error` et `onRetry` sont OPTIONNELS, et le typage le dit : les
 * appelants historiques ne passent que `simResult`. `onRetry` en particulier
 * n'est pas rendu obligatoire — un écran qui n'affiche jamais d'erreur n'a pas
 * à fournir un rappel factice, et un `onRetry={() => {}}` recopié partout
 * reproduirait exactement le cul-de-sac qu'une prop obligatoire prétendrait
 * interdire. Le bouton n'apparaît donc que lorsqu'une issue existe vraiment.
 *
 * @param {{
 *   simResult?: any,
 *   loading?: boolean,
 *   error?: unknown,
 *   onRetry?: (() => void) | null,
 * }} props
 */
export const CriteresClient = ({ simResult, loading = false, error = null, onRetry = null }) => {
  if (loading) {
    return (
      <CadreCriteres>
        <Loading label="Analyse de votre dossier en cours…" />
      </CadreCriteres>
    );
  }

  if (error) {
    return (
      <CadreCriteres>
        <ErrorPanel
          errors={toFieldErrors(error)}
          title="Le détail par critère n'a pas pu être chargé"
        />
        <p className="text-xs text-gray-500">
          Aucun critère n'est affiché plutôt qu'un rapport partiel — qui vous ferait corriger
          le mauvais point.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs text-emerald-300 underline underline-offset-2"
          >
            Relancer la simulation
          </button>
        )}
      </CadreCriteres>
    );
  }

  if (!simResult) return null;

  const rapport = construireRapport(simResult);
  if (!rapport) {
    return (
      <CadreCriteres>
        <Empty
          title={`Le moteur n'a renvoyé aucun critère pour cette simulation${
            simResult.unavailable?.message ? ` : ${simResult.unavailable.message}` : '.'}`}
          hint="Relancez la simulation une fois votre feuille de besoins déposée. Si le message persiste, votre agent AGRICAP peut faire instruire le dossier sans simulation."
        />
      </CadreCriteres>
    );
  }

  const synthese = syntheseNonEvalues(rapport);

  return (
    <CadreCriteres>
      <ul className="space-y-3">
        {rapport.lignes.map((ligne) => (
          <li key={ligne.code} className="text-sm">
            <div className="flex items-start gap-2">
              {ligne.evalue ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300/90" aria-hidden="true" />
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-gray-200">
                  {ligne.label}
                  <span className={ligne.evalue ? 'text-emerald-300/80' : 'text-amber-300/90'}>
                    {ligne.evalue ? ' — évalué' : ' — non évalué'}
                  </span>
                </p>
                <p className="text-xs text-gray-400">{ligne.fondement}</p>
                {ligne.motif && (
                  <div className="text-xs space-y-0.5 border-l-2 border-amber-400/30 pl-2">
                    <p className="text-amber-100/90">{ligne.motif.fait}</p>
                    <p className="text-gray-400">
                      <span aria-hidden="true">→ </span>{ligne.motif.action}
                    </p>
                  </div>
                )}
                {!ligne.evalue && !ligne.motif && (
                  <p className="text-xs text-gray-500 border-l-2 border-white/10 pl-2">
                    Le motif précis n'est pas restitué par la simulation. Il sera repris à
                    l'instruction de votre dossier.
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {synthese && <p className="text-xs text-gray-400 pt-1">{synthese}</p>}

      {/* La liste qui remplace « votre agent peut vous dire ce qui manque ». */}
      {rapport.manquantsDossier.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-200 uppercase tracking-wide">
            Ce qu'il manque à votre dossier
          </p>
          <ul className="space-y-2">
            {rapport.manquantsDossier.map((motif) => (
              <li key={motif.code} className="text-xs text-amber-100/90">
                <span className="block">{motif.fait}</span>
                <span className="block text-gray-300 mt-0.5">
                  <span aria-hidden="true">→ </span>{motif.action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Séparé du bloc précédent, et jamais confondu avec lui : envoyer un
          demandeur corriger un dossier complet parce qu'un référentiel AGRICAP
          manque est une fausse piste, pas une pédagogie. */}
      {rapport.manquantsInstitution.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            Ce qui ne dépend pas de vous
          </p>
          <ul className="space-y-2">
            {rapport.manquantsInstitution.map((motif) => (
              <li key={motif.code} className="text-xs text-gray-300">
                <span className="block">{motif.fait}</span>
                <span className="block text-gray-400 mt-0.5">
                  <span aria-hidden="true">→ </span>{motif.action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* §4.6 — incertitude assumée : une comparaison faite contre une plage
          encore indicative ne vaut pas une plage apprise sur des centaines de
          dossiers, et l'écran le dit. */}
      {rapport.reserves.map((reserve) => (
        <p key={reserve} className="text-xs text-gray-500 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{reserve}</span>
        </p>
      ))}

      <p className="text-xs text-gray-500">
        Votre score global et sa lettre sont affichés ci-dessus. Le détail du calcul — poids de
        chaque critère, barèmes, plages de référence — relève de l'instruction du dossier par
        AGRICAP.
      </p>
      {simResult.needsSource?.revision != null && (
        <p className="text-[11px] text-gray-600 pt-1">
          Simulation calculée sur la révision {simResult.needsSource.revision} de votre feuille de
          besoins{simResult.needsSource.sha256
            ? ` (empreinte ${String(simResult.needsSource.sha256).slice(0, 12)}…)`
            : ''}.
        </p>
      )}
    </CadreCriteres>
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
/**
 * Plan de financement par module RETENU PAR LE MOTEUR (contrat §1).
 *
 * Restitution pure de `simResult.moduleFinancing` : chaque ligne porte le coût
 * lu du fichier (`coutFichier`, en lecture seule — c'est un cadenas, pas un
 * champ), la part demandée en % (`pct`, choix du client) et le montant demandé
 * correspondant (`partDemandee`), tous CALCULÉS PAR LE SERVEUR. Le total est
 * `montantDemandeAjuste`, servi lui aussi — le front n'additionne rien
 * (principe 4 : les totaux viennent du serveur).
 *
 * Se rend invisible tant que le backend ne sert pas encore ces champs
 * (déploiement en parallèle) : l'écran ne casse pas, il attend le câblage.
 */
export const ModuleFinancingSummary = ({ simResult, currency }) => {
  const lines = simResult?.moduleFinancing;
  if (!lines?.length) return null;
  const total = simResult?.montantDemandeAjuste;
  return (
    <div className="glass-effect p-5 rounded-2xl">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h4 className="font-bold text-white">Plan de financement retenu par le moteur</h4>
        <span className="text-xs text-gray-500 flex items-center gap-1">
          <Lock className="w-3 h-3" aria-hidden="true" /> coûts issus de votre fichier
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/5">
        <table className="w-full text-sm min-w-[420px]">
          <thead className="bg-slate-900/60">
            <tr className="text-gray-400 border-b border-white/10">
              <th className="text-left py-2 px-3">Module</th>
              <th className="text-right py-2 px-3">Coût fichier</th>
              <th className="text-right py-2 px-3">Demandé</th>
              <th className="text-right py-2 px-3">Part demandée</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.module} className="border-b border-white/5 text-gray-300 tabular-nums">
                <td className="py-1.5 px-3 text-gray-200">{moduleConfig(l.module).label}</td>
                <td className="py-1.5 px-3 text-right text-gray-400">
                  {formatMontant(l.coutFichier, '', { decimals: 0 })}
                </td>
                <td className="py-1.5 px-3 text-right text-emerald-300">{l.pct} %</td>
                <td className="py-1.5 px-3 text-right font-semibold text-white">
                  {formatMontant(l.partDemandee, currency, { decimals: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
          {total != null && (
            <tfoot>
              <tr className="border-t border-white/15 text-white font-semibold tabular-nums">
                <td className="py-2 px-3" colSpan={3}>Montant demandé scoré</td>
                <td className="py-2 px-3 text-right text-emerald-400">
                  {formatMontant(total, currency, { decimals: 0 })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        Le score, le DSCR et l'échéancier ci-dessous sont calculés sur ce montant demandé,
        pas sur le total de votre feuille.
      </p>
    </div>
  );
};

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
