import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  PieChart, TrendingUp, Wallet, AlertTriangle, Activity, DollarSign, 
  Target, Calendar, BarChart3
} from 'lucide-react';
import { 
  PieChart as RePieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line
} from 'recharts';
import { api } from '@/services/api';
import { calculatePortfolioMetrics, buildCommitments, formatCurrency, formatDate, calculatePortfolioHealth } from '@/lib/investorSpaceUtils';
import MyInvestments from '@/components/investor-space/MyInvestments';
import AvailableProjects from '@/components/investor-space/AvailableProjects';
import GovernanceIndicators from '@/components/investor-space/GovernanceIndicators';

const SECTOR_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6'];
const INFLOW_MOVEMENT_TYPES = new Set(['DEPOSIT', 'COUPON_REPAYMENT', 'CAPITAL_REPAYMENT']);
const OUTFLOW_MOVEMENT_TYPES = new Set(['WITHDRAWAL', 'SUBSCRIPTION', 'FEES']);

const InvestorSpace = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [metrics, setMetrics] = useState(null);
  const [performanceData, setPerformanceData] = useState([]);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      const investor = await api.investments.investors.me();
      const [subscriptions, offers, projects, allocation, movements] = await Promise.all([
        api.investments.subscriptions.mine(),
        api.investments.offers.list(),
        api.investments.projects.list(),
        api.investments.portfolioAllocation(),
        api.investments.movements({ investor: investor.id }).catch(() => []),
      ]);
      const commitments = buildCommitments(subscriptions, offers, projects);
      setMetrics(calculatePortfolioMetrics(commitments, projects, allocation.cash));
      setPerformanceData(buildMonthlyNetFlow(movements));
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Impossible de charger votre portefeuille.', variant: 'destructive' });
    }
  };

  /** Flux net cumulé (entrées - sorties) par mois, calculé depuis l'historique réel des
   * mouvements de l'investisseur — remplace la simulation aléatoire précédente. */
  const buildMonthlyNetFlow = (movements) => {
    const byMonth = new Map();
    [...movements].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime)).forEach((m) => {
      const d = new Date(m.dateTime);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const signed = INFLOW_MOVEMENT_TYPES.has(m.type) ? m.amount : OUTFLOW_MOVEMENT_TYPES.has(m.type) ? -m.amount : 0;
      byMonth.set(key, (byMonth.get(key) || 0) + signed);
    });
    let cumulative = 0;
    return Array.from(byMonth.entries()).map(([key, net]) => {
      cumulative += net;
      const [year, month] = key.split('-');
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
      return { month: label, value: Math.round(cumulative) };
    });
  };

  if (!metrics) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-400">Chargement de votre portefeuille...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const sectorData = Object.entries(metrics.sectorExposure).map(([name, value], index) => ({
    name,
    value,
    fill: SECTOR_COLORS[index % SECTOR_COLORS.length],
  }));

  const geoData = Object.entries(metrics.geoExposure).map(([name, value], index) => ({
    name,
    value,
    fill: SECTOR_COLORS[index % SECTOR_COLORS.length],
  }));

  const portfolioHealth = calculatePortfolioHealth(metrics);

  return (
    <Layout>
      <Helmet>
        <title>Espace Investisseur - AGRICAP</title>
        <meta name="description" content="Plateforme de gestion d'investissements agricoles et suivi de portefeuille" />
      </Helmet>

      <div className="space-y-8 pb-16">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <h1 className="text-4xl font-bold gradient-text">Espace Investisseur</h1>
          <p className="text-slate-400 text-lg">Pilotez vos investissements agricoles à impact</p>
        </motion.div>

        {/* Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-900 border border-slate-800 p-1 w-full justify-start overflow-x-auto h-auto">
            <TabsTrigger value="dashboard" className="data-[state=active]:bg-slate-800">
              <Activity className="w-4 h-4 mr-2" /> Vue d'ensemble
            </TabsTrigger>
            <TabsTrigger value="my-investments" className="data-[state=active]:bg-slate-800">
              <Wallet className="w-4 h-4 mr-2" /> Mes Investissements
            </TabsTrigger>
            <TabsTrigger value="available-projects" className="data-[state=active]:bg-slate-800">
              <Target className="w-4 h-4 mr-2" /> Projets Disponibles
            </TabsTrigger>
            <TabsTrigger value="governance" className="data-[state=active]:bg-slate-800">
              <BarChart3 className="w-4 h-4 mr-2" /> Indicateurs
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-8 mt-8">
            {/* KPI Cards */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.1 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            >
              <Card className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border-emerald-500/30">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-emerald-500/20 rounded-lg">
                      <DollarSign className="w-6 h-6 text-emerald-400" />
                    </div>
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Total Investi</h3>
                  <p className="text-3xl font-bold text-white">{formatCurrency(metrics.totalInvested)}</p>
                  <p className="text-xs text-emerald-400 mt-2">{metrics.totalCount} engagements</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-900/40 to-slate-900 border-blue-500/30">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-blue-500/20 rounded-lg">
                      <TrendingUp className="w-6 h-6 text-blue-400" />
                    </div>
                    <Activity className="w-5 h-5 text-blue-400" />
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Valeur Totale</h3>
                  <p className="text-3xl font-bold text-white">{formatCurrency(Math.round(metrics.totalValue))}</p>
                  <p className="text-xs text-blue-400 mt-2">
                    +{formatCurrency(Math.round(metrics.totalValue - metrics.totalInvested))} gain latent
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-purple-900/40 to-slate-900 border-purple-500/30">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-purple-500/20 rounded-lg">
                      <BarChart3 className="w-6 h-6 text-purple-400" />
                    </div>
                    <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded">TRI Pondéré</span>
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Rendement Moyen</h3>
                  <p className="text-3xl font-bold text-white">{metrics.weightedReturnRate.toFixed(1)}%</p>
                  <p className="text-xs text-purple-400 mt-2">Annualisé</p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-orange-900/40 to-slate-900 border-orange-500/30">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-orange-500/20 rounded-lg">
                      <AlertTriangle className="w-6 h-6 text-orange-400" />
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${metrics.defaultRate > 5 ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                      {metrics.defaultRate > 5 ? 'Attention' : 'OK'}
                    </span>
                  </div>
                  <h3 className="text-sm text-slate-400 mb-1">Taux de Défaut</h3>
                  <p className="text-3xl font-bold text-white">{metrics.defaultRate.toFixed(1)}%</p>
                  <p className="text-xs text-orange-400 mt-2">En valeur investie</p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Performance Chart & Portfolio Health */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ delay: 0.2 }}
                className="lg:col-span-2"
              >
                <Card className="bg-slate-900 border-slate-800 h-full">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center justify-between">
                      <span>Flux Net Cumulé</span>
                      {performanceData.length >= 2 && performanceData[0].value !== 0 && (
                        <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                          {(() => {
                            const first = performanceData[0].value;
                            const last = performanceData[performanceData.length - 1].value;
                            const pct = Math.round(((last - first) / Math.abs(first)) * 100);
                            return `${pct >= 0 ? '+' : ''}${pct}%`;
                          })()}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-[350px]">
                    {performanceData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-sm text-slate-500">
                        Aucun mouvement enregistré pour le moment.
                      </div>
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={performanceData}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                        <XAxis dataKey="month" stroke="#64748b" />
                        <YAxis stroke="#64748b" tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                          formatter={(value) => [formatCurrency(value), 'Valeur']}
                        />
                        <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={3} dot={false} fill="url(#colorValue)" />
                      </LineChart>
                    </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ delay: 0.3 }}
                className="space-y-6"
              >
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">Santé du Portefeuille</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center py-4">
                      <div className={`text-6xl font-bold ${portfolioHealth.color} mb-2`}>
                        {portfolioHealth.score}
                      </div>
                      <p className="text-sm text-slate-400">Score de Santé / 100</p>
                      <Badge className={`mt-3 ${portfolioHealth.color.replace('text', 'bg').replace('400', '500/20')} border-0`}>
                        {portfolioHealth.status}
                      </Badge>
                    </div>
                    <div className="space-y-3 pt-4 border-t border-slate-800">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">Investissements Actifs</span>
                        <span className="font-bold text-white">{metrics.activeCount}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">Concentration Risque</span>
                        <span className="font-bold text-white">{metrics.riskConcentration.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">Durée Moyenne</span>
                        <span className="font-bold text-white">{metrics.avgDuration.toFixed(0)} mois</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-blue-400" />
                      Prochain Paiement
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {metrics.nextPayment ? (
                      <div className="space-y-3">
                        <p className="text-sm text-slate-400">{metrics.nextPayment.projectName}</p>
                        <div className="flex justify-between items-baseline">
                          <span className="text-2xl font-bold text-white">
                            {formatDate(metrics.nextPayment.nextPaymentDate)}
                          </span>
                          <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                            ~{formatCurrency(Math.round(metrics.nextPayment.amount * (metrics.nextPayment.couponRate / 100) / 4))}
                          </Badge>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Aucun paiement programmé</p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Exposure Analysis */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.4 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-white">Exposition Sectorielle</CardTitle>
                  <CardDescription>Répartition de votre capital par secteur agricole</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={sectorData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        label={(entry) => `${entry.name} (${((entry.value / metrics.totalInvested) * 100).toFixed(0)}%)`}
                        labelLine={{ stroke: '#64748b', strokeWidth: 1 }}
                      >
                        {sectorData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                        formatter={(value) => formatCurrency(value)}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-white">Exposition Géographique</CardTitle>
                  <CardDescription>Répartition de votre capital par province</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={geoData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                      <XAxis type="number" stroke="#64748b" tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" stroke="#64748b" width={120} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                        formatter={(value) => [formatCurrency(value), 'Montant']}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={25}>
                        {geoData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </motion.div>

            {/* Risk Concentration Alert */}
            {metrics.riskConcentration > 30 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ delay: 0.5 }}
              >
                <Card className="bg-amber-500/10 border-amber-500/30">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-amber-500/20 rounded-lg">
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-amber-300 mb-2">Concentration de Risque Élevée</h3>
                        <p className="text-sm text-slate-300 mb-3">
                          Votre portefeuille présente une concentration de {metrics.riskConcentration.toFixed(1)}%. 
                          Il est recommandé de diversifier davantage vos investissements pour réduire le risque.
                        </p>
                        <Progress value={metrics.riskConcentration} className="h-2 mb-2" />
                        <p className="text-xs text-slate-400">
                          Objectif recommandé : &lt; 30% (HHI Index)
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </TabsContent>

          {/* My Investments Tab */}
          <TabsContent value="my-investments" className="mt-8">
            <MyInvestments onUpdate={loadMetrics} />
          </TabsContent>

          {/* Available Projects Tab */}
          <TabsContent value="available-projects" className="mt-8">
            <AvailableProjects onInvest={loadMetrics} />
          </TabsContent>

          {/* Governance Indicators Tab */}
          <TabsContent value="governance" className="mt-8">
            <GovernanceIndicators metrics={metrics} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default InvestorSpace;