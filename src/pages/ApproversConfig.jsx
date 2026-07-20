import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Plus, Trash2, Loader2, UserCheck, RefreshCw, Pencil, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';

const SCOPES = [
  { value: 'agency', label: 'Actions Agences' },
  { value: 'transaction', label: 'Transactions' },
  { value: 'caisse_regularization', label: 'Régularisation Caisses' },
  { value: 'caisse_withdrawal', label: 'Retraits Caisses' },
];

const ACTION_LABELS = {
  agency: {
    SUSPEND:           'Suspension d\'agence',
    CLOSE:             'Fermeture d\'agence',
    UNLOCK_TEMPORARY:  'Déverrouillage temporaire',
    REOPEN:            'Réouverture d\'agence',
  },
  transaction: {
    MULTI_SIG: 'Validation multi-signature',
  },
  caisse_regularization: {
    REGULARIZATION: 'Régularisation de caisse',
  },
  caisse_withdrawal: {
    WITHDRAWAL: 'Retrait hors seuil',
  },
};

const SCOPE_COLORS = {
  agency:                'text-amber-400 border-amber-500/30 bg-amber-500/10',
  transaction:           'text-blue-400 border-blue-500/30 bg-blue-500/10',
  caisse_regularization: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  caisse_withdrawal:     'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
};

