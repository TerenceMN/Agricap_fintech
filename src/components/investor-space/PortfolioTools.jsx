import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart2, Bell, CheckCircle2, FileQuestion, History, Info, Leaf,
  Loader2, ShieldAlert, SlidersHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import { describeHistoryCoverage, formatPercent } from '@/lib/investorSpaceWire';
import {
  DATA_GAPS,
  buildMovementRows,
  buildPortfolioAlerts,
  buildRebalanceView,
  buildSurveillanceRows,
  countMovementsByType,
  describeSubPortfolioScope,
  formatReportValue,
  movementCurrencies,
  movementsTruncationNote,
} from '@/lib/portfolioTools';
import InvestorRiskPanel from '@/components/investor-space/InvestorRiskPanel';

/**
 * Les outils de « Gestion de Portefeuilles ».
 *
 * Sept boutons de cet écran appelaient un `toast` « non disponible ». Un toast
 * qui promet puis se dérobe est la pire des réponses : il fait croire que la
 * fonction existe ailleurs. Chaque outil fait donc désormais l'une de deux
 * choses, jamais une troisième :
 *
 * - il AFFICHE une mesure que le serveur calcule déjà, avec sa base, son
 *   effectif, sa méthode et sa clé d'origine (risque, alertes, historique,
 *   rapport global) ;
 * - il ÉNONCE précisément quelle donnée manque et par quel moyen elle serait
 *   alimentée (ESG, benchmarks, cible de rééquilibrage).
 *
 * Aucun chiffre métier n'est calculé ici. Les seules opérations faites côté
 * navigateur sont des conversions d'unité (`rateToPercent`, sur l'unité
 * DÉCLARÉE par le serveur), des tris, des comptages de lignes — et, dans le seul
 * panneau de rééquilibrage, l'écart à une cible que l'investisseur vient de
 * taper, qui est annoncé comme non enregistré et non exécutable.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Briques communes
// ─────────────────────────────────────────────────────────────────────────────

/** Une liste de valeurs servies : chacune avec sa base et sa clé d'origine.
 *  La clé est affichée volontairement — un investisseur qui doute d'un chiffre
 *  doit pouvoir dire lequel, et un auditeur doit pouvoir le retrouver. */
const ReportRowList = ({ rows, currency }) => (
  <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
    {rows.map((r) => (
      <div key={r.key} className="p-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-slate-200">{r.label}</p>
          <p className="text-xs text-slate-500 mt-0.5 break-words">{r.basis}</p>
          <p className="text-[10px] font-mono text-slate-600 mt-1">{r.sourceKey}</p>
        </div>
        <p className={`text-sm font-semibold shrink-0 text-right ${
          r.value === null ? 'text-amber-300 max-w-[16rem]' : 'text-white'}`}>
          {formatReportValue(r, currency)}
        </p>
      </div>
    ))}
  </div>
);

const ScopeBanner = ({ note }) => (
  <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3 text-xs text-slate-300">
    {note}
  </div>
);

const SEVERITY_STYLE = {
  critique: { card: 'border-red-500/40 bg-red-500/5', badge: 'bg-red-500/20 text-red-300', icon: AlertTriangle },
  attention: { card: 'border-amber-500/40 bg-amber-500/5', badge: 'bg-amber-500/20 text-amber-300', icon: AlertTriangle },
  information: { card: 'border-slate-700 bg-slate-800/30', badge: 'bg-slate-600/30 text-slate-300', icon: Info },
};

// ─────────────────────────────────────────────────────────────────────────────
// Alertes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les alertes du portefeuille — toutes issues d'un DRAPEAU ou d'un MOTIF servi.
 *
 * Aucun seuil n'est codé ici : le serveur lit les siens dans `InvestmentConfig`
 * et publie `alert`, `highConcentration` et les motifs d'indisponibilité. Un
 * seuil recodé côté navigateur alerterait un jour à un niveau que le comité n'a
 * pas voté — et personne ne saurait pourquoi les deux écrans divergent.
 */
