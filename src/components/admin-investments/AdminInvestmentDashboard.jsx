import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Briefcase, TrendingUp, Users, AlertTriangle, Activity,
  Plus, ArrowRight, ShieldCheck, Clock
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { PROJECT_STATUS_LABELS } from '@/components/admin-console/AgricapComponents';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { api } from '@/services/api';

const AdminInvestmentDashboard = ({ projects, offers, investors, subscriptions, onNavigateTab }) => {
  const [metrics, setMetrics] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.investments.dashboardMetrics(),
      api.audit.entries().catch(() => []),
    ]).then(([dashboardMetrics, entries]) => {
      setMetrics(dashboardMetrics);
      setRecentActivity(entries.slice(0, 10));
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  const activeSubs = subscriptions.filter(s => s.status !== 'CANCELLED');
  const totalTarget = projects.reduce((sum, p) => sum + (p.fundingTarget || 0), 0);
  const fundedPercentage = totalTarget > 0 ? (metrics.totalInvested / totalTarget) * 100 : 0;

  const defaultedProjects = projects.filter(p => p.status === 'P12').length;
  const defaultRate = projects.length > 0 ? (defaultedProjects / projects.length) * 100 : 0;

  const avgReturn = offers.length > 0
    ? offers.reduce((sum, o) => sum + (o.couponRate || 0), 0) / offers.length
    : 0;

  const distMap = {};
  projects.forEach(p => { distMap[p.status] = (distMap[p.status] || 0) + 1; });
  const projectDistribution = Object.keys(PROJECT_STATUS_LABELS).map(code => ({
    name: code,
    label: PROJECT_STATUS_LABELS[code],
    count: distMap[code] || 0,
  }));

  return (
    <div className="space-y-6">
      {/* Top Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-500/20 rounded-lg"><Briefcase className="w-6 h-6 text-blue-400"/></div>
              <span className="text-xs font-bold text-slate-400">{activeSubs.length} souscriptions actives</span>
            </div>
            <p className="text-sm text-slate-400">Total Projets</p>
            <h3 className="text-3xl font-bold text-white">{metrics.totalProjects}</h3>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-emerald-500/20 rounded-lg"><TrendingUp className="w-6 h-6 text-emerald-400"/></div>
              <span className="text-xs font-bold text-emerald-400">{fundedPercentage.toFixed(1)}% de la cible</span>
            </div>
            <p className="text-sm text-slate-400">Capital Investi</p>
            <h3 className="text-3xl font-bold text-white">{formatCurrency(metrics.totalInvested)}</h3>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-500/20 rounded-lg"><Users className="w-6 h-6 text-purple-400"/></div>
              <span className="text-xs font-bold text-amber-400">{metrics.kycPending} KYC en attente</span>
            </div>
            <p className="text-sm text-slate-400">Investisseurs Actifs</p>
            <h3 className="text-3xl font-bold text-white">{metrics.activeInvestors}</h3>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-red-500/20 rounded-lg"><AlertTriangle className="w-6 h-6 text-red-400"/></div>
              <span className="text-xs font-bold text-slate-400">Coupon moyen : {avgReturn.toFixed(1)}%</span>
            </div>
            <p className="text-sm text-slate-400">Taux de Défaut</p>
            <h3 className="text-3xl font-bold text-white">{defaultRate.toFixed(1)}%</h3>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline Chart */}
        <Card className="lg:col-span-2 bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Pipeline de Projets</CardTitle>
            <CardDescription>Distribution des projets par statut (P01-P13)</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" allowDecimals={false} />
                <Tooltip
                  contentStyle={{backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff'}}
                  labelFormatter={(code) => PROJECT_STATUS_LABELS[code] || code}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              Activité Récente
              <Activity className="w-4 h-4 text-slate-400"/>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
            {recentActivity.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">Aucune activité récente.</p>
            )}
            {recentActivity.map((log) => (
              <div key={log.id} className="flex gap-3 items-start p-3 rounded hover:bg-slate-800/50 transition-colors border-l-2 border-slate-700">
                <div className="mt-1 w-2 h-2 rounded-full bg-blue-500" />
                <div>
                  <p className="text-sm font-medium text-white">{log.action} {log.entityType ? `(${log.entityType})` : ''}</p>
                  <p className="text-xs text-slate-400 flex items-center gap-2">
                    <Clock className="w-3 h-3"/>
                    {new Date(log.timestamp).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Par : {log.user || 'Système'}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Button variant="outline" onClick={() => onNavigateTab?.('projects')} className="h-20 border-dashed border-slate-700 hover:border-emerald-500 hover:bg-emerald-500/10 flex flex-col gap-2">
          <Plus className="w-6 h-6 text-emerald-500"/>
          <span className="text-emerald-500 font-bold">Nouveau Projet</span>
        </Button>
        <Button variant="outline" onClick={() => onNavigateTab?.('offers')} className="h-20 border-dashed border-slate-700 hover:border-blue-500 hover:bg-blue-500/10 flex flex-col gap-2">
          <Briefcase className="w-6 h-6 text-blue-500"/>
          <span className="text-blue-500 font-bold">Créer Offre</span>
        </Button>
        <Button variant="outline" onClick={() => onNavigateTab?.('investors')} className="h-20 border-dashed border-slate-700 hover:border-purple-500 hover:bg-purple-500/10 flex flex-col gap-2">
          <ShieldCheck className="w-6 h-6 text-purple-500"/>
          <span className="text-purple-500 font-bold">Valider KYC</span>
        </Button>
        <Button variant="outline" onClick={() => onNavigateTab?.('audit')} className="h-20 border-dashed border-slate-700 hover:border-amber-500 hover:bg-amber-500/10 flex flex-col gap-2">
          <ArrowRight className="w-6 h-6 text-amber-500"/>
          <span className="text-amber-500 font-bold">Voir le Journal</span>
        </Button>
      </div>
    </div>
  );
};

export default AdminInvestmentDashboard;
