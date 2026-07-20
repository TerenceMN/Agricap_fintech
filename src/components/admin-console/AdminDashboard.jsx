import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Users, DollarSign, Activity, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

export const AdminDashboard = ({ data }) => {
  const metrics = useMemo(() => {
    if (!data) return null;

    const totalProjects = data.projects.length;
    const activeProjects = data.projects.filter(p => ['P06', 'P07', 'P08'].includes(p.status)).length;

    const totalInvestors = data.investors.length;
    const activeInvestors = data.investors.filter(i => i.status === 'ACTIVE').length;

    const activeSubs = data.subscriptions.filter(s => s.status !== 'CANCELLED');
    const totalInvested = activeSubs.reduce((acc, s) => acc + s.amount, 0);
    const totalFunded = data.projects.reduce((acc, p) => acc + p.fundingTarget, 0);
    const fundedPercentage = totalFunded > 0 ? (totalInvested / totalFunded) * 100 : 0;

    const defaultedAmount = data.subscriptions.filter(s => s.status === 'DEFAULTED').reduce((acc, s) => acc + s.amount, 0);
    const defaultRate = totalInvested > 0 ? (defaultedAmount / totalInvested) * 100 : 0;

    const avgReturn = data.offers.length > 0
      ? data.offers.reduce((acc, o) => acc + o.couponRate, 0) / data.offers.length
      : 0;

    return {
      totalProjects, activeProjects,
      totalInvestors, activeInvestors,
      totalInvested, totalFunded, fundedPercentage,
      defaultRate, avgReturn,
    };
  }, [data]);

  if (!metrics) return null;

  const cards = [
    { title: 'Projets Totaux', value: metrics.totalProjects, sub: `${metrics.activeProjects} actifs`, icon: Briefcase, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { title: 'Investisseurs', value: metrics.totalInvestors, sub: `${metrics.activeInvestors} actifs`, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { title: 'Total Investi', value: `$${metrics.totalInvested.toLocaleString()}`, sub: `Sur ${metrics.totalProjects} projets`, icon: DollarSign, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { title: 'Objectif de Financement', value: `${metrics.fundedPercentage.toFixed(1)}%`, sub: `Sur $${metrics.totalFunded.toLocaleString()}`, icon: Activity, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { title: 'Taux de Défaut', value: `${metrics.defaultRate.toFixed(1)}%`, sub: 'Souscriptions en défaut', icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { title: 'Rendement Moyen', value: `${metrics.avgReturn.toFixed(1)}%`, sub: 'Coupon moyen des offres', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', trend: 'up' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      {cards.map((card, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
          <Card className="bg-card border-border hover:border-primary/50 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
              <div className={`p-2 rounded-md ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{card.value}</div>
              <div className="flex items-center mt-1">
                {card.trend === 'up' && <TrendingUp className="w-3 h-3 text-emerald-500 mr-1" />}
                {card.trend === 'down' && <TrendingDown className="w-3 h-3 text-emerald-500 mr-1" />}
                <p className="text-xs text-muted-foreground">{card.sub}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
};
