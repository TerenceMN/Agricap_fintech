import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { menuKeyFor } from '@/components/Layout';
import { api } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign,
  TrendingUp,
  Repeat,
  Building2,
  Calendar,
  Filter,
  Download,
  RefreshCw,
  Eye,
  ArrowRightLeft
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const PERIOD_DAYS = { today: 1, week: 7, month: 30, quarter: 90, year: 365 };

const CurrencyCard = ({ title, usdAmount, cdfAmount, icon: Icon, gradient, showConversion = true, exchangeRate }) => {
  const [showUSD, setShowUSD] = useState(true);

  const formatCurrency = (amount, currency) => {
    if (currency === 'USD') {
      return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    return `${(amount / 1000000).toFixed(1)}M FC`;
  };

  const convertedUSD = exchangeRate ? cdfAmount / exchangeRate : null;
  const convertedCDF = exchangeRate ? usdAmount * exchangeRate : null;

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="glass-effect rounded-2xl p-6 card-hover relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br opacity-10 rounded-full -mr-16 -mt-16" style={{ background: gradient }}></div>
      
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setShowUSD(!showUSD)}
        >
          <ArrowRightLeft className="w-4 h-4 text-gray-400" />
        </Button>
      </div>

      <h3 className="text-gray-400 text-sm font-medium mb-3 relative z-10">{title}</h3>
      
      <div className="space-y-2 relative z-10">
        <div className={`transition-all duration-300 ${showUSD ? 'opacity-100' : 'opacity-50'}`}>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-white">{formatCurrency(usdAmount, 'USD')}</p>
            <Badge variant="outline" className="text-xs">USD</Badge>
          </div>
          {showConversion && (
            <p className="text-xs text-gray-500 mt-1">{convertedCDF !== null ? `≈ ${formatCurrency(convertedCDF, 'CDF')}` : 'Taux non configuré'}</p>
          )}
        </div>

        <div className={`transition-all duration-300 ${!showUSD ? 'opacity-100' : 'opacity-50'}`}>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-white">{formatCurrency(cdfAmount, 'CDF')}</p>
            <Badge variant="outline" className="text-xs">CDF</Badge>
          </div>
          {showConversion && (
            <p className="text-xs text-gray-500 mt-1">{convertedUSD !== null ? `≈ ${formatCurrency(convertedUSD, 'USD')}` : 'Taux non configuré'}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const ExchangeRateWidget = ({ rate }) => {
  return (
    <div className="glass-effect rounded-xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <Repeat className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-gray-400">Taux de Change Officiel</p>
          <p className="text-lg font-bold text-white">{rate ? `1 USD = ${rate.sell.toLocaleString()} CDF` : 'Aucun taux configuré'}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs text-gray-500">Dernière mise à jour</p>
        <p className="text-xs text-gray-400 font-mono">{rate?.effectiveDate || '-'}</p>
      </div>
    </div>
  );
};

const MultiCurrencyDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedAgency, setSelectedAgency] = useState('all');
  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [selectedCurrency, setSelectedCurrency] = useState('both');
  const [agencies, setAgencies] = useState([]);
  const [loans, setLoans] = useState([]);
  const [plans, setPlans] = useState([]);
  const [txs, setTxs] = useState([]);
  const [fxRate, setFxRate] = useState(null);
  const [clientsCount, setClientsCount] = useState(null);

  const loadAll = () => {
    api.agencies.list().then(setAgencies).catch(() => {});
    api.portfolio.loans().then(setLoans).catch(() => {});
    api.savings.allPlans().then(setPlans).catch(() => {});
    api.transactions.list().then(setTxs).catch(() => {});
    api.fx.current('CLIENT', 'USD').then(setFxRate).catch(() => setFxRate(null));
    api.rbac.users.list().then((rows) => {
      const CLIENT_ROLES = new Set(['client', 'investor', 'agri_op', 'invest', 'partner']);
      setClientsCount(rows.filter((r) => CLIENT_ROLES.has(r.role)).length);
    }).catch(() => setClientsCount(null));
  };

  useEffect(() => { loadAll(); }, []);

  const filteredTxs = useMemo(() => {
    const days = PERIOD_DAYS[selectedPeriod] ?? 30;
    const cutoff = new Date(Date.now() - days * 86400000);
    return txs.filter((tx) => {
      if (selectedAgency !== 'all' && String(tx.agencyId) !== selectedAgency) return false;
      return new Date(tx.date) >= cutoff;
    });
  }, [txs, selectedAgency, selectedPeriod]);

  // Agrégats réels : crédits décaissés en cours (portfolio), épargne (plans), transactions
  // (filtrées agence/période). Non ventilés par agence : les modèles crédit/épargne
  // n'exposent pas encore de rattachement agence — le filtre agence ne s'applique donc
  // qu'aux transactions.
  const aggregatedData = useMemo(() => {
    const credits = { usd: 0, cdf: 0 };
    loans.forEach((l) => {
      if (!['en cours', 'actif', 'active', 'en_cours'].includes((l.status || '').toLowerCase())) return;
      if (l.currency === 'USD') credits.usd += l.amountDisbursed || 0;
      else if (l.currency === 'CDF') credits.cdf += l.amountDisbursed || 0;
    });
    const savings = { usd: 0, cdf: 0 };
    plans.forEach((p) => {
      if (p.currency === 'USD') savings.usd += p.balance || 0;
      else if (p.currency === 'CDF') savings.cdf += p.balance || 0;
    });
    return { credits, savings, transactions: filteredTxs.length, clients: clientsCount ?? 0 };
  }, [loans, plans, filteredTxs, clientsCount]);

  const exchangeRate = fxRate?.sell ?? null;

  // Chart data
  const comparisonData = [
    {
      name: 'Crédits',
      USD: aggregatedData.credits.usd,
      CDF: exchangeRate ? aggregatedData.credits.cdf / exchangeRate : 0,
    },
    {
      name: 'Épargne',
      USD: aggregatedData.savings.usd,
      CDF: exchangeRate ? aggregatedData.savings.cdf / exchangeRate : 0,
    }
  ];

  const distributionData = [
    { name: 'Crédits USD', value: aggregatedData.credits.usd, color: '#3b82f6' },
    { name: 'Crédits CDF', value: exchangeRate ? aggregatedData.credits.cdf / exchangeRate : 0, color: '#60a5fa' },
    { name: 'Épargne USD', value: aggregatedData.savings.usd, color: '#10b981' },
    { name: 'Épargne CDF', value: exchangeRate ? aggregatedData.savings.cdf / exchangeRate : 0, color: '#34d399' },
  ].filter((d) => d.value > 0);

  // Role-based access control (mappe les 16 rôles réels vers les 6 buckets historiques).
  const bucket = menuKeyFor(user);
  const canViewAllAgencies = ['admin', 'auditeur'].includes(bucket);
  const canExportData = ['admin', 'comptable', 'auditeur'].includes(bucket);
  const canViewDetailedMetrics = ['admin', 'comptable'].includes(bucket);

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Tableau de Bord Multi-Devises</h2>
          <p className="text-sm text-gray-400">Vue consolidée des positions en USD et CDF</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {canViewAllAgencies && (
            <Select value={selectedAgency} onValueChange={setSelectedAgency}>
              <SelectTrigger className="w-[200px] bg-slate-800/60 border-slate-700">
                <Building2 className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les Agences</SelectItem>
                {agencies.map(agency => (
                  <SelectItem key={agency.id} value={String(agency.id)}>{agency.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[180px] bg-slate-800/60 border-slate-700">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Aujourd'hui</SelectItem>
              <SelectItem value="week">Cette Semaine</SelectItem>
              <SelectItem value="month">Ce Mois</SelectItem>
              <SelectItem value="quarter">Ce Trimestre</SelectItem>
              <SelectItem value="year">Cette Année</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
            <SelectTrigger className="w-[150px] bg-slate-800/60 border-slate-700">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">USD & CDF</SelectItem>
              <SelectItem value="usd">USD Seulement</SelectItem>
              <SelectItem value="cdf">CDF Seulement</SelectItem>
            </SelectContent>
          </Select>

          {canExportData && (
            <Button variant="outline" className="border-slate-700" onClick={() => toast({
              title: 'Exporter',
              description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
            })}>
              <Download className="w-4 h-4 mr-2" />
              Exporter
            </Button>
          )}

          <Button variant="outline" className="border-slate-700" onClick={loadAll}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Exchange Rate Widget */}
      <ExchangeRateWidget rate={fxRate} />

      {/* Main Currency Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CurrencyCard
          title="Total Crédits Actifs"
          usdAmount={aggregatedData.credits.usd}
          cdfAmount={aggregatedData.credits.cdf}
          icon={DollarSign}
          gradient="from-blue-500 to-cyan-600"
          exchangeRate={exchangeRate}
        />
        <CurrencyCard
          title="Total Épargne"
          usdAmount={aggregatedData.savings.usd}
          cdfAmount={aggregatedData.savings.cdf}
          icon={TrendingUp}
          gradient="from-emerald-500 to-teal-600"
          exchangeRate={exchangeRate}
        />
      </div>

      {/* Charts Section */}
      {canViewDetailedMetrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bar Chart Comparison */}
          <div className="glass-effect rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Comparaison par Devise (équivalent USD)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(30,41,59,0.95)', 
                    border: 'none', 
                    borderRadius: '0.5rem',
                    backdropFilter: 'blur(10px)'
                  }}
                  formatter={(value) => `$${value.toLocaleString()}`}
                />
                <Legend />
                <Bar dataKey="USD" fill="#3b82f6" name="USD" radius={[8, 8, 0, 0]} />
                <Bar dataKey="CDF" fill="#10b981" name="CDF (converti)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart Distribution */}
          <div className="glass-effect rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Répartition Globale</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={distributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(30,41,59,0.95)', 
                    border: 'none', 
                    borderRadius: '0.5rem' 
                  }}
                  formatter={(value) => `$${value.toLocaleString()}`}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-effect rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Total Transactions</p>
          <p className="text-2xl font-bold text-white">{aggregatedData.transactions.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">Sur la période sélectionnée</p>
        </div>
        <div className="glass-effect rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Clients Actifs</p>
          <p className="text-2xl font-bold text-white">{clientsCount !== null ? clientsCount.toLocaleString() : 'N/D'}</p>
          <p className="text-xs text-gray-500 mt-1">{clientsCount === null ? 'Accès annuaire restreint' : 'Clients + investisseurs'}</p>
        </div>
        <div className="glass-effect rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Ratio Épargne/Crédit</p>
          <p className="text-2xl font-bold text-white">
            {aggregatedData.credits.usd > 0 ? `${((aggregatedData.savings.usd / aggregatedData.credits.usd) * 100).toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">Couverture liquidité (USD)</p>
        </div>
        <div className="glass-effect rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Exposition Devise</p>
          <p className="text-2xl font-bold text-white">
            {exchangeRate && (aggregatedData.credits.usd + aggregatedData.credits.cdf) > 0
              ? `${((aggregatedData.credits.usd / (aggregatedData.credits.usd + aggregatedData.credits.cdf / exchangeRate)) * 100).toFixed(0)}%`
              : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">Part USD</p>
        </div>
      </div>

      {/* Role-based Information Banner */}
      {!canViewAllAgencies && (
        <div className="glass-effect rounded-xl p-4 border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Eye className="w-5 h-5 text-amber-400 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-400">Accès Limité</p>
              <p className="text-xs text-gray-400 mt-1">
                Votre rôle ({user?.role}) limite l'accès à certaines fonctionnalités. 
                Contactez un administrateur pour plus de permissions.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiCurrencyDashboard;