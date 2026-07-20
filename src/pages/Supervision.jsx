import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, AlertCircle, ShieldCheck, FileDown, Bell, Activity, RefreshCcw, Info } from 'lucide-react';
import { XAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';
import { exportToExcel } from '@/lib/export.js';
import { formatAuditAction } from '@/lib/auditLabels.js';

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const SEVERITY_STYLE = {
  INFO: 'text-blue-400 border-blue-500/30',
  WARNING: 'text-amber-400 border-amber-500/30',
  CRITICAL: 'text-red-400 border-red-500/30',
};

const ComplianceDetailsDialog = ({ open, compliance, onClose }) => (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent className="bg-slate-900 border-slate-700 text-white">
      <DialogHeader>
        <DialogTitle>Détail du score de conformité</DialogTitle>
        <DialogDescription className="text-slate-400">
          Composantes sans donnée disponible (aucun profil KYC, aucun rapprochement clôturé...) sont ignorées
          et leur poids redistribué sur les autres, plutôt que comptées comme 0.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        {(compliance?.components || []).map((c) => (
          <div key={c.code} className="flex justify-between items-center border-b border-slate-800 py-2">
            <div>
              <p className="text-sm text-white">{c.label}</p>
              <p className="text-xs text-slate-500">Poids {(c.weight * 100).toFixed(0)}%</p>
            </div>
            <span className={`font-mono ${c.score === null ? 'text-slate-600' : 'text-emerald-400'}`}>
              {c.score === null ? 'N/D' : `${c.score}%`}
            </span>
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);

const AlertsDialog = ({ open, alerts, onClose, onAcknowledge, onResolve }) => (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[75vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Alertes actives</DialogTitle>
        <DialogDescription className="text-slate-400">
          Calculées à partir de règles configurables (agence suspendue, rapprochement en retard, score de
          conformité bas, transactions en retard, échecs partenaire) — pas des alertes créées à la main.
        </DialogDescription>
      </DialogHeader>
      {alerts.length === 0 ? (
        <p className="text-center text-slate-500 py-8">Aucune alerte active.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <Badge variant="outline" className={SEVERITY_STYLE[a.severity]}>{a.severity}</Badge>
                <span className="text-xs text-slate-500">{new Date(a.triggeredAt).toLocaleString()}</span>
              </div>
              <p className="text-sm text-white font-medium">{a.title}</p>
              {a.body && <p className="text-xs text-slate-400 mt-1">{a.body}</p>}
              <div className="flex justify-between items-center mt-2">
                <Badge variant="secondary" className="text-xs">{a.status}</Badge>
                <div className="flex gap-2">
                  {a.status === 'ACTIVE' && (
                    <Button size="sm" variant="outline" onClick={() => onAcknowledge(a.id)}>Acquitter</Button>
                  )}
                  {a.status !== 'RESOLVED' && (
                    <Button size="sm" variant="destructive" onClick={() => onResolve(a.id)}>Résoudre</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

const AlertRulesDialog = ({ open, rules, onClose, onToggle, onThresholdChange, onThresholdSave }) => (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[75vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Configuration des alertes</DialogTitle>
        <DialogDescription className="text-slate-400">
          Une règle désactivée n'est jamais supprimée — juste ignorée lors du prochain calcul.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        {rules.map((r) => (
          <div key={r.id} className="border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm text-white font-medium">{r.name}</p>
                <Badge variant="outline" className={SEVERITY_STYLE[r.severity]}>{r.severity}</Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{r.metric} {r.operator} {r.threshold}</p>
            </div>
            <Input
              type="number" value={r.threshold} onChange={e => onThresholdChange(r.id, e.target.value)}
              onBlur={() => onThresholdSave(r.id)}
              className="w-24 bg-slate-800/80 border-slate-700"
            />
            <Switch checked={r.enabled} onCheckedChange={() => onToggle(r.id, r.enabled)} />
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);

const Supervision = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ pendingCount: 0, postedCount: 0, specialCasesCount: 0, overdueCount: 0 });
  const [agencies, setAgencies] = useState([]);
  const [compliance, setCompliance] = useState({ score: null, deltaWow: null, components: [] });
  const [kycProfiles, setKycProfiles] = useState([]);
  const [volumeData, setVolumeData] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [alertRules, setAlertRules] = useState([]);
  const [showComplianceDetails, setShowComplianceDetails] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const loadAlerts = () => api.alerts.list({ status: 'ACTIVE' }).then(setActiveAlerts).catch(() => {});
  const loadRules = () => api.alerts.rules.list().then(setAlertRules).catch(() => {});

  useEffect(() => {
    api.transactions.supervision().then(setStats).catch(() => {});
    api.agencies.list().then(setAgencies).catch(() => {});
    api.analytics.complianceScore().then(setCompliance).catch(() => {});
    api.compliance.kycProfiles().then(setKycProfiles).catch(() => {});
    api.transactions.list().then((txs) => {
      const byMonth = {};
      txs.forEach((tx) => {
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        byMonth[key] = (byMonth[key] || 0) + tx.amount;
      });
      const now = new Date();
      const points = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        points.push({ month: MONTHS_FR[d.getMonth()], value: Math.round(byMonth[key] || 0) });
      }
      setVolumeData(points);
    }).catch(() => {});
    // `category: 'financial'` exclut les actions de configuration système (agences,
    // rôles/RBAC) — cette page supervise les OPÉRATIONS d'AGRICAP FINTECH (transactions,
    // investissements, crédits, épargne, trésorerie, contrats), pas l'administration.
    api.audit.entries({ category: 'financial' }).then((entries) => setRecentActivity(entries.slice(0, 4))).catch(() => {});
    loadAlerts();
    loadRules();
  }, []);

  const handleExportCompliance = () => {
    if (kycProfiles.length === 0) {
      toast({ title: 'Rien à exporter', description: 'Aucun profil KYC enregistré pour le moment.' });
      return;
    }
    exportToExcel(kycProfiles.map((p) => ({
      Utilisateur: p.userSub, Statut: p.kycStatus, 'Niveau de risque': p.riskScore,
      'Palier KYC': p.kycLevel, 'Limite mensuelle': p.monthlyLimit,
    })), 'rapport_conformite_kyc');
    toast({ title: 'Exportation réussie', description: 'Rapport de conformité KYC exporté en Excel.' });
  };

  const handleAcknowledge = async (id) => {
    try {
      await api.alerts.acknowledge(id);
      loadAlerts();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleResolve = async (id) => {
    try {
      await api.alerts.resolve(id);
      loadAlerts();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleToggleRule = async (id, currentlyEnabled) => {
    try {
      await api.alerts.rules.update(id, { enabled: !currentlyEnabled });
      loadRules();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleThresholdChange = (id, value) => {
    setAlertRules(rules => rules.map(r => r.id === id ? { ...r, threshold: value } : r));
  };

  const handleThresholdBlurSave = async (id) => {
    const rule = alertRules.find(r => r.id === id);
    if (!rule) return;
    try {
      await api.alerts.rules.update(id, { threshold: Number(rule.threshold) });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const activeAgencies = agencies.filter((a) => a.status === 'ACTIF').length;
  const networkPercent = agencies.length ? Math.round((activeAgencies / agencies.length) * 100) : null;
  // Compteur d'alertes critiques tiré du moteur d'alertes configurable — remplace l'ancien
  // total ad hoc (alertes agence jamais créées automatiquement + cas spéciaux manuels).
  const criticalAlertsCount = useMemo(
    () => activeAlerts.filter((a) => a.severity === 'CRITICAL').length,
    [activeAlerts],
  );

  return (
    <Layout>
      <Helmet><title>Supervision - AGRICAP FINTECH</title></Helmet>

      <div className="flex justify-between items-center mb-6">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-4xl font-bold gradient-text mb-2">Supervision Temps Réel</h1>
            <p className="text-gray-400">Monitoring global, conformité et alertes de la plateforme.</p>
          </motion.div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowRules(true)}><Bell className="w-4 h-4 mr-2"/> Config. Alertes</Button>
            <Button variant="outline" onClick={handleExportCompliance}><FileDown className="w-4 h-4 mr-2"/> Rapport Conformité</Button>
          </div>
      </div>

      <motion.div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
         <Card className="glass-effect border-emerald-500/30">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-400 flex items-center justify-between">Statut Réseau <Activity className="h-4 w-4 text-emerald-400"/></CardTitle></CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-emerald-400">{networkPercent !== null ? `${networkPercent}% Opérationnel` : 'N/D'}</div>
                <p className="text-xs text-slate-500 mt-1">{agencies.length ? `${activeAgencies}/${agencies.length} agences actives` : 'Aucune agence enregistrée'}</p>
            </CardContent>
         </Card>
         <Card className="glass-effect border-blue-500/30">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-400 flex items-center justify-between">Transactions en attente <RefreshCcw className="h-4 w-4 text-blue-400"/></CardTitle></CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-white">{stats.pendingCount}</div>
                <p className="text-xs text-blue-400 mt-1">{stats.postedCount} comptabilisées</p>
            </CardContent>
         </Card>
         <Card className="glass-effect border-amber-500/30">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-400 flex items-center justify-between">Score Conformité <ShieldCheck className="h-4 w-4 text-amber-400"/></CardTitle></CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-amber-400">{compliance.score !== null ? `${compliance.score}%` : 'N/D'}</div>
                <div className="flex items-center gap-2 mt-1">
                    {compliance.deltaWow !== null && (
                        <span className={`text-xs flex items-center gap-0.5 ${compliance.deltaWow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {compliance.deltaWow >= 0 ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
                            {compliance.deltaWow >= 0 ? '+' : ''}{compliance.deltaWow} pts (7j)
                        </span>
                    )}
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs text-slate-400" onClick={() => setShowComplianceDetails(true)}>
                        <Info className="w-3 h-3 mr-1"/> Détails
                    </Button>
                </div>
            </CardContent>
         </Card>
         <Card className="glass-effect border-red-500/30">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-400 flex items-center justify-between">Alertes Critiques <AlertCircle className="h-4 w-4 text-red-400"/></CardTitle></CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-red-400">{criticalAlertsCount} Actives</div>
                <p className="text-xs text-slate-500 mt-1">{activeAlerts.length} alerte(s) au total</p>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs text-red-300 mt-1" onClick={() => setShowAlerts(true)}>Examiner immédiat</Button>
            </CardContent>
         </Card>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="text-xl text-white">Volume Transactionnel (6 derniers mois)</CardTitle>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={volumeData}>
                        <defs>
                            <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" stroke="#9ca3af" />
                        <Tooltip contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.9)', border: 'none' }} />
                        <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#colorVol)" />
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>

        <Card className="glass-effect">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-xl text-white">Activités Récentes</CardTitle>
                    <CardDescription>Opérations financières d'AGRICAP FINTECH (transactions, crédits, investissements, épargne, trésorerie, contrats)</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate('/audit-log')}>Journal Complet</Button>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {recentActivity.length === 0 && <p className="text-sm text-slate-500">Aucune activité récente.</p>}
                    {recentActivity.map((entry) => (
                        <div key={entry.id} className="flex justify-between items-center border-b border-white/5 pb-2">
                            <div>
                                <p className="text-sm text-white font-medium">{formatAuditAction(entry.action)}</p>
                                <p className="text-xs text-slate-400">Par : {entry.user || 'Système'}{entry.role ? ` (${entry.role})` : ''}</p>
                            </div>
                            <span className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
      </div>

      <ComplianceDetailsDialog open={showComplianceDetails} compliance={compliance} onClose={() => setShowComplianceDetails(false)} />
      <AlertsDialog
        open={showAlerts} alerts={activeAlerts} onClose={() => setShowAlerts(false)}
        onAcknowledge={handleAcknowledge} onResolve={handleResolve}
      />
      <AlertRulesDialog
        open={showRules} rules={alertRules} onClose={() => { setShowRules(false); loadAlerts(); }}
        onToggle={handleToggleRule} onThresholdChange={handleThresholdChange} onThresholdSave={handleThresholdBlurSave}
      />
    </Layout>
  );
};

export default Supervision;
