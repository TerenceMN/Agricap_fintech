import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  TrendingUp, AlertTriangle, Wallet, Calendar, PieChart, BarChart3
} from 'lucide-react';
import { 
  PieChart as RePieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { formatCurrency, transformSectorExposure, transformGeoExposure, formatDate } from '@/lib/investorSpaceUtils';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

const GovernanceIndicators = ({ metrics }) => {
  const sectorData = transformSectorExposure(metrics.sectorExposure);
  const geoData = transformGeoExposure(metrics.geoExposure);

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-2xl font-bold text-white mb-2">Indicateurs de Gouvernance</h2>
        <p className="text-slate-400">Métriques clés de gestion de portefeuille</p>
      </motion.div>

      {/* Key Metrics Cards */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <Card className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border-emerald-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-emerald-500/20 rounded-lg">
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              </div>
              <span className="text-sm text-slate-400">Rendement Pondéré</span>
            </div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.weightedReturnRate.toFixed(2)}%</p>
            <p className="text-xs text-emerald-400">Taux annuel moyen</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-900/40 to-slate-900 border-red-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/20 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <span className="text-sm text-slate-400">Taux de Défaut</span>
            </div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.defaultRate.toFixed(1)}%</p>
            <p className="text-xs text-red-400">En valeur investie</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-900/40 to-slate-900 border-blue-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-blue-500/20 rounded-lg">
                <Wallet className="w-6 h-6 text-blue-400" />
              </div>
              <span className="text-sm text-slate-400">Liquidité Disponible</span>
            </div>
            <p className="text-3xl font-bold text-white mb-1">{formatCurrency(metrics.availableCash)}</p>
            <p className="text-xs text-blue-400">Cash libre</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-900/40 to-slate-900 border-purple-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-purple-500/20 rounded-lg">
                <Calendar className="w-6 h-6 text-purple-400" />
              </div>
              <span className="text-sm text-slate-400">Durée Moyenne</span>
            </div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.avgDuration.toFixed(0)}</p>
            <p className="text-xs text-purple-400">Mois restants</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Exposure Charts */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <PieChart className="w-5 h-5 text-emerald-400" />
              Exposition Sectorielle
            </CardTitle>
            <CardDescription>Distribution du capital par secteur d'activité</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={sectorData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {sectorData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
            <CardTitle className="text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              Exposition Géographique
            </CardTitle>
            <CardDescription>Distribution du capital par province</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={geoData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis type="number" stroke="#64748b" tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" stroke="#64748b" width={100} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                  formatter={(value) => [formatCurrency(value), 'Montant']}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {geoData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>

      {/* Risk Concentration */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.3 }}
      >
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Concentration de Risque (Indice HHI)</CardTitle>
            <CardDescription>Mesure la concentration du portefeuille - Plus bas = meilleure diversification</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Score de Concentration</span>
              <Badge variant={metrics.riskConcentration < 30 ? 'success' : metrics.riskConcentration < 50 ? 'warning' : 'destructive'}>
                {metrics.riskConcentration.toFixed(1)}%
              </Badge>
            </div>
            <Progress value={metrics.riskConcentration} className="h-3" />
            <div className="grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <div className="h-2 bg-green-500/20 rounded mb-1"></div>
                <p className="text-green-400">Bien diversifié</p>
                <p className="text-slate-500">&lt; 30%</p>
              </div>
              <div>
                <div className="h-2 bg-yellow-500/20 rounded mb-1"></div>
                <p className="text-yellow-400">Acceptable</p>
                <p className="text-slate-500">30-50%</p>
              </div>
              <div>
                <div className="h-2 bg-red-500/20 rounded mb-1"></div>
                <p className="text-red-400">Concentré</p>
                <p className="text-slate-500">&gt; 50%</p>
              </div>
            </div>
            {metrics.riskConcentration > 30 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded text-sm text-amber-300">
                💡 <strong>Recommandation:</strong> Votre portefeuille présente une concentration élevée. 
                Envisagez de diversifier davantage vos investissements pour réduire le risque.
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Next Payment Schedule */}
      {metrics.nextPayment && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.4 }}
        >
          <Card className="bg-gradient-to-r from-slate-900 to-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-400" />
                Calendrier de Paiement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400 mb-1">Prochain paiement attendu</p>
                  <p className="text-2xl font-bold text-white">{formatDate(metrics.nextPayment.nextPaymentDate)}</p>
                  <p className="text-sm text-slate-400 mt-2">{metrics.nextPayment.projectName}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-400 mb-1">Montant estimé</p>
                  <p className="text-3xl font-bold text-emerald-400">
                    ~{formatCurrency(Math.round(metrics.nextPayment.amount * (metrics.nextPayment.couponRate / 100) / 4))}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">Coupon trimestriel</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
};

export default GovernanceIndicators;