// ---------------------------------------------------------------------------
// Dialog — ajouter un approbateur
// ---------------------------------------------------------------------------
const AddApproverDialog = ({ open, onOpenChange, users, onAdded, toast }) => {
  const [scope, setScope] = useState('agency');
  const [actionType, setActionType] = useState('');
  const [approverSub, setApproverSub] = useState('');
  const [approverPhone, setApproverPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const availableActions = Object.entries(ACTION_LABELS[scope] || {}).map(([v, l]) => ({ value: v, label: l }));
  const selectedUser = users.find(u => u.sub === approverSub);

  const handleScopeChange = (v) => { setScope(v); setActionType(''); };

  const handleApproverChange = (sub) => {
    setApproverSub(sub);
    const u = users.find(x => x.sub === sub);
    if (u?.phone && !approverPhone) setApproverPhone(u.phone);
  };

  const handleSubmit = async () => {
    if (!scope || !actionType || !approverSub) {
      toast({ variant: 'destructive', title: 'Champs manquants', description: 'Sélectionner un scope, une action et un approbateur.' });
      return;
    }
    setSaving(true);
    try {
      const cfg = await api.agencies.approverConfigs.create(
        scope, actionType, approverSub,
        selectedUser?.fullName || selectedUser?.email || approverSub,
        selectedUser?.role || '',
        approverPhone.trim(),
      );
      onAdded(cfg);
      onOpenChange(false);
      setScope('agency'); setActionType(''); setApproverSub(''); setApproverPhone('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <UserCheck className="w-5 h-5 text-emerald-400" /> Désigner un approbateur
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Scope</Label>
            <Select value={scope} onValueChange={handleScopeChange}>
              <SelectTrigger className="bg-slate-800/60 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                {SCOPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Action</Label>
            <Select value={actionType} onValueChange={setActionType} disabled={!availableActions.length}>
              <SelectTrigger className="bg-slate-800/60 border-slate-600 text-white">
                <SelectValue placeholder="Choisir une action…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                {availableActions.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Approbateur désigné</Label>
            <Select value={approverSub} onValueChange={handleApproverChange}>
              <SelectTrigger className="bg-slate-800/60 border-slate-600 text-white">
                <SelectValue placeholder="Choisir un utilisateur…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                {users.map(u => (
                  <SelectItem key={u.sub} value={u.sub}>
                    <span className="flex items-center gap-2">
                      <span>{u.fullName || u.email}</span>
                      <span className="text-xs text-slate-400">{u.role}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUser && (
            <div className="bg-slate-800/50 rounded-lg p-3 text-sm space-y-1">
              <p className="text-white font-medium">{selectedUser.fullName || selectedUser.email}</p>
              <p className="text-slate-400">Rôle : <span className="text-slate-200">{selectedUser.role}</span></p>
              <p className="text-slate-400">Email : <span className="text-slate-200">{selectedUser.email}</span></p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs flex items-center gap-1">
              Numéro de téléphone pour OTP
              <span className="text-red-400">*</span>
            </Label>
            <Input
              value={approverPhone}
              onChange={e => setApproverPhone(e.target.value)}
              placeholder="+243xxxxxxxxx"
              className="bg-slate-800/60 border-slate-600 text-white font-mono"
            />
            <p className="text-xs text-amber-400/70">
              Le code OTP sera envoyé par SMS à ce numéro lors des approbations.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-600">Annuler</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserCheck className="w-4 h-4 mr-2" />}
            Désigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Dialog — modifier le numéro de téléphone d'un approbateur existant
// ---------------------------------------------------------------------------
const EditPhoneDialog = ({ cfg, open, onOpenChange, onSaved, toast, users = [] }) => {
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    if (cfg.approverPhone) {
      setPhone(cfg.approverPhone);
    } else {
      // Cherche le téléphone dans le profil utilisateur
      const u = users.find(x => x.sub === cfg.approverSub);
      setPhone(u?.phone || '');
    }
  }, [cfg, users]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.agencies.approverConfigs.updatePhone(cfg.id, phone.trim());
      onSaved(cfg.id, res.approverPhone);
      onOpenChange(false);
      toast({ title: 'Numéro mis à jour', description: `SMS OTP → ${res.approverPhone || '(effacé)'}` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white border-slate-700 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Phone className="w-4 h-4 text-emerald-400" /> Modifier le numéro OTP
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-400">
            Approbateur : <span className="text-white font-medium">{cfg?.approverName || cfg?.approverSub}</span>
          </p>
          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Numéro de téléphone</Label>
            <Input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+243xxxxxxxxx"
              className="bg-slate-800/60 border-slate-600 text-white font-mono"
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <p className="text-xs text-amber-400/70">Le code OTP sera envoyé à ce numéro lors des approbations.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-600">Annuler</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Phone className="w-4 h-4 mr-2" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------
const ApproversConfig = () => {
  const { toast } = useToast();
  const [configs, setConfigs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [editPhoneCfg, setEditPhoneCfg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgs, usrs] = await Promise.all([
        api.agencies.approverConfigs.list(),
        api.rbac.users.list(),
      ]);
      setConfigs(cfgs);
      setUsers(usrs);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Chargement impossible', description: e.message });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (id) => {
    setRemoving(id);
    try {
      await api.agencies.approverConfigs.remove(id);
      setConfigs(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Supprimé', description: 'Approbateur retiré.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erreur', description: e.message });
    } finally { setRemoving(null); }
  };

  const handlePhoneSaved = (id, newPhone) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, approverPhone: newPhone } : c));
  };

  // Grouper par scope > actionType
  const grouped = configs.reduce((acc, c) => {
    const key = `${c.scope}__${c.actionType}`;
    if (!acc[key]) acc[key] = { scope: c.scope, actionType: c.actionType, items: [] };
    acc[key].items.push(c);
    return acc;
  }, {});

  const scopeOrder = ['agency', 'transaction', 'caisse_regularization', 'caisse_withdrawal'];
  const sortedGroups = Object.values(grouped).sort((a, b) => {
    const si = scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope);
    return si !== 0 ? si : a.actionType.localeCompare(b.actionType);
  });

  const scopeLabel = (s) => SCOPES.find(x => x.value === s)?.label || s;
  const actionLabel = (scope, type) => ACTION_LABELS[scope]?.[type] || type;

  // Regrouper par scope pour afficher les en-têtes de section
  const byScope = scopeOrder.reduce((acc, s) => {
    const groups = sortedGroups.filter(g => g.scope === s);
    if (groups.length) acc[s] = groups;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-400" /> Configuration des Approbateurs
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Désigne les utilisateurs autorisés à approuver chaque type d'action sensible.
            Si aucun approbateur n'est configuré pour une action, tout utilisateur ayant la capacité <code className="text-slate-300">validate</code> peut approuver.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="border-slate-600" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </Button>
          <Button onClick={() => setAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2" /> Ajouter un approbateur
          </Button>
        </div>
      </motion.div>

      {loading && (
        <div className="flex justify-center items-center h-40 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Chargement…
        </div>
      )}

      {!loading && Object.keys(byScope).length === 0 && (
        <div className="text-center py-20 text-slate-500">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Aucun approbateur configuré.</p>
          <p className="text-xs mt-1">Cliquez sur « Ajouter un approbateur » pour commencer.</p>
        </div>
      )}

      {!loading && Object.entries(byScope).map(([scope, groups]) => (
        <motion.section key={scope} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Badge variant="outline" className={`${SCOPE_COLORS[scope]} text-xs px-2 py-0.5`}>
              {scopeLabel(scope)}
            </Badge>
          </h2>
          <div className="space-y-3">
            {groups.map(group => (
              <div key={`${group.scope}__${group.actionType}`} className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3 bg-slate-800/60 border-b border-slate-700/40">
                  <ShieldCheck className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-white text-sm">{actionLabel(group.scope, group.actionType)}</span>
                  <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-600 ml-auto">
                    {group.items.length} approbateur{group.items.length > 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="divide-y divide-slate-700/30">
                  {group.items.map(cfg => (
                    <div key={cfg.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold text-xs">
                          {(cfg.approverName || cfg.approverSub).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{cfg.approverName || cfg.approverSub}</p>
                          <p className="text-xs text-slate-400">
                            Rôle : <span className="text-slate-300">{cfg.approverRole || '—'}</span>
                            {cfg.approverPhone
                              ? <> · <span className="font-mono text-emerald-400">{cfg.approverPhone}</span></>
                              : <> · <span className="text-amber-400">⚠ Pas de numéro (SMS impossible)</span></>}
                            {cfg.assignedBy && <> · par <span className="text-slate-300">{cfg.assignedBy}</span></>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditPhoneCfg(cfg)}
                          title="Modifier le numéro OTP"
                          className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(cfg.id)}
                          disabled={removing === cfg.id}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          {removing === cfg.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ))}

      <AddApproverDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        users={users}
        onAdded={(cfg) => { setConfigs(prev => [...prev, cfg]); toast({ title: 'Approbateur ajouté', description: `${cfg.approverName || cfg.approverSub} pour ${cfg.actionType}` }); }}
        toast={toast}
      />

      <EditPhoneDialog
        cfg={editPhoneCfg}
        open={!!editPhoneCfg}
        onOpenChange={(v) => { if (!v) setEditPhoneCfg(null); }}
        onSaved={handlePhoneSaved}
        toast={toast}
        users={users}
      />
    </div>
  );
};

export default ApproversConfig;
