import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Users, DollarSign, Activity, AlertTriangle, TrendingUp } from 'lucide-react';
import { api } from '@/services/api';
import {
  asPortfolioMetrics, buildInstitutionCards, scopeNote,
} from '@/lib/adminInvestmentMetrics';

/**
 * Deux cartes de cet écran étaient calculées en React et l'une d'elles
 * contredisait l'autre back-office :
 *
 * - « Taux de Défaut » valait `montant des souscriptions DEFAULTED ÷ montant
 *   investi`, quand `AdminInvestmentDashboard` affichait, sous le MÊME libellé,
 *   `projets P12 ÷ projets`. Deux définitions, deux nombres, un seul mot.
 * - « Rendement Moyen » valait `Σ couponRate ÷ nombre d'offres` : une moyenne
 *   arithmétique NON PONDÉRÉE de coupons PROMIS, où une offre de 500 USD pesait
 *   autant qu'une de 500 000, et qui comptait les offres jamais financées.
 *
 * Les deux sont désormais servies par `GET /investments/metrics/portfolio` et
 * lues par `lib/adminInvestmentMetrics.ts`, partagé avec l'autre dashboard —
 * une seule définition, calculée une fois, en `Decimal`, côté serveur.
 *
 * Les compteurs conservés ci-dessous (projets, investisseurs, capital, avancement)
 * restent des DÉNOMBREMENTS et des sommes de montants de même nature : additionner
 * n'est pas dériver. Ils portent en revanche l'avertissement qui leur manquait —
 * ils ne comptent que ce que la page a chargé.
 */
export const AdminDashboard = ({ data }) => {
  const [portfolio, setPortfolio] = useState(null);
  const [refus, setRefus] = useState(null);

  useEffect(() => {
    let vivant = true;
    api.investments.metrics.portfolio()
      .then((m) => { if (vivant) { setPortfolio(asPortfolioMetrics(m)); setRefus(null); } })
      .catch((e) => { if (vivant) { setPortfolio(null); setRefus(e?.message || 'Mesures indisponibles.'); } });
    return () => { vivant = false; };
  }, []);

  const comptages = useMemo(() => {
    if (!data) return null;
    const totalProjects = data.projects.length;
    const activeProjects = data.projects.filter(p => ['P06', 'P07', 'P08'].includes(p.status)).length;
    const totalInvestors = data.investors.length;
    const activeInvestors = data.investors.filter(i => i.status === 'ACTIVE').length;
    const activeSubs = data.subscriptions.filter(s => s.status !== 'CANCELLED');
    const totalInvested = activeSubs.reduce((acc, s) => acc + s.amount, 0);
    const totalFunded = data.projects.reduce((acc, p) => acc + p.fundingTarget, 0);
    const fundedPercentage = totalFunded > 0 ? (totalInvested / totalFunded) * 100 : 0;
    return {
      totalProjects, activeProjects, totalInvestors, activeInvestors,
      totalInvested, totalFunded, fundedPercentage,
    };
  }, [data]);

  if (!comptages) return null;

  const cards = [
    { title: 'Projets Totaux', value: comptages.totalProjects, sub: `${comptages.activeProjects} actifs`, icon: Briefcase, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { title: 'Investisseurs', value: comptages.totalInvestors, sub: `${comptages.activeInvestors} actifs`, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { title: 'Capital engagé (chargé)', value: `$${comptages.totalInvested.toLocaleString('fr-FR')}`, sub: `Sur ${comptages.totalProjects} projets affichés`, icon: DollarSign, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { title: 'Objectif de Financement', value: `${comptages.fundedPercentage.toFixed(1)}%`, sub: `Sur $${comptages.totalFunded.toLocaleString('fr-FR')} de cibles affichées`, icon: Activity, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  ];

  const mesures = buildInstitutionCards(portfolio);
  const ICONES = { defaultByValue: AlertTriangle, defaultByCount: AlertTriangle, weightedIrr: TrendingUp };

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="bg-card border-border hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
                <div className={`p-2 rounded-md ${card.bg}`}>
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{card.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Mesures INSTITUTION — servies, avec leur définition et leur base. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {mesures.map((m, i) => {
          const Icon = ICONES[m.key] ?? Activity;
          return (
            <motion.div key={m.key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className={`bg-card border-border h-full ${m.alert ? 'border-amber-500/50' : ''}`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{m.label}</CardTitle>
                  <div className={`p-2 rounded-md ${m.alert ? 'bg-amber-500/10' : 'bg-slate-500/10'}`}>
                    <Icon className={`h-4 w-4 ${m.alert ? 'text-amber-400' : 'text-slate-400'}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  {m.value === null ? (
                    <>
                      <div className="text-lg font-semibold text-muted-foreground">Non disponible</div>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{m.unavailableReason}</p>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-foreground">{m.value}</div>
                      <p className="text-xs text-muted-foreground mt-1">{m.basis}</p>
                    </>
                  )}
                  <p className="text-[11px] text-muted-foreground/70 mt-2 pt-2 border-t border-border leading-relaxed">
                    {m.definition}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {refus
          ? `Mesures d'institution indisponibles : ${refus}. Aucun taux n'est recalculé depuis les listes de cette page — elles sont paginées, et une moyenne calculée sur une page n'est pas celle de l'institution.`
          : scopeNote(portfolio)}
      </p>
    </div>
  );
};
