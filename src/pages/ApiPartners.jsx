import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle, XCircle, Clock, RefreshCw, Settings, Code2, Share2, Activity, History, ShieldAlert } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import { formatAuditAction } from '@/lib/auditLabels.js';

const StatusBadge = ({ status }) => {
  const config = {
    'Connecté': { variant: 'success', icon: <CheckCircle className="w-3 h-3" /> },
    'Actif': { variant: 'success', icon: <CheckCircle className="w-3 h-3" /> },
    'En attente': { variant: 'info', icon: <Clock className="w-3 h-3" /> },
    'Déconnecté': { variant: 'destructive', icon: <XCircle className="w-3 h-3" /> },
  };
  const current = config[status] || {};
  return <Badge variant={current.variant} className="gap-1.5">{current.icon} {status}</Badge>;
};

const CIRCUIT_LABELS = {
  CLOSED: { label: 'Disjoncteur fermé', className: 'text-emerald-400 border-emerald-500/30' },
  OPEN: { label: 'Disjoncteur ouvert', className: 'text-red-400 border-red-500/30' },
  HALF_OPEN: { label: 'Semi-ouvert (sonde)', className: 'text-amber-400 border-amber-500/30' },
};

const ConfigureDialog = ({ partner, onClose, onSave }) => {
  const [baseUrl, setBaseUrl] = useState('');
  useEffect(() => { setBaseUrl(partner?.baseUrl || ''); }, [partner]);

  return (
    <Dialog open={!!partner} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>Configurer {partner?.name}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Sans identifiants réels d'opérateur, seule l'URL de test (health check) est configurable ici.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label>URL de test</Label>
          <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.partenaire.example/health" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onSave(baseUrl)}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const LogsDialog = ({ partner, rows, onClose }) => (
  <Dialog open={!!partner} onOpenChange={onClose}>
    <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[70vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Journaux — {partner?.name}</DialogTitle></DialogHeader>
      {rows === null ? (
        <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-sm py-6 text-center">Aucun test ni synchronisation enregistré.</p>
      ) : (
        <div className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between items-center border-b border-slate-800 py-1.5">
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{r.type === 'health' ? 'Test' : 'Synchro'}</Badge>
                <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>{r.detail || (r.ok ? 'OK' : 'Échec')}</span>
                {r.latencyMs != null && <span className="text-slate-500 text-xs">({r.latencyMs}ms)</span>}
              </span>
              <span className="text-xs text-slate-500">{new Date(r.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

const ApiPartners = () => {
  const { toast } = useToast();
  const [partnersData, setPartnersData] = useState([]);
  const [activity, setActivity] = useState([]);
  const [configuring, setConfiguring] = useState(null);
  const [logsFor, setLogsFor] = useState(null);
  const [logRows, setLogRows] = useState(null);

  const loadPartners = () => api.partners.list().then(setPartnersData).catch(() => {});
  const loadActivity = () => api.audit.entries({ entity_type: 'Partner' }).then(setActivity).catch(() => setActivity([]));
  useEffect(() => { loadPartners(); loadActivity(); }, []);

  const handleSaveConfig = async (baseUrl) => {
    try {
      await api.partners.configure(configuring.id, { baseUrl });
      toast({ title: 'Configuration enregistrée', description: `${configuring.name} mis à jour.` });
      setConfiguring(null);
      loadPartners();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleSync = async (id, partnerName) => {
    try {
      await api.partners.sync(id);
      toast({ title: 'Synchronisation lancée', description: `${partnerName} synchronisé avec succès.` });
      loadPartners();
      loadActivity();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleTest = async (id, partnerName) => {
    try {
      const { check } = await api.partners.test(id);
      toast({
        title: check.ok ? 'Test réussi' : 'Test échoué',
        description: `${partnerName} : ${check.ok ? `OK (${check.latencyMs}ms)` : check.errorText}`,
        variant: check.ok ? undefined : 'destructive',
      });
      loadPartners();
      loadActivity();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const openLogs = async (partner) => {
    setLogsFor(partner);
    setLogRows(null);
    try {
      setLogRows(await api.partners.logs(partner.id));
    } catch {
      setLogRows([]);
    }
  };

  return (
    <Layout>
      <Helmet>
        <title>API & Partenaires - AGRICAP FINTECH</title>
        <meta name="description" content="Gestion des connexions API et des partenaires." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-4xl font-bold gradient-text">API & Partenaires</h1>
            <p className="text-gray-400">Gestion et suivi de l'interopérabilité avec les services tiers.</p>
          </div>
          <Link to="/api-docs">
            <Button variant="outline">
              <Code2 className="mr-2 h-4 w-4" />
              Documentation Développeur
            </Button>
          </Link>
        </div>
      </motion.div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {partnersData.map((partner, index) => (
          <motion.div
            key={partner.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 * index }}
            className="glass-effect p-6 rounded-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Share2 className="w-6 h-6 text-slate-300" />
                <h3 className="text-lg font-bold text-white">{partner.name}</h3>
              </div>
              <StatusBadge status={partner.status} />
            </div>
            <p className="text-sm text-slate-400 mb-1">Type: {partner.type || 'N/A'}</p>
            <p className="text-sm text-slate-400 mb-1">Dernière synchro: {partner.lastSync ? new Date(partner.lastSync).toLocaleString() : 'Jamais'}</p>
            <p className="text-sm text-slate-400 mb-3">URL de test: {partner.baseUrl || <span className="italic text-slate-600">non configurée</span>}</p>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className={`text-xs ${CIRCUIT_LABELS[partner.circuitState]?.className}`}>
                {CIRCUIT_LABELS[partner.circuitState]?.label || partner.circuitState}
              </Badge>
              {partner.consecutiveFailures > 0 && (
                <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30 gap-1">
                  <ShieldAlert className="w-3 h-3" /> {partner.consecutiveFailures} échec(s)
                </Badge>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfiguring(partner)}>
                <Settings className="w-4 h-4 mr-2" />
                Configurer
              </Button>
              <Button size="sm" variant="ghost" className="flex-1" onClick={() => handleSync(partner.id, partner.name)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Synchro
              </Button>
              <Button size="sm" variant="ghost" className="flex-1" onClick={() => handleTest(partner.id, partner.name)}>
                <Activity className="w-4 h-4 mr-2" />
                Tester
              </Button>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => openLogs(partner)}>
                <History className="w-4 h-4 mr-2" />
                Journaux
              </Button>
            </div>
          </motion.div>
        ))}
      </div>

       <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 glass-effect p-6 rounded-2xl"
      >
        <h2 className="text-xl font-bold text-white mb-4">Activité Récente de l'API</h2>
        {activity.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p>Aucune activité de synchronisation enregistrée pour le moment.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activity.slice(0, 20).map((entry) => (
              <div key={entry.id} className="flex justify-between items-center text-sm border-b border-slate-800 py-2">
                <span className="text-slate-300">{formatAuditAction(entry.action)} — {entry.details?.name || entry.entityId}</span>
                <span className="text-slate-500 text-xs">{new Date(entry.timestamp).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <ConfigureDialog partner={configuring} onClose={() => setConfiguring(null)} onSave={handleSaveConfig} />
      <LogsDialog partner={logsFor} rows={logRows} onClose={() => setLogsFor(null)} />
    </Layout>
  );
};

export default ApiPartners;