const AlertsPanel = ({ metrics, allocationView }) => {
  const alerts = useMemo(
    () => buildPortfolioAlerts(metrics, allocationView), [metrics, allocationView],
  );
  const surveillance = useMemo(() => buildSurveillanceRows(metrics), [metrics]);

  return (
    <div className="space-y-4">
      {alerts.length === 0 ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-emerald-200">
                Aucun indicateur servi n’est au-dessus de son seuil, et le serveur ne signale
                aucune mesure manquante sur votre portefeuille.
              </p>
              <p className="text-xs text-emerald-200/70 mt-1">
                « Aucune alerte » et « rien n’est mesuré » se ressemblent à l’écran : la liste
                ci-dessous dit ce qui est réellement surveillé, et à quelle valeur.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        alerts.map((a) => {
          const style = SEVERITY_STYLE[a.severity];
          const Icon = style.icon;
          return (
            <Card key={a.key} className={style.card}>
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-base flex items-start justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Icon className="w-4 h-4 shrink-0" /> {a.title}
                  </span>
                  <Badge className={`${style.badge} border-0 shrink-0`}>{a.severity}</Badge>
                </CardTitle>
                <CardDescription className="text-slate-300">{a.statement}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {a.facts.length > 0 && (
                  <ReportRowList rows={a.facts} currency={metrics.currency} />
                )}
                {a.action && <p className="text-xs text-slate-400">{a.action}</p>}
                <p className="text-[10px] font-mono text-slate-600">{a.sourceKey}</p>
              </CardContent>
            </Card>
          );
        })
      )}

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base">Ce qui est surveillé</CardTitle>
          <CardDescription>
            Valeurs courantes et seuils SERVIS. Les seuils sont des paramètres d’institution lus
            en base : ils ne sont pas modifiables depuis cet écran et ne sont pas recopiés dedans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReportRowList rows={surveillance} currency={metrics.currency} />
        </CardContent>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Rééquilibrage — lecture seule, aucune exécution
// ─────────────────────────────────────────────────────────────────────────────

const GapCell = ({ points, amount, currency }) => {
  if (points === null || amount === null) return <span className="text-slate-600">—</span>;
  const positif = amount > 0;
  return (
    <span className={positif ? 'text-emerald-400' : 'text-amber-400'}>
      {positif ? '+' : ''}{formatPercent(points)} · {positif ? '+' : ''}{formatCurrency(amount, currency)}
    </span>
  );
};

/**
 * L'écart entre la répartition RÉELLE (servie) et une cible SAISIE.
 *
 * Ce panneau ne propose aucun bouton d'exécution, et c'est un choix : déplacer
 * de l'argent entre poches exigerait un endpoint qui n'existe pas. Un bouton
 * « Rééquilibrer maintenant » qui n'appelle rien serait exactement le défaut que
 * cette session corrige.
 *
 * La cible n'est enregistrée nulle part — ni côté serveur (aucun modèle ne la
 * porte), ni dans le navigateur (une allocation cible est une donnée métier :
 * `localStorage` en ferait une donnée hors base, invisible de l'institution).
 */
const RebalancePanel = ({ allocationView, currency }) => {
  const [targets, setTargets] = useState({});
  const view = useMemo(
    () => buildRebalanceView(allocationView, targets), [allocationView, targets],
  );
  const gap = DATA_GAPS.rebalance;

  const setTarget = (name, raw) => {
    const value = raw === '' ? null : Number(raw);
    setTargets((prev) => ({ ...prev, [name]: Number.isFinite(value) ? value : null }));
  };

  return (
    <div className="space-y-4">
      {view.warning && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{view.warning}</span>
          </CardContent>
        </Card>
      )}

      {view.rows.length > 0 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Répartition réelle et cible</CardTitle>
            <CardDescription>
              Les montants et leur nature viennent de `GET /investments/portfolio-allocation`.
              La cible est la vôtre : elle n’est ni enregistrée, ni transmise, ni exécutable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-3">Poche</th>
                    <th className="py-2 pr-3 text-right">Montant</th>
                    <th className="py-2 pr-3 text-right">Part actuelle</th>
                    <th className="py-2 pr-3 text-right">Cible (%)</th>
                    <th className="py-2 text-right">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.key} className="border-b border-slate-800/60 align-top">
                      <td className="py-3 pr-3">
                        <p className="text-slate-200">{r.name}</p>
                        <p className="text-xs text-slate-500">{r.note}</p>
                      </td>
                      <td className="py-3 pr-3 text-right text-white font-mono">
                        {formatCurrency(r.currentAmount, currency)}
                      </td>
                      <td className="py-3 pr-3 text-right text-slate-300">
                        {r.currentSharePercent === null ? '—' : formatPercent(r.currentSharePercent)}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          aria-label={`Cible pour ${r.name}`}
                          value={targets[r.name] ?? ''}
                          onChange={(e) => setTarget(r.name, e.target.value)}
                          className="bg-slate-800 border-slate-700 w-24 ml-auto text-right"
                        />
                      </td>
                      <td className="py-3 text-right">
                        <GapCell points={r.gapPoints} amount={r.gapAmount} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs text-slate-400">
                    <td className="pt-3">Total</td>
                    <td className="pt-3 text-right font-mono text-white">
                      {formatCurrency(view.total, currency)}
                    </td>
                    <td className="pt-3 text-right">100,00 %</td>
                    <td className="pt-3 text-right">
                      {view.targetsEntered ? formatPercent(view.targetsTotalPercent) : '—'}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Un écart positif désigne une poche à renforcer, un écart négatif une poche à
              alléger. Ces montants sont une lecture, pas un ordre : aucun mouvement n’est
              possible depuis cet écran.
            </p>
          </CardContent>
        </Card>
      )}

      <DataGapCard gap={gap} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui manque — énoncé, jamais comblé
