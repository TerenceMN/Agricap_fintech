import React, { useEffect, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileDown, Search, X, RefreshCw } from 'lucide-react';
import { exportToExcel } from '@/lib/export.js';
import { formatAuditAction, formatAuditDetails } from '@/lib/auditLabels.js';
import { api } from '@/services/api';

const CATEGORIES = [
  { value: '', label: 'Toutes catégories' },
  { value: 'financial', label: 'Financières' },
];

const ENTITY_TYPES = [
  '', 'Agency', 'AgencyActionRequest', 'CashAccount', 'Withdrawal',
  'RegularizationOrder', 'Loan', 'Transaction', 'Ticket',
];

const AuditLog = () => {
  const [auditData, setAuditData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ entity_type: '', actor: '', category: '' });
  const [actorInput, setActorInput] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filters.entity_type) params.entity_type = filters.entity_type;
    if (filters.actor)       params.actor = filters.actor;
    if (filters.category)    params.category = filters.category;
    api.audit.entries(params)
      .then(setAuditData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const applyActorFilter = () => setFilters(f => ({ ...f, actor: actorInput.trim() }));
  const clearFilters = () => { setFilters({ entity_type: '', actor: '', category: '' }); setActorInput(''); };

  const handleExport = () => exportToExcel(auditData.map((log) => ({
    ...log,
    user: log.userName || log.user || 'Système',
    action: `${formatAuditAction(log.action)} (${log.action})`,
    details: formatAuditDetails(log.details),
  })), 'journal_audit');

  const hasFilters = filters.entity_type || filters.actor || filters.category;

  return (
    <Layout>
      <Helmet>
        <title>Journal d'Audit - AGRICAP FINTECH</title>
        <meta name="description" content="Journalisation de toutes les actions sur la plateforme." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold gradient-text mb-2">Journal d'Audit</h1>
        <p className="text-gray-400">Traçabilité complète de toutes les actions des utilisateurs et du système.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-6 glass-effect p-4 rounded-2xl flex flex-wrap gap-3 items-end"
      >
        {/* Acteur */}
        <div className="flex gap-2 items-end">
          <div>
            <p className="text-xs text-slate-400 mb-1">Acteur (sub)</p>
            <Input
              value={actorInput}
              onChange={e => setActorInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyActorFilter()}
              placeholder="sub-utilisateur..."
              className="h-8 text-sm bg-slate-900/50 border-slate-700 w-52"
            />
          </div>
          <Button size="sm" variant="outline" onClick={applyActorFilter} className="h-8">
            <Search className="w-3 h-3" />
          </Button>
        </div>

        {/* Type d'entité */}
        <div>
          <p className="text-xs text-slate-400 mb-1">Type d'entité</p>
          <select
            value={filters.entity_type}
            onChange={e => setFilters(f => ({ ...f, entity_type: e.target.value }))}
            className="h-8 text-sm bg-slate-900 border border-slate-700 rounded-md px-2 text-slate-200"
          >
            {ENTITY_TYPES.map(t => (
              <option key={t} value={t}>{t || 'Tous types'}</option>
            ))}
          </select>
        </div>

        {/* Catégorie */}
        <div>
          <p className="text-xs text-slate-400 mb-1">Catégorie</p>
          <select
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
            className="h-8 text-sm bg-slate-900 border border-slate-700 rounded-md px-2 text-slate-200"
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="flex gap-2 ml-auto">
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-slate-400">
              <X className="w-3 h-3 mr-1" /> Effacer
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={load} className="h-8" disabled={loading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} className="h-8">
            <FileDown className="w-3 h-3 mr-1" /> Exporter
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-4 glass-effect p-6 rounded-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            Entrées {hasFilters && <span className="text-slate-400 text-base font-normal">(filtrées)</span>}
          </h2>
          <span className="text-sm text-slate-500">{auditData.length} résultat{auditData.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 bg-slate-900/50 backdrop-blur-sm">
              <TableRow>
                <TableHead>Date / Heure</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entité</TableHead>
                <TableHead>Détails</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 py-12">Chargement…</TableCell>
                </TableRow>
              ) : auditData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 py-12">Aucune entrée.</TableCell>
                </TableRow>
              ) : auditData.map((log) => (
                <TableRow key={log.id} className="border-slate-800">
                  <TableCell className="font-mono text-slate-400 text-xs whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}
                  </TableCell>
                  <TableCell className="font-semibold text-sm" title={log.user}>
                    {log.userName || log.user || <span className="text-slate-500 italic">Système</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={!log.user ? 'secondary' : 'outline'} className="text-xs" title={log.action}>
                      {formatAuditAction(log.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {log.entityType && (
                      <span className="font-mono">{log.entityType}{log.entityId ? ` #${log.entityId}` : ''}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm" title={formatAuditDetails(log.details)}>
                    {formatAuditDetails(log.details)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{log.ip || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </motion.div>
    </Layout>
  );
};

export default AuditLog;
