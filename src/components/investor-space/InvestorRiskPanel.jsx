import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, Activity, Clock, PieChart } from 'lucide-react';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { buildExposureBars, rateToPercent, rateUnit } from '@/lib/investorSpaceWire';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6'];

const pct = (value) => `${(value ?? 0).toFixed(2).replace('.', ',')} %`;

const ExposureChart = ({ title, description, bars, currency }) => (
  <Card className="bg-slate-900 border-slate-800">
    <CardHeader>
      <CardTitle className="text-white flex items-center gap-2 text-base">
        <PieChart className="w-5 h-5 text-emerald-400" /> {title}
      </CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="h-[260px]">
      {bars.length === 0 ? (
        <div className="h-full flex items-center justify-center text-sm text-slate-500">
          Aucune position encaissée : il n’y a pas encore d’exposition à répartir.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
            <XAxis type="number" stroke="#64748b" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <YAxis type="category" dataKey="key" stroke="#64748b" width={120} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
              formatter={(value, _name, entry) => [
                `${formatCurrency(value, currency)} · ${pct(entry?.payload?.sharePercent)}`,
                'Exposition',
              ]}
            />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={22}>
              {bars.map((bar, index) => (
                <Cell key={bar.key} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </CardContent>
  </Card>
);

/**
 * Le risque du portefeuille — quatre mesures, toutes calculées par le serveur
 * sur les SEULES souscriptions de cet investisseur.
 *
 * Ce panneau n'existait pas tant que `investor_metrics()` ne servait que des
 * montants : l'écran affichait alors la liste de ce qu'il ne mesurait pas. Il
 * mesure désormais, et la discipline reste la même — chaque taux vient avec sa
 * BASE (un pourcentage sans base n'est pas une information), chaque axe de
 * concentration avec son effectif, le score de santé avec sa formule, ses
 * paramètres réellement appliqués et le détail de chaque pénalité, pour qu'un
 * investisseur puisse refaire le calcul à la main.
 *
 * L'unité de chaque taux est LUE dans `metrics.units`, jamais supposée.
 */
const InvestorRiskPanel = ({ metrics }) => {
  const { defaultRates, concentration, lateProjects, health, currency } = metrics;

  const defaultByValue = rateToPercent(defaultRates.byValue, rateUnit(metrics, 'defaultRates.byValue'));
  const defaultByCount = rateToPercent(defaultRates.byCount, rateUnit(metrics, 'defaultRates.byCount'));
  const alertThreshold = rateToPercent(
    defaultRates.alertThreshold, rateUnit(metrics, 'defaultRates.alertThreshold'),
  );
  const hhiRetained = concentration.herfindahlRetained;
  const hhiThreshold = concentration.threshold;
  const largestShare = rateToPercent(
    concentration.largestExposureShare, rateUnit(metrics, 'concentration.largestExposureShare'),
  );
  const lateShare = rateToPercent(lateProjects.share, rateUnit(metrics, 'lateProjects.share'));

  const axisLabel = concentration.retainedAxis === 'sector' ? 'secteur' : 'géographie';

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-2xl font-bold text-white mb-1">Le risque de votre portefeuille</h2>
        <p className="text-slate-400">
          Mesuré sur vos seules souscriptions — {metrics.scope}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <Card className={`bg-slate-900 ${defaultRates.alert ? 'border-red-500/40' : 'border-slate-800'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-red-500/20 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <Badge className={defaultRates.alert
                ? 'bg-red-500/20 text-red-300 border-0'
                : 'bg-emerald-500/20 text-emerald-300 border-0'}>
                {defaultRates.alert ? `Au-dessus de ${pct(alertThreshold)}` : 'Sous le seuil'}
              </Badge>
            </div>
            <h3 className="text-sm text-slate-400 mb-1">Taux de défaut — en valeur</h3>
            <p className="text-3xl font-bold text-white">{pct(defaultByValue)}</p>
            <p className="text-xs text-slate-500 mt-2">
              {formatCurrency(defaultRates.defaultedValue, currency)} en défaut sur{' '}
              {formatCurrency(defaultRates.totalValue, currency)} encaissés
            </p>
            {/* Les deux taux, toujours : un projet sur trente pèse peu en nombre
                et peut peser énormément en valeur. */}
            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
              En nombre : <span className="text-white font-semibold">{pct(defaultByCount)}</span>{' '}
              ({defaultRates.defaultedProjects} projet(s) sur {defaultRates.totalProjects})
            </p>
          </CardContent>
        </Card>

        <Card className={`bg-slate-900 ${concentration.highConcentration ? 'border-amber-500/40' : 'border-slate-800'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-amber-500/20 rounded-lg">
                <PieChart className="w-6 h-6 text-amber-400" />
              </div>
              <Badge className={concentration.highConcentration
                ? 'bg-amber-500/20 text-amber-300 border-0'
                : 'bg-emerald-500/20 text-emerald-300 border-0'}>
                seuil {hhiThreshold}
              </Badge>
            </div>
            <h3 className="text-sm text-slate-400 mb-1">Concentration (Herfindahl)</h3>
            <p className="text-3xl font-bold text-white">{hhiRetained}</p>
            <p className="text-xs text-slate-500 mt-2">
              Axe retenu : {axisLabel} · secteur {concentration.herfindahlSector} · zone{' '}
              {concentration.herfindahlGeography}
            </p>
            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
              {concentration.projectsCount} projet(s), {concentration.sectorsCount} secteur(s),{' '}
              {concentration.locationsCount} zone(s)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6">
            <div className="p-3 bg-blue-500/20 rounded-lg w-fit mb-4">
              <Activity className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-sm text-slate-400 mb-1">Plus grosse exposition</h3>
            <p className="text-3xl font-bold text-white">{pct(largestShare)}</p>
            <p className="text-xs text-slate-500 mt-2">
              {concentration.largestExposureProject ?? 'Aucun engagement'}
            </p>
            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
              Base : {formatCurrency(concentration.basisAmount, currency)} encaissés
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6">
            <div className="p-3 bg-purple-500/20 rounded-lg w-fit mb-4">
              <Clock className="w-6 h-6 text-purple-400" />
            </div>
            <h3 className="text-sm text-slate-400 mb-1">Projets en retard</h3>
            <p className="text-3xl font-bold text-white">{pct(lateShare)}</p>
            <p className="text-xs text-slate-500 mt-2">
              {lateProjects.lateProjects} sur {lateProjects.totalProjects} projet(s)
            </p>
            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
              {lateProjects.projectsWithSchedule} projet(s) dotés d’un échéancier
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Un plancher annoncé comme un plancher : sans échéancier, un retard ne
          peut pas être constaté, et le taux ci-dessus est incomplet. */}
      {lateProjects.scheduleCoverageWarning && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="p-4 text-sm text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{lateProjects.scheduleCoverageWarning}</span>
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Score de santé du portefeuille</CardTitle>
          <CardDescription>
            La formule et ses paramètres sont ceux réellement appliqués par le serveur, lus en
            base : vous pouvez refaire le calcul et retrouver le même chiffre.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="text-center lg:border-r lg:border-slate-800 lg:pr-6">
            <p className="text-6xl font-bold text-white mb-2">{health.score}</p>
            <p className="text-sm text-slate-400">sur 100</p>
            {health.clamped && (
              <p className="text-xs text-amber-400 mt-3">
                Score brut {health.rawScore}, ramené dans les bornes [0, 100].
              </p>
            )}
          </div>
          <div className="lg:col-span-2 space-y-4">
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
              <p className="text-xs text-slate-400 mb-1">Formule</p>
              <p className="font-mono text-sm text-slate-200 break-words">{health.formula}</p>
              <p className="text-xs text-slate-400 mt-2">
                a = {health.parameters.a} · b = {health.parameters.b} · c = {health.parameters.c} ·
                h₀ = {health.parameters.h0}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { key: 'default', label: 'Pénalité défaut', value: health.penalties.default },
                { key: 'concentration', label: 'Pénalité concentration', value: health.penalties.concentration },
                { key: 'late', label: 'Pénalité retard', value: health.penalties.late },
              ].map((p) => (
                <div key={p.key} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">{p.label}</p>
                  <p className="text-xl font-bold text-white">−{p.value}</p>
                </div>
              ))}
            </div>
            <Progress value={health.score} className="h-2" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ExposureChart
          title="Exposition par secteur"
          description="Montants et parts servis par le serveur — rien n’est agrégé ici."
          bars={buildExposureBars(concentration.exposureBySector)}
          currency={currency}
        />
        <ExposureChart
          title="Exposition par zone"
          description="Répartition géographique de votre capital encaissé."
          bars={buildExposureBars(concentration.exposureByLocation)}
          currency={currency}
        />
      </div>
    </div>
  );
};

export default InvestorRiskPanel;
