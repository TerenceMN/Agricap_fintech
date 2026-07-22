import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, AlertTriangle, BarChart3, Calendar, DollarSign, Landmark,
  ShieldAlert, Target, UserCircle, Wallet,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import {
  buildOpenOfferCards, buildPipelineStages, buildPositions, buildReturnColumns,
  formatPercent, positionsInDefault, rateToPercent, rateUnit,
} from '@/lib/investorSpaceWire';
import ReturnColumns from '@/components/investor-space/ReturnColumns';
import InvestorRiskPanel from '@/components/investor-space/InvestorRiskPanel';
import InvestorTransparency from '@/components/investor-space/InvestorTransparency';
import InvestorBanking from '@/components/investor-space/InvestorBanking';
import InvestorAccount from '@/components/investor-space/InvestorAccount';
import MyInvestments from '@/components/investor-space/MyInvestments';
import AvailableProjects from '@/components/investor-space/AvailableProjects';

/**
 * L'ESPACE INVESTISSEUR — un seul, désormais.
 *
 * Cet écran remplace le couple `InvestorSpace` + `Investments`, deux espaces qui
 * affichaient la même chose de deux façons différentes, avec deux « total
 * investi » qui ne comptaient pas la même grandeur (l'un les réservations,
 * l'autre les encaissements). Une fonctionnalité en double finit toujours par
 * produire deux chiffres pour un même montant : le second écran a été supprimé,
 * ses acquis — typologie dette/capital, trésorerie et dépôt, documents,
 * messagerie, profil KYC — ont été repris ici.
 *
 * Trois règles gouvernent ce fichier :
 *
 * 1. **Aucun chiffre métier n'est calculé ici.** Rendements, valorisation,
 *    montants agrégés viennent de `GET /investments/metrics/mine` (annexe D).
 *    Le front joint, filtre, étiquette — il ne dérive rien.
 *
 * 2. **Trois rendements, jamais un.** Réalisé (encaissé), latent (valorisé, et
 *    dit comme tel) et attendu (promis). Le chiffre unique flatteur est
 *    l'anti-modèle.
 *
 * 3. **Le risque se montre quand il naît.** Un projet passé en défaut apparaît
 *    en tête de l'écran de ses investisseurs, avec ce que le serveur sait de sa
 *    situation — pas au prochain rapport trimestriel.
 */