// ─────────────────────────────────────────────────────────────────────────────

const GapList = ({ title, items, tone }) => (
  <div>
    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${tone}`}>{title}</p>
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t} className="text-sm text-slate-300 flex gap-2">
          <span className="text-slate-600 shrink-0">—</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  </div>
);

/** Un trou de DONNÉE, pas un trou d'écran : ce qui existe, ce qui manque, par
 *  quel moyen ce serait alimenté, et le contrat serveur à créer. */
const DataGapCard = ({ gap }) => (
  <Card className="bg-slate-900 border-slate-800">
    <CardHeader>
      <CardTitle className="text-white text-base flex items-center gap-2">
        <FileQuestion className="w-4 h-4 text-amber-400" /> {gap.title}
      </CardTitle>
      <CardDescription>{gap.question}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <GapList title="Ce que le serveur sert déjà" items={gap.whatExists} tone="text-emerald-400" />
      <GapList title="Ce qui manque, nommément" items={gap.whatIsMissing} tone="text-amber-400" />
      <GapList title="Par quel moyen ce serait alimenté" items={gap.howItWouldBeFed} tone="text-blue-400" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-slate-400">
          Contrat serveur à créer
        </p>
        <ul className="space-y-2">
          {gap.serverContract.map((c) => (
            <li key={c} className="text-xs font-mono text-slate-400 bg-slate-800/50 rounded p-2">
              {c}
            </li>
          ))}
        </ul>
      </div>
    </CardContent>
  </Card>
);

/**
 * ESG — les projets financés, et le seul texte qui existe à leur sujet.
 *
 * `Project.impact_esg` est un `TextField` libre. Le lire est utile ; en tirer une
 * note ne le serait pas. Le texte est donc affiché tel quel, à la demande, avec
 * ce qu'il est et ce qu'il n'est pas — et aucun score n'est produit.
 */
const EsgPanel = ({ metrics }) => {
  const positions = metrics.valuation.positions ?? [];
  const [texts, setTexts] = useState({});

  const loadText = async (code) => {
    setTexts((p) => ({ ...p, [code]: { loading: true } }));
    try {
      const detail = await api.investments.projects.detail(code);
      setTexts((p) => ({ ...p, [code]: { loading: false, text: detail.impactEsg ?? '' } }));
    } catch (err) {
      setTexts((p) => ({
        ...p,
        [code]: { loading: false, error: err.message || 'Lecture impossible.' },
      }));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <Leaf className="w-4 h-4 text-emerald-400" /> Les projets que vous financez
          </CardTitle>
          <CardDescription>
            Secteur et zone viennent de vos positions valorisées. Le texte d’impact est le SEUL
            élément ESG stocké par l’institution : il est descriptif, non daté, non vérifié et
            non noté — aucun score n’en est dérivé.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {positions.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune position financée : il n’y a pas encore de projet dont parler.
            </p>
          ) : positions.map((p) => {
            const etat = texts[p.projectCode];
            return (
              <div key={p.subscriptionId} className="rounded-lg border border-slate-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">{p.projectCode}</p>
                    <p className="text-xs text-slate-500">
                      {p.sector || 'secteur non renseigné'} · {p.location || 'zone non renseignée'}
                      {' · '}{formatCurrency(p.settledAmount, metrics.currency)} encaissés
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={etat?.loading}
                    onClick={() => loadText(p.projectCode)}
                  >
                    {etat?.loading && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    Texte d’impact déclaré
                  </Button>
                </div>
                {etat?.error && (
                  <p className="text-xs text-red-300 mt-2">{etat.error}</p>
                )}
                {etat && !etat.loading && !etat.error && (
                  <p className="text-xs text-slate-300 mt-2 whitespace-pre-line">
                    {etat.text?.trim()
                      ? etat.text
                      : 'Aucun texte d’impact n’est renseigné sur ce projet.'}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <DataGapCard gap={DATA_GAPS.esg} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Historique des mouvements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'historique réel de l'investisseur, servi par `GET /investments/movements`
 * (borné SERVEUR à ses seuls mouvements).
 *
 * Aucun montant n'est additionné ici : les totaux existent déjà dans
 * `metrics/mine` (`totalSettled`, `totalDistributed`…). En recomposer un dans le
 * navigateur garantirait qu'un jour deux écrans affichent deux totaux
 * différents pour la même grandeur. On compte des LIGNES, on ne somme pas des
 * francs.
 */
const HistoryPanel = ({ currency }) => {
  const [state, setState] = useState({ loading: true, error: null, movements: [] });
  const [type, setType] = useState('');

  useEffect(() => {
    let vivant = true;
    setState({ loading: true, error: null, movements: [] });
    api.investments.movements()
      .then((movements) => {
        if (vivant) setState({ loading: false, error: null, movements });
      })
      .catch((err) => {
        if (vivant) {
          setState({
            loading: false,
            movements: [],
            error: { message: err.message || 'Historique indisponible.', errors: err.errors ?? [] },
          });
        }
      });
    return () => { vivant = false; };
  }, []);

  const { loading, error, movements } = state;
  const rows = useMemo(() => buildMovementRows(movements, { type: type || null }), [movements, type]);
  const counts = useMemo(() => countMovementsByType(movements), [movements]);
  const coverage = useMemo(() => describeHistoryCoverage(movements), [movements]);
  const truncation = movementsTruncationNote(movements);
  const devises = movementCurrencies(movements);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-slate-400 py-12 justify-center">
        <Loader2 className="w-5 h-5 animate-spin" /> Chargement de vos mouvements…
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/40 bg-red-500/5">
        <CardHeader>
          <CardTitle className="text-red-300 text-base">Historique indisponible</CardTitle>
          <CardDescription className="text-red-200/80">{error.message}</CardDescription>
        </CardHeader>
        {error.errors.length > 0 && (
          <CardContent>
            <ul className="space-y-1 text-sm text-red-200">
              {error.errors.map((e, i) => (
                <li key={`${e.code}-${i}`}>
                  <span className="font-mono text-xs text-red-300">{e.code}</span> — {e.message}
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm text-slate-300">{coverage.note}</p>
          {coverage.from && (
            <p className="text-xs text-slate-500">
              Du {formatDate(coverage.from)} au {formatDate(coverage.to)} ·{' '}
              {coverage.monthsCovered} mois distincts couverts
            </p>
          )}
          {devises.length > 1 && (
            <p className="text-xs text-amber-300">
              Plusieurs devises coexistent dans vos mouvements ({devises.join(', ')}) : aucun
              total n’est proposé, il additionnerait des devises sans taux journalisé.
            </p>
          )}
          {truncation && <p className="text-xs text-amber-300">{truncation}</p>}
        </CardContent>
      </Card>

      {movements.length === 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-8 text-center text-slate-400 text-sm">
            Aucun mouvement n’est enregistré sur votre compte investisseur. Une souscription
            seulement réservée n’en produit pas : seul l’encaissement en crée un.
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">
              {rows.length} mouvement(s) affiché(s)
            </CardTitle>
            <CardDescription>
              Effectifs par type — un comptage de lignes, jamais une somme de montants : les
              totaux sont servis par `GET /investments/metrics/mine`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setType('')}
                className={`px-2 py-1 rounded text-xs border ${
                  type === '' ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400'}`}
              >
                Tous ({movements.length})
              </button>
              {counts.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => setType(c.type)}
                  className={`px-2 py-1 rounded text-xs border ${
                    type === c.type ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400'}`}
                >
                  {c.label} ({c.count})
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Nature</th>
                    <th className="py-2 pr-3">Zone</th>
                    <th className="py-2 pr-3">Statut</th>
                    <th className="py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/60">
                      <td className="py-2 pr-3 text-slate-300">{formatDate(r.dateTime)}</td>
                      <td className="py-2 pr-3 text-slate-200">{r.typeLabel}</td>
                      <td className="py-2 pr-3 text-slate-500">{r.geographicZone || '—'}</td>
                      <td className="py-2 pr-3 text-slate-500">{r.status}</td>
                      <td className="py-2 text-right font-mono text-white">
                        {formatCurrency(r.amount, r.currency || currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Le dialogue qui héberge les six outils
// ─────────────────────────────────────────────────────────────────────────────

export const PORTFOLIO_TOOLS = [
  { key: 'rebalance', label: 'Rééquilibrer', icon: SlidersHorizontal, title: 'Rééquilibrage' },
  { key: 'alerts', label: 'Alertes', icon: Bell, title: 'Alertes du portefeuille' },
  { key: 'risk', label: 'Risque', icon: ShieldAlert, title: 'Analyse de risque' },
  { key: 'benchmarks', label: 'Benchmarks', icon: BarChart2, title: 'Comparaison à une référence' },
  { key: 'esg', label: 'Ind. ESG', icon: Leaf, title: 'Indicateurs ESG' },
  { key: 'history', label: 'Historique', icon: History, title: 'Historique des mouvements' },
];

/**
 * `metrics` peut être `null` : `GET /investments/metrics/mine` échoue pour qui
 * n'a pas de profil investisseur. Les outils qui en dépendent le disent au lieu
 * d'afficher des zéros — un portefeuille vide et un portefeuille non chargé se
 * ressemblent à l'écran, et ne se ressemblent pas du tout.
 */
const PortfolioToolsDialog = ({
  tool, open, onOpenChange, metrics, metricsError, allocationView, subscriptions,
  subPortfolio,
}) => {
  const config = PORTFOLIO_TOOLS.find((t) => t.key === tool);
  const currency = metrics?.currency ?? 'USD';
  const scope = describeSubPortfolioScope(
    subscriptions, subPortfolio?.id ?? null, subPortfolio?.name ?? '',
  );

  const besoinMetriques = ['alerts', 'risk', 'esg'].includes(tool);

  const body = () => {
    if (besoinMetriques && !metrics) {
      return (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-200 text-base">Mesures indisponibles</CardTitle>
            <CardDescription className="text-amber-200/80">
              {metricsError
                || 'Vos métriques de portefeuille n’ont pas pu être chargées. Rien n’est affiché '
                  + 'à leur place : un écran de décision ne montre pas de zéros pour une mesure '
                  + 'qu’il n’a pas reçue.'}
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }
    switch (tool) {
      case 'alerts':
        return <AlertsPanel metrics={metrics} allocationView={allocationView} />;
      case 'risk':
        return <InvestorRiskPanel metrics={metrics} />;
      case 'esg':
        return <EsgPanel metrics={metrics} />;
      case 'benchmarks':
        return <DataGapCard gap={DATA_GAPS.benchmarks} />;
      case 'rebalance':
        return <RebalancePanel allocationView={allocationView} currency={currency} />;
      case 'history':
        return <HistoryPanel currency={currency} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-950 border-slate-800 text-white max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {config?.icon && <config.icon className="w-5 h-5 text-emerald-400" />}
            {config?.title ?? 'Outil'}
            {subPortfolio && (
              <span className="text-sm font-normal text-slate-400">— {subPortfolio.name}</span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {config?.title ?? 'Outil de portefeuille'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ScopeBanner note={scope.note} />
          {body()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PortfolioToolsDialog;
