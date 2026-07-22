import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import { formatPercent, rateToPercent, rateUnit, movementTypeLabel, describeHistoryCoverage } from '@/lib/investorSpaceWire';
// `Movement.status` porte `common.choices.FlowStatus`, dont `STATUS_LABELS` est le
// miroir front déjà maintenu. Un second dictionnaire de statuts ici serait un
// vocabulaire parallèle de plus (principe 6).
import { STATUS, STATUS_LABELS } from '@/lib/constants';

/** Une carte de chiffre. `reason` s'affiche À LA PLACE de la valeur quand le
 *  serveur dit ne pas pouvoir la calculer — jamais un tiret muet, jamais une
 *  valeur de remplissage : l'investisseur lit pourquoi le chiffre manque. */
const MetricCard = ({ title, value, caption, reason, tone = 'text-white' }) => (
  <Card className="glass-effect">
    <CardHeader><CardTitle className="text-gray-400 text-sm">{title}</CardTitle></CardHeader>
    <CardContent>
      {reason
        ? <p className="text-sm text-amber-300/90 leading-snug">{reason}</p>
        : <p className={`text-3xl font-bold ${tone}`}>{value}</p>}
      {caption && !reason && <p className="text-xs text-gray-500 mt-1">{caption}</p>}
    </CardContent>
  </Card>
);

const FinancialFlows = () => {
  const [metrics, setMetrics] = useState(null);
  const [movements, setMovements] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        // `metrics.mine` et `movements` sont tous deux bornés SERVEUR à
        // l'investisseur connecté ; `projects.list` sert les projets visibles et
        // ne fournit ici qu'un libellé — aucun chiffre n'en est tiré.
        const [m, mv, pr] = await Promise.all([
          api.investments.metrics.mine(),
          api.investments.movements(),
          api.investments.projects.list().catch(() => []),
        ]);
        if (annule) return;
        setMetrics(m);
        setMovements(mv || []);
        setProjects(pr || []);
      } catch (err) {
        if (!annule) setError(err?.message || 'Chargement impossible.');
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  const projectTitles = new Map(projects.map((p) => [p.id, p.title || p.code]));
  const coverage = describeHistoryCoverage(movements);
  const nextPayment = metrics?.nextPayment;
  const realized = metrics ? rateToPercent(metrics.realizedReturn, rateUnit(metrics, 'realizedReturn')) : null;

  return (
    <Layout>
      <Helmet><title>Flux Financiers - AGRICAP</title></Helmet>
      <h1 className="text-3xl font-bold gradient-text mb-2">Flux Financiers & Rendements</h1>
      <p className="text-gray-400 mb-8">Vos encaissements réels et vos échéances à venir.</p>

      {loading && (
        <div className="flex items-center gap-3 text-gray-400 py-12">
          <Loader2 className="h-5 w-5 animate-spin" /> Chargement de vos flux…
        </div>
      )}

      {!loading && error && (
        <div className="glass-effect rounded-xl p-6 flex items-start gap-3 text-amber-300">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Vos flux n'ont pas pu être chargés.</p>
            <p className="text-sm text-amber-300/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && metrics && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <MetricCard
              title="Total reçu"
              tone="text-emerald-400"
              value={formatCurrency(metrics.totalDistributed, metrics.currency)}
              caption={metrics.period?.from
                ? `Distributions encaissées depuis le ${formatDate(metrics.period.from)}.`
                : 'Distributions réellement encaissées, depuis l’ouverture de votre compte.'}
            />
            <MetricCard
              title="Prochaine échéance"
              /* Le serveur établit une DATE d'échéance, pas un montant : le
                 montant dû dépend de l'échéancier de retour, qu'aucun service ne
                 génère encore. Afficher un montant ici reviendrait à l'inventer. */
              value={formatDate(nextPayment?.nextPaymentDate)}
              caption={nextPayment?.upcomingCount
                ? `${nextPayment.upcomingCount} échéance(s) à venir. Montant communiqué à l'établissement de l'échéancier.`
                : undefined}
              reason={nextPayment?.nextPaymentDate ? null : nextPayment?.unavailableReason}
            />
            <MetricCard
              title="Rendement réalisé"
              tone="text-blue-400"
              value={formatPercent(realized)}
              caption={metrics.period?.flowsCount
                ? `XIRR sur ${metrics.period.flowsCount} flux daté(s) réel(s). Aucune projection.`
                : undefined}
              reason={metrics.realizedReturn === null ? metrics.realizedReturnUnavailableReason : null}
            />
          </div>

          {metrics.mixedCurrencyWarning && (
            <p className="text-xs text-amber-300/80 mb-6">{metrics.mixedCurrencyWarning}</p>
          )}

          <div className="glass-effect rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-gray-300">Date</TableHead>
                  <TableHead className="text-gray-300">Type</TableHead>
                  <TableHead className="text-gray-300">Projet</TableHead>
                  <TableHead className="text-right text-gray-300">Montant</TableHead>
                  <TableHead className="text-gray-300">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.length === 0 && (
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableCell colSpan={5} className="text-center text-gray-500 py-10">
                      Aucun mouvement enregistré sur votre compte.
                    </TableCell>
                  </TableRow>
                )}
                {movements.map((f) => (
                  <TableRow key={f.id} className="border-white/5 hover:bg-white/5">
                    <TableCell className="text-gray-400">{formatDate(f.dateTime)}</TableCell>
                    <TableCell className="text-white">{movementTypeLabel(f.type)}</TableCell>
                    <TableCell>{projectTitles.get(f.projectId) || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">
                      {formatCurrency(f.amount, f.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={f.status === STATUS.POSTED ? 'success' : 'outline'}>
                        {STATUS_LABELS[f.status]?.label || f.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-gray-500 mt-3">{coverage.note}</p>
        </>
      )}
    </Layout>
  );
};

export default FinancialFlows;
