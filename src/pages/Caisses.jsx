/**
 * Vue « Caisses » — `/caisses`.
 *
 * Ce que cet écran AJOUTE au-dessus de la gestion générique des comptes de
 * trésorerie (`pages/Wallets.jsx`) : il ne montre QUE les caisses (`kind=CAISSE`)
 * et il fait remonter, ligne par ligne, la valeur déjà servie par le backend que
 * la table générique laissait invisible —
 *   • la séance de caisse ouverte (« ouverte depuis » / « aucune séance ») ;
 *   • le plafond journalier en jauge (`cashInTotal` / `dailyCeiling`) ;
 *   • le gel automatique sur écart de clôture (`status=BLOQUE`, dernier écart) ;
 *   • le rattachement partenaire pour les caisses qui en portent un.
 *
 * ─── DEUX SOURCES, DEUX RÔLES ────────────────────────────────────────────────
 * Le prototype Horizons (`Wallets.jsx`, `Treasury.jsx`) a fixé l'ergonomie ; le
 * backend `caisses/` est la SEULE source de données. Là où le prototype réclamait
 * une donnée que le serveur ne sert pas (grandeur de placement, delta 24 h,
 * pourcentage de risque, série temporelle), l'élément est supprimé, pas inventé.
 *
 * ─── ZÉRO RECALCUL, ZÉRO DEVISE EN DUR ───────────────────────────────────────
 * Soldes, écarts, cumuls, tolérances viennent du serveur. Les sommes par devise
 * et les dénombrements de statuts sont de la présentation de faits servis (à
 * devise constante, jamais fusionnée). Tout montant passe par `formatMontant`.
 *
 * ─── LOGIQUE, DIALOGUES, FORMATEURS : CONSOMMÉS, PAS RÉÉCRITS (principe 6) ─────
 * La logique pure (jauge, verdict de clôture, éventail borné, troncature) vit,
 * TYPÉE, dans `pages/caissesWire.ts`. Les dialogues (séance, plafond, flux,
 * transfert, gérant, partenaire, détails, création) sont ceux de
 * `components/treasury/CaisseDialogs`, partagés avec `Wallets.jsx`. Le formateur
 * de montants est celui du projet.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Plus, Search, Snowflake, AlertTriangle, MoreHorizontal, Eye, FileText, Edit, FileDown,
  Landmark, Upload, Shuffle, Calculator, Gauge, Lock, Trash2, ListChecks, History, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { api, ApiError } from '@/services/api';
import { exportToExcel } from '@/lib/export.js';
import { formatMontant, formatDateFr } from '@/components/guarantees/format';
import {
  AccountFormModal, TransferModal, FlowModal, ReassignModal, DetailsModal,
  RegisterDialog, PartnerLinkDialog, CeilingModal,
  RISK_LEVEL_LABEL, RISK_LEVEL_CLASS, KIND_CODE_TO_LABEL,
} from '@/components/treasury/CaisseDialogs';
import { CeilingGauge, SeanceCell, EcartGelCell, CaisseStatusBadge } from '@/components/treasury/CaisseCells';
import {
  asAccountRows, ceilingGauge, findOpenSession, lastClosure, loadSessionsFanned,
  totalsByCurrency, countByStatus, frozenAccounts, serverLimitNote,
  isFlowDisabled, MAX_CAISSES_BEFORE_FILTER, SESSION_FANOUT_CONCURRENCY,
} from '@/pages/caissesWire';

const StatCard = ({ icon: Icon, label, value, tone = 'text-white' }) => (
  <div className="glass-effect p-4 rounded-xl flex flex-col justify-between">
    <div className="flex items-center justify-between">
      <p className="text-sm text-slate-400">{label}</p>
      <Icon className="w-4 h-4 text-slate-500" />
    </div>
    <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
  </div>
);

/** Panneau latéral en lecture seule : les séances d'UNE caisse (contrat serveur :
 *  100 lignes les plus récentes, un compte à la fois). */
