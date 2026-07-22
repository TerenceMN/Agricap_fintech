import React from 'react';
import { Activity, AlertTriangle, CalendarClock, TrendingDown } from 'lucide-react';
import { formatDscr, formatTaux, formatMontant, NULL_DISPLAY } from './analyseFormat';

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
 * Le **mois le plus tendu** (`details.diagnostic.moisLePlusTendu`) est affiché à
 * côté du ratio global : un DSCR annuel sain peut cacher un mois à 0,2, et c'est
 * là que le dossier casse (SPEC §9.3). Le moteur le calcule ; ne pas le montrer
 * revenait à laisser conclure sur une moyenne.
 *
 * Attention à la forme du payload : `facteurDominant` et `levier` sont remontés
 * à la RACINE de `details` par `analyse.py` (`diagnostic.pop`), tout le reste du
 * diagnostic reste imbriqué dans `details.diagnostic`. Lire au mauvais niveau
 * n'échoue pas — ça affiche moins, en silence.
 *
 * Le nombre d'échéances d'amortissement est un **comptage des lignes renvoyées
 * par le serveur**, pas un recalcul de l'échéancier.
 *
 * @param {{analyse: import('@/types/api').CreditAnalyse, currency?: string}} props
 */
const DscrPanel = ({ analyse, currency = '' }) => {
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

  // Origine des cash-flows : le dénominateur du DSCR est un fait (l'échéancier),
  // mais le numérateur peut être une PROJECTION du référentiel quand le classeur
  // ingéré ne déclare aucune trésorerie prévisionnelle. Afficher le ratio sans
  // le dire donnerait à une hypothèse l'autorité d'une donnée (CLAUDE.md §4.6,
  // « incertitude assumée »).
  // Le moteur n'émet que deux origines (`analyse.py` 651 et 835) :
  // `projection_referentiel` et `fourni`. On teste donc l'appartenance à la
  // valeur qui appelle l'avertissement, jamais l'exclusion d'une autre : une
  // liste d'exclusion se trompe en silence dès qu'une origine est ajoutée, et
  // le sens de l'erreur importe ici — signaler « projeté » sur des cash-flows
  // réellement fournis discrédite le bandeau, et l'analyste cesse de le lire.
  const hypothese = diag && typeof diag === 'object' ? diag.hypotheseCashFlows : undefined;
  const estProjection = String(hypothese?.origine || '') === 'projection_referentiel';

  // Le mois le plus tendu (`dscr_mensuel_minimum`, SPEC §9.3) : un DSCR global
  // sain peut cacher un mois à 0,2, et c'est là que le dossier casse. Le moteur
  // le calcule et le sert ; ne pas l'afficher revenait à laisser l'analyste
  // conclure sur la moyenne — exactement l'angle mort que le différé creuse.
  const pire = diag && typeof diag === 'object' ? diag.moisLePlusTendu : undefined;
  const pireMois = pire && typeof pire === 'object' && pire.mois !== undefined ? pire : null;

  const lignes = Array.isArray(analyse?.echeancier) ? analyse.echeancier : [];
  const nbAmort = lignes.filter((l) => l?.phase === 'amortissement').length;

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-3">
      <h4 className="font-semibold text-white text-sm flex items-center gap-2">
        <Activity className="w-4 h-4 text-emerald-400" aria-hidden="true" />
        Capacité de remboursement
      </h4>

      {estProjection && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-amber-300/90 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            DSCR fondé sur des cash-flows projetés, non déclarés
          </p>
          {hypothese?.commentaire && (
            <p className="text-xs text-amber-100/90 mt-1.5">{String(hypothese.commentaire)}</p>
          )}
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300 tabular-nums">
            {hypothese?.revenuBrut !== undefined && (
              <div><dt className="inline text-slate-500">Revenu brut projeté </dt>
                <dd className="inline font-semibold">{formatMontant(hypothese.revenuBrut, currency)}</dd></div>
            )}
            {hypothese?.chargesPlan !== undefined && (
              <div><dt className="inline text-slate-500">Charges du plan </dt>
                <dd className="inline font-semibold">{formatMontant(hypothese.chargesPlan, currency)}</dd></div>
            )}
            {hypothese?.margeNetteCycle !== undefined && (
              <div><dt className="inline text-slate-500">Marge nette du cycle </dt>
                <dd className="inline font-semibold">{formatMontant(hypothese.margeNetteCycle, currency)}</dd></div>
            )}
            {hypothese?.rendementUnitaire !== undefined && (
              <div><dt className="inline text-slate-500">Rendement retenu </dt>
                <dd className="inline font-semibold">
                  {hypothese.rendementUnitaire} {hypothese.uniteRendement || ''}
                  {hypothese.superficieHa !== undefined && ` × ${hypothese.superficieHa} ha`}
                </dd></div>
            )}
          </dl>
          <p className="text-[11px] text-amber-200/70 mt-2">
            Hypothèse à valider avec le client — c'est la première question à lui poser avant
            de conclure sur ce DSCR.
          </p>
        </div>
      )}

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

      {pireMois && (
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
            Mois le plus tendu — DSCR mensuel, pas la moyenne
          </p>
          <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 tabular-nums">
            <div>
              <dt className="text-[11px] text-slate-500">Mois</dt>
              <dd className="text-sm font-semibold text-slate-100">{pireMois.mois}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">DSCR du mois</dt>
              <dd className={`text-lg font-bold ${
                Number(pireMois.dscr) < 1 ? 'text-red-300' : 'text-emerald-300'
              }`}>
                {formatDscr(pireMois.dscr)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">Cash-flow du mois</dt>
              <dd className="text-sm text-slate-200">{formatMontant(pireMois.cashFlow, currency)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">Échéance exigible</dt>
              <dd className="text-sm text-slate-200">{formatMontant(pireMois.echeance, currency)}</dd>
            </div>
          </dl>
          {Number(pireMois.dscr) < 1 && (
            <p className="text-xs text-red-200/90 mt-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Ce mois-là, la trésorerie attendue ne couvre pas l'échéance — même si le DSCR
                global tient. Question à poser au client : d'où viendra la différence au mois{' '}
                {pireMois.mois} ? À confronter au calendrier de récolte : un remboursement
                exigible avant la vente est un défaut de calibrage du différé, pas un défaut
                du client.
              </span>
            </p>
          )}
        </div>
      )}

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