const InvestorSpace = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [investor, setInvestor] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [positions, setPositions] = useState([]);
  const [foreignRowsRejected, setForeignRowsRejected] = useState(0);
  const [pipelineStages, setPipelineStages] = useState([]);
  const [movements, setMovements] = useState([]);
  const [openOffersCount, setOpenOffersCount] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Le profil d'abord : `investorId` conditionne le filtrage des positions.
      const profile = await api.investments.investors.me();
      const [serverMetrics, subscriptions, offers, projects, pipeline, myMovements, openOffers] =
        await Promise.all([
          api.investments.metrics.mine(),
          api.investments.subscriptions.mine(),
          api.investments.offers.list(),
          api.investments.projects.list(),
          api.investments.pipeline().catch(() => null),
          api.investments.movements().catch(() => []),
          api.investments.offers.open().catch(() => []),
        ]);

      // La valorisation par position (`valuation.positions`) est jointe aux
      // souscriptions par `subscriptionId` : capital restant dû, gain latent et
      // perte estimée viennent du serveur, position par position.
      const built = buildPositions(
        subscriptions, offers, projects, profile.id, serverMetrics.valuation.positions ?? [],
      );
      setInvestor(profile);
      setMetrics(serverMetrics);
      setPositions(built.positions);
      setForeignRowsRejected(built.foreignRowsRejected);
      setPipelineStages(buildPipelineStages(pipeline));
      setMovements(myMovements);
      setOpenOffersCount(buildOpenOfferCards(openOffers).length);
    } catch (err) {
      // 422 structurée : chaque erreur est affichée, pas résumée en un message.
      setError({
        message: err.message || 'Impossible de charger votre portefeuille.',
        errors: err.errors ?? [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Layout>
        <Helmet><title>Espace investisseur — AGRICAP</title></Helmet>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-slate-400">Chargement de votre portefeuille…</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <Helmet><title>Espace investisseur — AGRICAP</title></Helmet>
        <Card className="bg-red-500/10 border-red-500/30 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Portefeuille indisponible
            </CardTitle>
            <CardDescription className="text-red-200/80">{error.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error.errors.length > 0 && (
              <ul className="space-y-1 text-sm text-red-200">
                {error.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`}>
                    <span className="font-mono text-xs text-red-300">{e.code}</span> — {e.message}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" className="border-red-500/40" onClick={load}>Réessayer</Button>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  const returnColumns = buildReturnColumns(metrics);
  const defaults = positionsInDefault(positions);

  return (
    <Layout>
      <Helmet>
        <title>Espace investisseur — AGRICAP</title>
        <meta name="description" content="Suivi de portefeuille, rendements et projets ouverts à la souscription." />
      </Helmet>

      <div className="space-y-8 pb-16">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <h1 className="text-4xl font-bold gradient-text">Espace investisseur</h1>
          <p className="text-slate-400 text-lg">Votre argent, vos rendements, les projets ouverts.</p>
        </motion.div>

        {/* Incident d'asymétrie : le serveur ne sert que SES souscriptions. Si une
            ligne étrangère arrive quand même, elle est écartée et l'anomalie est
            dite — un filtrage silencieux masquerait une régression serveur. */}
        {foreignRowsRejected > 0 && (
          <Card className="bg-red-500/10 border-red-500/40">
            <CardContent className="p-4 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 mt-0.5" />
              <div className="text-sm text-red-200">
                <p className="font-semibold">Anomalie de données signalée</p>
                <p>
                  {foreignRowsRejected} ligne(s) ne vous appartenant pas ont été écartées de cet
                  écran. Cet incident a été rendu visible volontairement : signalez-le au support.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Agrégat multi-devises sans taux journalisé : le serveur le signale, on
            l'affiche AVANT les chiffres qu'il rend inexploitables (principe 4). */}
        {metrics.mixedCurrency && (
          <Card className="bg-amber-500/10 border-amber-500/40">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-200">{metrics.mixedCurrencyWarning}</p>
            </CardContent>
          </Card>
        )}

        {/* Le risque se montre quand il naît (§5.2) : un projet en P12 apparaît
            ici le jour même, pas au prochain rapport. */}
        {defaults.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-red-500/10 border-red-500/40">
              <CardHeader>
                <CardTitle className="text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  {defaults.length} projet(s) de votre portefeuille en défaut
                </CardTitle>
                <CardDescription className="text-red-200/80">
                  Le passage en défaut (P12) déclenche un plan de recouvrement conduit par
                  l’institution. La perte estimée ci-dessous est calculée par le serveur sur le
                  taux de recouvrement RÉELLEMENT constaté (retours encaissés ÷ décaissé) ;
                  à défaut de recouvrement observé, sur la décote de provision paramétrée. Elle
                  bougera avec le recouvrement — ce n’est pas une perte définitive.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {defaults.map((p) => (
                  <div
                    key={p.key}
                    className="p-4 rounded-lg bg-slate-900/60 border border-red-500/20 space-y-3"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{p.projectTitle}</p>
                        <p className="text-xs text-slate-400">
                          {p.projectCode || p.offerCode} · {p.titleTypeLabel} · souscrit le {formatDate(p.subscriptionDate)}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-red-500/40 text-red-300 self-start md:self-center">
                        {p.projectStatusLabel}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-slate-400">Encaissé</p>
                        <p className="font-mono text-white">{formatCurrency(p.settledAmount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Déjà reçu</p>
                        <p className="font-mono text-emerald-400">{formatCurrency(p.totalReceived)}</p>
                      </div>
                      {p.valuation ? (
                        <>
                          <div>
                            <p className="text-xs text-slate-400">Taux de recouvrement</p>
                            <p className="font-mono text-white">
                              {formatPercent(rateToPercent(
                                p.valuation.recoveryRate,
                                rateUnit(metrics, 'valuation.positions[].recoveryRate'),
                              ))}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Valeur retenue</p>
                            <p className="font-mono text-white">
                              {formatCurrency(p.valuation.capitalOutstanding)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Perte estimée</p>
                            <p className="font-mono text-red-300 font-bold">
                              {formatCurrency(p.valuation.impairment)}
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="col-span-2 lg:col-span-3">
                          <p className="text-xs text-slate-400">
                            Position non encaissée : elle n’est pas valorisée, et aucune perte n’est
                            estimée dessus.
                          </p>
                        </div>
                      )}
                    </div>
                    {p.valuation?.valuationNote && (
                      <p className="text-xs text-slate-400">{p.valuation.valuationNote}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-900 border border-slate-800 p-1 w-full justify-start overflow-x-auto h-auto">
            <TabsTrigger value="dashboard" className="data-[state=active]:bg-slate-800">
              <Activity className="w-4 h-4 mr-2" /> Vue d’ensemble
            </TabsTrigger>
            <TabsTrigger value="positions" className="data-[state=active]:bg-slate-800">
              <Wallet className="w-4 h-4 mr-2" /> Mes investissements
            </TabsTrigger>
            <TabsTrigger value="offers" className="data-[state=active]:bg-slate-800">
              <Target className="w-4 h-4 mr-2" /> Projets ouverts
              {openOffersCount ? (
                <Badge className="ml-2 bg-emerald-500/20 text-emerald-300 border-0">{openOffersCount}</Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="risk" className="data-[state=active]:bg-slate-800">
              <ShieldAlert className="w-4 h-4 mr-2" /> Risque
              {metrics.defaultRates.alert || metrics.concentration.highConcentration ? (
                <Badge className="ml-2 bg-red-500/20 text-red-300 border-0">!</Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="banking" className="data-[state=active]:bg-slate-800">
              <Landmark className="w-4 h-4 mr-2" /> Trésorerie & flux
            </TabsTrigger>
            <TabsTrigger value="transparency" className="data-[state=active]:bg-slate-800">
              <BarChart3 className="w-4 h-4 mr-2" /> Méthode & transparence
            </TabsTrigger>
            <TabsTrigger value="account" className="data-[state=active]:bg-slate-800">
              <UserCircle className="w-4 h-4 mr-2" /> Compte & documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-8 mt-8">
            <ReturnColumns columns={returnColumns} currency={metrics.currency} asOf={metrics.asOf} />

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            >
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6">
                  <div className="p-3 bg-emerald-500/20 rounded-lg w-fit mb-4">
                    <DollarSign className="w-6 h-6 text-emerald-400" />
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Capital investi net</h3>
                  <p className="text-3xl font-bold text-white">
                    {formatCurrency(metrics.totalInvested, metrics.currency)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Encaissé {formatCurrency(metrics.totalSettled, metrics.currency)} · remboursé{' '}
                    {formatCurrency(metrics.totalRefunded, metrics.currency)}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6">
                  <div className="p-3 bg-blue-500/20 rounded-lg w-fit mb-4">
                    <Wallet className="w-6 h-6 text-blue-400" />
                  </div>
                  {/* Valeur totale = capital restant dû + gain latent. Grandeur
                      DISTINCTE du capital investi et du rendement réalisé : les
                      trois sont affichées séparément, jamais résumées en une. */}
                  <h3 className="text-sm text-slate-400 mb-1">Valeur totale</h3>
                  <p className="text-3xl font-bold text-white">
                    {formatCurrency(metrics.totalValue, metrics.currency)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Capital restant dû {formatCurrency(metrics.valuation.capitalOutstanding, metrics.currency)}
                    {' '}+ latent · {metrics.positionsCount} position(s) financée(s)
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6">
                  <div className="p-3 bg-purple-500/20 rounded-lg w-fit mb-4">
                    <Activity className="w-6 h-6 text-purple-400" />
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Distributions reçues</h3>
                  <p className="text-3xl font-bold text-white">
                    {formatCurrency(metrics.totalDistributed, metrics.currency)}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">Argent réellement encaissé</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6">
                  <div className="p-3 bg-amber-500/20 rounded-lg w-fit mb-4">
                    <Calendar className="w-6 h-6 text-amber-400" />
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Prochain paiement attendu</h3>
                  <p className="text-2xl font-bold text-white">
                    {metrics.nextPaymentDate ? formatDate(metrics.nextPaymentDate) : 'Non établie'}
                  </p>
                  {/* Le motif d'indisponibilité est écrit côté serveur pour être
                      LU : « aucun échéancier enregistré » n'est pas « aucun
                      paiement à venir ». */}
                  <p className="text-xs text-slate-500 mt-2">
                    {metrics.nextPayment.unavailableReason
                      ?? (metrics.nextPaymentDate
                        ? `${metrics.nextPayment.upcomingCount} échéance(s) à venir sur `
                          + `${metrics.nextPayment.offersWithSchedule}/${metrics.nextPayment.offersCount} offre(s) `
                          + 'dotée(s) d’un échéancier ; le montant est arrêté à la distribution.'
                        : 'Aucune échéance à venir sur vos offres.')}
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* La méthode de valorisation, le pipeline anonymisé et la liste des
                métriques non servies vivent dans l'onglet « Méthode &
                transparence » — un seul endroit, pas deux. */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-300">
                    Comment ces chiffres sont obtenus, ce que l’écran ne mesure pas encore, et le
                    volume des projets en instruction.
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Devise {metrics.currency} · arrêté au {metrics.asOf}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="border-slate-700 shrink-0"
                  onClick={() => setActiveTab('transparency')}
                >
                  Méthode & transparence
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="positions" className="mt-8">
            <MyInvestments positions={positions} />
          </TabsContent>

          <TabsContent value="offers" className="mt-8">
            <AvailableProjects onInvest={load} />
          </TabsContent>

          <TabsContent value="risk" className="mt-8">
            <InvestorRiskPanel metrics={metrics} />
          </TabsContent>

          <TabsContent value="banking" className="mt-8">
            <InvestorBanking movements={movements} onRefresh={load} />
          </TabsContent>

          <TabsContent value="transparency" className="mt-8">
            <InvestorTransparency
              metrics={metrics}
              pipelineStages={pipelineStages}
              currency={metrics.currency}
            />
          </TabsContent>

          <TabsContent value="account" className="mt-8">
            <InvestorAccount investor={investor} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default InvestorSpace;
