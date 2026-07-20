import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

// Codes de statut réels (P01..P13, `investments.Project.Status` côté backend) — plus de
// libellés anglais fabriqués, la BadRequest/couleur suit le workflow réel à 13 étapes.
export const PROJECT_STATUS_LABELS = {
  P01: 'Prospection', P02: 'Analyse initiale', P03: 'Due diligence',
  P04: "Comité d'investissement", P05: 'Approbation conditionnelle', P06: 'Levée de fonds',
  P07: 'Souscription clôturée', P08: 'Décaissement', P09: 'En cours', P10: 'Remboursement',
  P11: 'Clôturé', P12: 'Défaut', P13: 'Annulé',
};

export const ProjectStatusBadge = ({ status }) => {
  const statusColors = {
    P01: 'bg-slate-500', P02: 'bg-slate-500', P03: 'bg-blue-500', P04: 'bg-blue-500',
    P05: 'bg-indigo-500', P06: 'bg-emerald-500', P07: 'bg-emerald-600', P08: 'bg-purple-500',
    P09: 'bg-teal-500', P10: 'bg-amber-500', P11: 'bg-green-600', P12: 'bg-red-600', P13: 'bg-slate-600',
  };
  return <Badge className={`${statusColors[status] || 'bg-slate-500'} text-white border-0`}>{PROJECT_STATUS_LABELS[status] || status}</Badge>;
};

export const RiskIndicator = ({ level }) => {
  const color = level === 'Low' ? 'bg-[hsl(var(--risk-low))]' : level === 'Medium' ? 'bg-[hsl(var(--risk-medium))]' : 'bg-[hsl(var(--risk-high))]';
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${color}`}></div>
      <span className="text-xs font-medium">{level}</span>
    </div>
  );
};

export const CreditScoreVisualization = ({ score }) => {
  const color = score >= 700 ? 'text-green-500' : score >= 500 ? 'text-yellow-500' : 'text-red-500';
  return <span className={`font-bold ${color}`}>{score}</span>;
};

export const SubscriptionProgressBar = ({ percent }) => {
  return (
    <div className="flex items-center gap-2 w-full">
      <Progress value={percent} className="flex-1 h-2" />
      <span className="text-xs text-muted-foreground w-10 text-right">{percent.toFixed(0)}%</span>
    </div>
  );
};

export const RepaymentStatusIndicator = ({ status }) => {
  const color = status === 'Paid' ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500';
  return <Badge className={`${color} text-white border-0`}>{status}</Badge>;
};

export const ManagerAssignmentBadge = ({ managerSub, managers }) => {
  const manager = managers.find(m => m.sub === managerSub);
  return <Badge variant="outline" className="text-xs">{manager ? manager.name : (managerSub || 'Unassigned')}</Badge>;
};

export const GeographicZoneBadge = ({ zone }) => {
  return <Badge variant="secondary" className="text-xs">{zone}</Badge>;
};

// Charts
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

export const FundAllocationChart = ({ data }) => {
  let parsed = [];
  try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { parsed = []; }
  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie data={parsed} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
          {parsed.map((_, i) => <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};

export const RevenueForecastChart = ({ data }) => {
  let parsed = [];
  try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { parsed = []; }
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={parsed}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="year" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export const PortfolioCompositionChart = ({ subscriptions, projects }) => {
  const data = subscriptions.reduce((acc, sub) => {
    const project = projects.find(p => p.id === sub.projectId);
    const sector = project ? project.sector : 'Inconnu';
    const existing = acc.find(item => item.name === sector);
    if (existing) existing.value += sub.amount;
    else acc.push({ name: sector, value: sub.amount });
    return acc;
  }, []);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" outerRadius={80} dataKey="value">
          {data.map((_, i) => <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};

export const PerformanceChart = () => {
  const data = Array.from({length: 12}, (_, i) => ({ month: `M${i+1}`, return: Math.random() * 5 + 5 }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="return" stroke="#10b981" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
};