const SessionsPanel = ({ account, onClose }) => {
  const [sessions, setSessions] = useState(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!account) return;
    setSessions(undefined);
    setFailed(false);
    api.caisses.accounts.registerSessions(account.code)
      .then(setSessions)
      .catch(() => { setSessions([]); setFailed(true); });
  }, [account]);

  const note = serverLimitNote(sessions);

  return (
    <Dialog open={!!account} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Séances de caisse — {account?.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{account?.code}</DialogDescription>
        </DialogHeader>
        {note && (
          <p className="text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {note}
          </p>
        )}
        {sessions === undefined ? (
          <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
        ) : failed ? (
          <p className="text-red-400 text-sm py-6 text-center">Séances indisponibles pour ce compte.</p>
        ) : sessions.length === 0 ? (
          <p className="text-slate-500 text-sm py-6 text-center">Aucune séance enregistrée.</p>
        ) : (
          <div className="overflow-x-auto max-h-[50vh]">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 text-xs">
                  <TableHead>Ouverte</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Comptage ouv.</TableHead>
                  <TableHead>Encaissé</TableHead>
                  <TableHead>Comptage clôt.</TableHead>
                  <TableHead>Écart</TableHead>
                  <TableHead>Clôturée</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id} className="border-slate-800 text-sm">
                    <TableCell className="text-xs">{formatDateFr(s.openedAt)}</TableCell>
                    <TableCell><CaisseStatusBadge status={s.status === 'DISCREPANCY' ? 'BLOQUE' : 'ACTIF'} /></TableCell>
                    <TableCell className="font-mono text-xs">{formatMontant(s.openingCount, account?.currency)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatMontant(s.cashInTotal, account?.currency)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatMontant(s.closingCount, account?.currency)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatMontant(s.discrepancy, account?.currency)}</TableCell>
                    <TableCell className="text-xs">{formatDateFr(s.closedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Caisses = () => {
  const { toast } = useToast();
  const auth = useAuth();
  const caps = auth?.user?.capabilities ?? {};

  const [accounts, setAccounts] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [sessionsMap, setSessionsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [agencyFilter, setAgencyFilter] = useState(''); // '' = toutes (serveur)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deviseFilter, setDeviseFilter] = useState('all');
  const [seanceFilter, setSeanceFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [flowAccount, setFlowAccount] = useState(null);
  const [transferAccount, setTransferAccount] = useState(null);
  const [reassignAccount, setReassignAccount] = useState(null);
  const [detailsAccount, setDetailsAccount] = useState(null);
  const [registerAccount, setRegisterAccount] = useState(null);
  const [ceilingAccount, setCeilingAccount] = useState(null);
  const [partnerAccount, setPartnerAccount] = useState(null);
  const [sessionsAccount, setSessionsAccount] = useState(null);

  // Chargement : UN appel `/accounts` (filtrable par agence côté serveur), puis filtre
  // `kind==='CAISSE'` côté front. L'éventail des séances n'est déclenché que si le volume
  // le permet (≤ 25 caisses) ou si une agence est sélectionnée.
  const loadAccounts = useCallback(async (agencyId) => {
    setLoading(true);
    setLoadError(null);
    try {
      const raw = await api.caisses.accounts.list(agencyId ? Number(agencyId) : undefined);
      const caisses = asAccountRows(raw).filter((a) => a.kind === 'CAISSE');
      setAccounts(caisses);

      const gated = caisses.length > MAX_CAISSES_BEFORE_FILTER && !agencyId;
      if (gated) {
        setSessionsMap({});
      } else {
        const map = await loadSessionsFanned(
          caisses.map((a) => a.code),
          (code) => api.caisses.accounts.registerSessions(code),
          { concurrency: SESSION_FANOUT_CONCURRENCY },
        );
        setSessionsMap(map);
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : String(e));
      setAccounts([]);
      setSessionsMap({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(agencyFilter); }, [agencyFilter, loadAccounts]);
  useEffect(() => { api.agencies.list().then(setAgencies).catch(() => {}); }, []);

  const reload = () => loadAccounts(agencyFilter);

  const agencyNameById = useMemo(() => {
    const m = new Map();
    agencies.forEach((a) => m.set(a.id, a.name));
    return m;
  }, [agencies]);

  const sessionsGated = accounts.length > MAX_CAISSES_BEFORE_FILTER && !agencyFilter;
  const loadedSessionsCount = useMemo(
    () => Object.values(sessionsMap).filter((f) => f.ok).length,
    [sessionsMap],
  );

  // Chaque ligne, enrichie de son état de séance servi (échec isolé toléré).
  const rows = useMemo(() => accounts.map((account) => {
    const fetched = sessionsMap[account.code];
    const sessions = fetched && fetched.ok ? fetched.sessions : undefined;
    const sessionsError = !!fetched && !fetched.ok;
    const openSession = findOpenSession(sessions);
    return {
      account,
      sessions,
      sessionsError,
      openSession,
      gauge: ceilingGauge({ dailyCeiling: account.dailyCeiling, openSession }),
      closure: lastClosure(sessions),
    };
  }), [accounts, sessionsMap]);

  const visibleRows = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return rows.filter(({ account, openSession }) => {
      const matchesSearch = !q
        || account.name.toLowerCase().includes(q)
        || account.code.toLowerCase().includes(q)
        || (account.manager || '').toLowerCase().includes(q)
        || (account.scope || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || account.status === statusFilter;
      const matchesDevise = deviseFilter === 'all' || account.currency === deviseFilter;
      const matchesSeance = seanceFilter === 'all'
        || (seanceFilter === 'open' && !!openSession)
        || (seanceFilter === 'none' && !openSession);
      return matchesSearch && matchesStatus && matchesDevise && matchesSeance;
    });
  }, [rows, searchTerm, statusFilter, deviseFilter, seanceFilter]);

  const deviseTotals = useMemo(() => totalsByCurrency(accounts), [accounts]);
  const currencies = useMemo(() => [...new Set(accounts.map((a) => a.currency))].sort(), [accounts]);
  const frozen = useMemo(() => frozenAccounts(accounts), [accounts]);

  // ─── Actions (gardées par capacité côté affichage ; le serveur re-vérifie) ───
  const runAction = async (label, fn) => {
    try {
      await fn();
      toast({ title: label });
      reload();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleCreate = (form) =>
    runAction('Caisse créée', () => api.caisses.accounts.create({
      code: form.code, name: form.name, kind: form.kind || 'CAISSE', currency: form.currency,
      agencyId: form.agencyId || null, manager: form.manager, initialAmount: form.initialAmount,
    }).then(() => setCreateOpen(false)));

  const handleEdit = (form) => {
    if (!editAccount) return Promise.resolve();
    const data = { name: form.name, manager: form.manager, scope: form.scope };
    if (form.riskLevel) data.riskLevel = form.riskLevel;
    return runAction('Caisse mise à jour', () => api.caisses.accounts.update(editAccount.code, data).then(() => setEditAccount(null)));
  };

  const handleFlow = (amount, direction, reason) => {
    if (!flowAccount) return Promise.resolve();
    return runAction('Flux ajouté', () => api.caisses.accounts.addFlow(flowAccount.code, Number(amount), direction, reason).then(() => setFlowAccount(null)));
  };

  const handleTransfer = (toCode, amount, reason) => {
    if (!transferAccount) return Promise.resolve();
    return runAction('Transfert effectué', () => api.caisses.accounts.transfer(transferAccount.code, toCode, Number(amount), reason).then(() => setTransferAccount(null)));
  };

  const handleReassign = (manager) => {
    if (!reassignAccount) return Promise.resolve();
    return runAction('Gérant changé', () => api.caisses.accounts.reassign(reassignAccount.code, manager).then(() => setReassignAccount(null)));
  };

  const handleCeiling = (value) => {
    if (!ceilingAccount) return Promise.resolve();
    return runAction('Plafond journalier mis à jour', () => api.caisses.accounts.setDailyCeiling(ceilingAccount.code, value).then(() => setCeilingAccount(null)));
  };

  const exportRows = () => {
    // Colonnes assainies : le serveur ne sert ni grandeur de placement, ni
    // pourcentage tiré d'un niveau de risque catégoriel. Le risque sort en
    // LIBELLÉ (Faible/Modéré/Élevé), jamais en nombre.
    const data = visibleRows.map(({ account: a }) => ({
      'ID': a.code,
      'Caisse': a.name,
      'Type': KIND_CODE_TO_LABEL[a.kind] ?? a.kind,
      'Partenaire': a.partnerName || '—',
      'Gestionnaire': a.manager || '—',
      'Solde': a.balance,
      'Devise': a.currency,
      'Statut': a.status,
      'Zone': a.scope || '—',
      'Niveau de risque': RISK_LEVEL_LABEL[a.riskLevel] ?? (a.riskLevel || 'non servi'),
      'Agence': a.agencyId != null ? (agencyNameById.get(a.agencyId) ?? String(a.agencyId)) : 'Siège (HQ)',
    }));
    exportToExcel(data, 'rapport_caisses');
    toast({ title: 'Exportation réussie', description: "Le fichier 'rapport_caisses.xlsx' a été téléchargé." });
  };

  // Objet « wallet » attendu par les dialogues partagés (mapping stable).
  const asWallet = (a) => ({
    id: a.code, name: a.name, type: a.kind, manager: a.manager || '-', balance: a.balance,
    currency: a.currency, initialAmount: a.initialAmount, status: a.status, scope: a.scope || '-',
    riskLevel: a.riskLevel, createdAt: a.createdAt, dailyCeiling: a.dailyCeiling,
    partnerId: a.partnerId, partnerName: a.partnerName,
  });
  const walletsForTransfer = useMemo(() => accounts.map(asWallet), [accounts]);

  return (
    <>
      <Helmet>
        <title>Caisses - AGRICAP FINTECH</title>
        <meta name="description" content="Gestion des caisses : séances de billetage, plafonds journaliers, gels sur écart." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold gradient-text mb-2">Caisses</h1>
        <p className="text-gray-400">Billetage physique, plafonds journaliers et gels sur écart des comptes de caisse.</p>
      </motion.div>

      {/* Bandeau par devise — jamais fusionné, aucun delta 24 h (le serveur ne sert pas de série). */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {deviseTotals.map((d) => (
          <StatCard key={d.currency} icon={Wallet} label={`Fonds gérés — ${d.currency}`}
            value={<span>{formatMontant(d.total, d.currency)} · {d.count} caisses</span>} />
        ))}
        <StatCard icon={Landmark} label="Caisses actives" value={countByStatus(accounts, 'ACTIF')} tone="text-emerald-400" />
        <StatCard icon={AlertTriangle} label="Sous observation" value={countByStatus(accounts, 'EN_OBSERVATION')} tone="text-amber-400" />
        <StatCard icon={Snowflake} label="Caisses gelées" value={frozen.length} tone="text-red-400" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mt-8 glass-effect rounded-2xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
          <div className="relative w-full lg:w-1/4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Nom, ID, gérant, zone..." className="pl-10 bg-slate-900/50 border-slate-700"
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <Select value={agencyFilter || 'all'} onValueChange={(v) => setAgencyFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-full lg:w-44 bg-slate-900/50 border-slate-700"><SelectValue placeholder="Agence" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les agences</SelectItem>
              {agencies.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full lg:w-40 bg-slate-900/50 border-slate-700"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="ACTIF">Actif</SelectItem>
              <SelectItem value="EN_TRAITEMENT">En traitement</SelectItem>
              <SelectItem value="EN_OBSERVATION">En observation</SelectItem>
              <SelectItem value="BLOQUE">Gelé</SelectItem>
              <SelectItem value="ARCHIVE">Archivé</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deviseFilter} onValueChange={setDeviseFilter}>
            <SelectTrigger className="w-full lg:w-32 bg-slate-900/50 border-slate-700"><SelectValue placeholder="Devise" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes devises</SelectItem>
              {currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={seanceFilter} onValueChange={setSeanceFilter} disabled={sessionsGated}>
            <SelectTrigger className="w-full lg:w-40 bg-slate-900/50 border-slate-700"><SelectValue placeholder="Séance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toute séance</SelectItem>
              <SelectItem value="open">Séance ouverte</SelectItem>
              <SelectItem value="none">Aucune séance</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2 lg:ml-auto">
            <Button variant="outline" onClick={exportRows}><FileDown className="w-4 h-4 mr-2" />Exporter</Button>
            {caps.create && (
              <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />Créer une caisse
              </Button>
            )}
          </div>
        </div>

        {/* Périmètre affiché, honnête sur ce qui est chargé. */}
        <p className="text-xs text-slate-500 mb-3">
          {visibleRows.length} caisses affichées · séances chargées pour {loadedSessionsCount} compte(s)
          {sessionsGated && ' — plus de 25 caisses : sélectionnez une agence pour charger les séances.'}
        </p>

        {loading ? (
          <p className="text-slate-500 text-sm py-10 text-center">Chargement des caisses...</p>
        ) : loadError ? (
          <p className="text-red-400 text-sm py-10 text-center">Erreur de chargement : {loadError}</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-slate-500 text-sm py-10 text-center">Aucune caisse ne correspond aux filtres.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent text-xs whitespace-nowrap">
                  <TableHead>ID</TableHead>
                  <TableHead>Caisse</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Partenaire</TableHead>
                  <TableHead>Gérant</TableHead>
                  <TableHead>Solde</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Risque</TableHead>
                  <TableHead>Agence</TableHead>
                  <TableHead>Séance</TableHead>
                  <TableHead>Plafond du jour</TableHead>
                  <TableHead>Dernier écart</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map(({ account: a, openSession, gauge, closure, sessionsError }) => (
                  <TableRow key={a.code} className={`border-slate-800 text-sm ${a.status === 'BLOQUE' ? 'bg-red-500/5' : ''}`}>
                    <TableCell className="font-mono text-xs text-slate-400">{a.code}</TableCell>
                    <TableCell className="font-semibold text-white">{a.name}</TableCell>
                    <TableCell>{KIND_CODE_TO_LABEL[a.kind] ?? a.kind}</TableCell>
                    <TableCell className="text-xs text-slate-400">{a.partnerName || '—'}</TableCell>
                    <TableCell className="text-xs">{a.manager || '—'}</TableCell>
                    <TableCell className="font-mono text-emerald-400">{formatMontant(a.balance, a.currency)}</TableCell>
                    <TableCell><CaisseStatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-xs">{a.scope || '—'}</TableCell>
                    <TableCell>
                      <span className={RISK_LEVEL_CLASS[a.riskLevel] ?? 'text-slate-400'}>
                        {RISK_LEVEL_LABEL[a.riskLevel] ?? (a.riskLevel || 'non servi')}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{a.agencyId != null ? (agencyNameById.get(a.agencyId) ?? a.agencyId) : 'Siège (HQ)'}</TableCell>
                    <TableCell>
                      {sessionsError
                        ? <span className="text-xs text-amber-400">séances indisponibles</span>
                        : <SeanceCell openSession={openSession} />}
                    </TableCell>
                    <TableCell>
                      {sessionsError
                        ? <span className="text-xs text-slate-500">—</span>
                        : <CeilingGauge gauge={gauge} currency={a.currency} />}
                    </TableCell>
                    <TableCell>
                      {sessionsError
                        ? <span className="text-xs text-slate-500">—</span>
                        : <EcartGelCell closure={closure} currency={a.currency} />}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                          <DropdownMenuItem onSelect={() => setDetailsAccount(a)}><Eye className="mr-2 h-4 w-4" />Voir détails</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setSessionsAccount(a)}><ListChecks className="mr-2 h-4 w-4" />Voir séances</DropdownMenuItem>
                          {caps.create && (
                            <DropdownMenuItem onSelect={() => setEditAccount(a)}><Edit className="mr-2 h-4 w-4" />Modifier</DropdownMenuItem>
                          )}
                          {caps.validate && (
                            <>
                              <DropdownMenuSeparator className="bg-slate-700" />
                              <DropdownMenuItem onSelect={() => setRegisterAccount(a)}><Calculator className="mr-2 h-4 w-4" />Séance de caisse</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setCeilingAccount(a)}><Gauge className="mr-2 h-4 w-4" />Plafond journalier</DropdownMenuItem>
                              <DropdownMenuItem disabled={isFlowDisabled(a)} onSelect={() => { if (!isFlowDisabled(a)) setFlowAccount(a); }}>
                                <Landmark className="mr-2 h-4 w-4" />Ajouter flux
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setTransferAccount(a)}><Upload className="mr-2 h-4 w-4" />Transférer</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setReassignAccount(a)}><Shuffle className="mr-2 h-4 w-4" />Changer de gérant</DropdownMenuItem>
                              {a.partnerId != null && (
                                <DropdownMenuItem onSelect={() => setPartnerAccount(a)}><FileText className="mr-2 h-4 w-4" />Partenaire API</DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="bg-slate-700" />
                              <DropdownMenuItem onSelect={() => runAction('Caisse bloquée', () => api.caisses.accounts.block(a.code))} className="text-yellow-400 focus:text-yellow-300"><Lock className="mr-2 h-4 w-4" />Bloquer</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => runAction('Caisse archivée', () => api.caisses.accounts.archive(a.code))} className="text-red-400 focus:text-red-300"><Trash2 className="mr-2 h-4 w-4" />Archiver</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </motion.div>

      {/* Écarts & gels — lecture seule. Le détail (qui, quand, écart exact) vit dans le
          journal d'audit ; ce bloc y renvoie plutôt que de rejuger. */}
      {frozen.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="mt-8 glass-effect rounded-2xl p-6 border border-red-500/20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Snowflake className="w-5 h-5 text-red-400" /> Écarts &amp; gels
            </h2>
            <Link to="/audit-log" className="text-xs text-emerald-400 hover:underline flex items-center gap-1">
              <History className="w-3.5 h-3.5" /> Journal d'audit
            </Link>
          </div>
          <div className="space-y-2">
            {frozen.map((a) => {
              const fetched = sessionsMap[a.code];
              const closure = fetched && fetched.ok ? lastClosure(fetched.sessions) : null;
              return (
                <div key={a.code} className="flex items-center justify-between text-sm border-b border-slate-800 pb-2">
                  <span className="text-white">{a.name} <span className="font-mono text-xs text-slate-500">{a.code}</span></span>
                  <EcartGelCell closure={closure} currency={a.currency} />
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <AccountFormModal isOpen={createOpen} onClose={() => setCreateOpen(false)} wallet={null} agencies={agencies} onSave={handleCreate} kindLocked />
      <AccountFormModal isOpen={!!editAccount} onClose={() => setEditAccount(null)} wallet={editAccount ? asWallet(editAccount) : null} agencies={agencies} onSave={handleEdit} kindLocked />
      <TransferModal wallet={transferAccount ? asWallet(transferAccount) : null} wallets={walletsForTransfer} onClose={() => setTransferAccount(null)} onSubmit={handleTransfer} />
      <FlowModal wallet={flowAccount ? asWallet(flowAccount) : null} onClose={() => setFlowAccount(null)} onSubmit={handleFlow} />
      <ReassignModal wallet={reassignAccount ? asWallet(reassignAccount) : null} onClose={() => setReassignAccount(null)} onSubmit={handleReassign} />
      <DetailsModal wallet={detailsAccount ? asWallet(detailsAccount) : null} onClose={() => setDetailsAccount(null)} />
      <RegisterDialog wallet={registerAccount ? asWallet(registerAccount) : null} onClose={() => setRegisterAccount(null)} toast={toast} onChanged={reload} />
      <CeilingModal wallet={ceilingAccount ? asWallet(ceilingAccount) : null} onClose={() => setCeilingAccount(null)} onSubmit={handleCeiling} />
      <PartnerLinkDialog wallet={partnerAccount ? asWallet(partnerAccount) : null} onClose={() => setPartnerAccount(null)} toast={toast} onChanged={reload} />
      <SessionsPanel account={sessionsAccount} onClose={() => setSessionsAccount(null)} />
    </>
  );
};

export default Caisses;
