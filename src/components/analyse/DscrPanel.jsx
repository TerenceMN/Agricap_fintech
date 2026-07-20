import React from 'react';
import { Activity, TrendingDown, AlertTriangle } from 'lucide-react';
import { formatDscr, formatTaux, NULL_DISPLAY } from './analyseFormat';

/**
 * Lit une clé de `details` en tolérant les deux conventions de nommage
 * (camelCase du contrat front, snake_case si le sérialiseur laisse passer la
 * forme Django). On ne fabrique pas la valeur si elle manque.
 */
function detail(details, ...cles) {
  if (!details) return undefined;
  for (const c of cles) {
    const v = details[c];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Le mode de différé change la lecture du DSCR : en franchise totale, rien
 * n'est payé pendant le différé et les intérêts sont capitalisés, donc le
 * service de la dette se concentre encore plus. L'afficher évite que l'analyste
 * compare deux dossiers instruits sous deux modes sans le savoir.
 */
const MODE_DIFFERE_LIBELLE = {
  interets_seuls: 'Différé : intérêts seuls',
  franchise_totale: 'Différé : franchise totale (intérêts capitalisés)',
};

const Stat = ({ label, value, tone = 'text-white', hint }) => (
  <div className="bg-slate-900/50 rounded-lg p-3">
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`text-xl font-bold mt-0.5 ${tone}`}>{value}</p>
    {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
  </div>
);

/**
 * DSCR, DSCR stressé et **facteur dominant**.
 *
 * CLAUDE.md §4.6 : un DSCR de 0,64 se livre avec sa cause, pas seul. Quand le
 * moteur fournit le diagnostic (`details.facteurDominant`) et son levier chiffré
 * (`details.levier`), on les affiche. Sinon, on met au moins durée, différé et
 * répartition des phases de l'échéancier à côté du ratio, pour que l'analyste
 * fasse le lien lui-même — on n'invente jamais le diagnostic à sa place.
 *
 * Le nombre d'échéances d'amortissement est un **comptage des lignes renvoyées
 * par le serveur**, pas un recalcul de l'échéancier.
 *
 * @param {{analyse: import('@/types/api').CreditAnalyse}} props
 */
const DscrPanel = ({ analyse }) => {
  const params = analyse?.parametres ?? {};
  const dDetails = analyse?.criteres?.dscr?.details;
  const sDetails = analyse?.criteres?.stress?.details;

  const facteurDominant = detail(dDetails, 'facteurDominant', 'facteur_dominant');
  const levier = detail(dDetails, 'levier', 'levier_chiffre', 'levierChiffre');
  const commentaireStress = detail(sDetails, 'commentaire');

  // Leviers chiffrés servis par `diagnostiquer_levier()` — le moteur reconstruit
  // l'échéancier à différé réduit sur les mêmes cash-flows. Rien n'est simulé ici.
  const diag = detail(dDetails, 'diagnostic');
  const brutes = diag && typeof diag === 'object' ? diag.alternativesDiffere : undefined;
  const alternatives = Array.isArray(brutes) ? brutes : [];

  const lignes = Array.isArray(analyse?.echeancier) ? analyse.echeancier : [];
  const nbAmort = lignes.filter((l) => l?.phase === 'amortissement').length;

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-3">
      <h4 className="font-semibold text-white text-sm flex items-center gap-2">
        <Activity className="w-4 h-4 text-emerald-400" aria-hidden="true" />
        Capacité de remboursement
      </h4>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="DSCR"
          value={formatDscr(analyse?.dscr)}
          hint="Σ cash-flows ÷ Σ service de la dette"
        />
        <Stat
          label="DSCR stressé"
          value={formatDscr(analyse?.dscrStress)}
          tone="text-amber-300"
          hint={commentaireStress || 'Choc de revenus appliqué par le moteur'}
        />
        <Stat
          label="Durée / différé"
          value={
            params.dureeMois === undefined || params.dureeMois === null
              ? NULL_DISPLAY
              : `${params.dureeMois} / ${params.differeMois ?? 0} mois`
          }
          hint={
            lignes.length > 0
              ? `${nbAmort} échéance(s) d'amortissement sur ${lignes.length}`
              : undefined
          }
        />
        <Stat
          label="Taux annuel"
          value={formatTaux(params.tauxAnnuel)}
          hint={MODE_DIFFERE_LIBELLE[params.modeDiffere] || undefined}
        />
      </div>

      {facteurDominant ? (
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
            Facteur dominant
          </p>
          <p className="text-sm text-slate-200 mt-1">{String(facteurDominant)}</p>
          {levier && (
            <p className="text-xs text-emerald-300/90 mt-1.5">
              Levier : {String(levier)}
            </p>
          )}

          {alternatives.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                DSCR selon le différé — calculé par le moteur sur les mêmes cash-flows
              </p>
              <ul className="flex flex-wrap gap-2">
                {alternatives.map((a, i) => {
                  const actuel = Number(a?.differeMois) === Number(params.differeMois);
                  return (
                    <li
                      key={i}
                      className={`text-xs rounded-md px-2 py-1 border tabular-nums ${
                        actuel
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      <span className="text-slate-500">différé</span> {a?.differeMois} m
                      {' → '}
                      <strong>{formatDscr(a?.dscr)}</strong>
                      {actuel && <span className="text-slate-400"> (actuel)</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Simulations serveur, à titre de diagnostic. Modifier réellement le différé
                se fait par une ré-analyse, qui crée une nouvelle analyse — elle n'écrase
                jamais celle-ci.
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-900/40 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400/70" aria-hidden="true" />
          <span>
            Le moteur n'a pas renvoyé de facteur dominant pour ce DSCR. Durée, différé et
            répartition des phases sont affichés ci-dessus : c'est la concentration de
            l'amortissement qui pèse le plus souvent sur le ratio. Le diagnostic chiffré
            (« un différé de N mois porterait le DSCR à X ») viendra du serveur, il n'est
            pas simulé ici.
          </span>
        </p>
      )}
    </section>
  );
};

export default DscrPanel;
