import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Download, ArrowUpRight, ArrowDownLeft, MoreHorizontal, Settings2, SlidersHorizontal, CheckSquare, XCircle, PauseCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import StepUpOtpDialog from '@/components/transactions/StepUpOtpDialog';

const STATUS_CONFIG = {
    draft: { label: 'Brouillon', className: 'bg-slate-500/20 text-slate-300' },
    submitted: { label: 'Soumis', className: 'bg-blue-500/20 text-blue-400' },
    pending_validation: { label: 'En attente', className: 'bg-amber-500/20 text-amber-400' },
    approved: { label: 'Approuvé', className: 'bg-blue-500/20 text-blue-400' },
    posted: { label: 'Comptabilisé', className: 'bg-emerald-500/20 text-emerald-400' },
    rejected: { label: 'Rejeté', className: 'bg-red-500/20 text-red-400' },
    reversed: { label: 'Annulé', className: 'bg-slate-500/20 text-slate-400' },
};

const OP_TYPE_LABEL = { PAYMENT: 'Paiement', REIMBURSEMENT: 'Remboursement', TRANSFER: 'Transfert' };

const Transactions = () => {
    const { toast } = useToast();
    const [transactions, setTransactions] = useState([]);
    const [agencies, setAgencies] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');
    const [selectedRows, setSelectedRows] = useState([]);
    const [detailTx, setDetailTx] = useState(null);
    const [auditEntries, setAuditEntries] = useState(null);
    const [reverseDialog, setReverseDialog] = useState({ open: false, tx: null, reason: '' });
    const [otpDialog, setOtpDialog] = useState({ open: false, txId: null });

    const loadData = () => {
        setLoading(true);
        return Promise.all([api.transactions.list(), api.agencies.list()])
            .then(([txs, ags]) => {
                setTransactions(txs);
                const map = {};
                ags.forEach((a) => { map[a.id] = a; });
                setAgencies(map);
            })
            .catch((err) => toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' }))
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadData(); }, []);

    const filtered = useMemo(() => {
        return transactions.filter((tx) => {
            if (search) {
                const s = search.toLowerCase();
                if (!String(tx.id).includes(s) && !(tx.description || '').toLowerCase().includes(s)) return false;
            }
            if (dateStart && tx.date < dateStart) return false;
            if (dateEnd && tx.date > `${dateEnd}T23:59:59`) return false;
            return true;
        });
    }, [transactions, search, dateStart, dateEnd]);

    const handleStub = (action) => {
        toast({
            title: action,
            description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
        });
    };

    const handleBulk = async (action) => {
        if (selectedRows.length === 0) return;
        try {
            const results = await api.transactions.bulkAction(selectedRows, action);
            const ok = results.filter((r) => r.ok).length;
            const fail = results.length - ok;
            toast({
                title: `Action groupée : ${action}`,
                description: `${ok} réussie(s)${fail ? `, ${fail} échouée(s)` : ''}.`,
                variant: fail && !ok ? 'destructive' : undefined,
            });
            setSelectedRows([]);
            loadData();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Action groupée impossible.', variant: 'destructive' });
        }
    };

    const openAuditFor = async (tx) => {
        setDetailTx(tx);
        setAuditEntries(null);
        try {
            const entries = await api.audit.entries({ entity_type: 'Transaction', entity_id: String(tx.id) });
            setAuditEntries(entries);
        } catch (err) {
            setAuditEntries([]);
        }
    };

    const handleReverse = async () => {
        const { tx, reason } = reverseDialog;
        try {
            await api.transactions.reverse(tx.id, reason);
            toast({ title: 'Transaction annulée', description: `TX-${tx.id} a été contre-passée.` });
            setReverseDialog({ open: false, tx: null, reason: '' });
            loadData();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Annulation impossible.', variant: 'destructive' });
        }
    };

    return (
        <Layout>
            <Helmet><title>Transactions - AGRICAP FINTECH</title></Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold gradient-text">Gestion des Transactions</h1>
                    <p className="text-gray-400">Recherche avancée, actions en masse et audits.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => handleStub('Presets Filtres')}><Settings2 className="w-4 h-4 mr-2"/> Presets</Button>
                    <Button className="bg-emerald-600" onClick={() => handleStub('Export Excel')}><Download className="w-4 h-4 mr-2"/> Exporter</Button>
                </div>
            </motion.div>

            <Card className="glass-effect mb-6">
                <CardContent className="p-4 flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-xs text-slate-400 mb-1 block">Recherche (Réf / Desc)</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher..." className="pl-10 bg-slate-900/50" />
                        </div>
                    </div>
                    <div className="w-40">
                        <label className="text-xs text-slate-400 mb-1 block">Date Début</label>
                        <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="bg-slate-900/50" />
                    </div>
                    <div className="w-40">
                        <label className="text-xs text-slate-400 mb-1 block">Date Fin</label>
                        <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="bg-slate-900/50" />
                    </div>
                    <Button variant="secondary" onClick={() => handleStub('Plus de filtres')}><SlidersHorizontal className="w-4 h-4 mr-2"/> Plus</Button>
                </CardContent>
            </Card>

            {selectedRows.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-400">{selectedRows.length} transaction(s) sélectionnée(s)</span>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => handleBulk('approve')}><CheckSquare className="w-4 h-4 mr-2"/> Approuver</Button>
                        <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => handleBulk('suspend')}><PauseCircle className="w-4 h-4 mr-2"/> Suspendre</Button>
                        <Button size="sm" variant="outline" className="text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => handleBulk('reject')}><XCircle className="w-4 h-4 mr-2"/> Rejeter</Button>
                    </div>
                </motion.div>
            )}

            <Card className="glass-effect">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-white/10 bg-slate-900/50">
                                <TableHead className="w-12"><Checkbox onCheckedChange={(c) => setSelectedRows(c ? filtered.map(t=>t.id) : [])} /></TableHead>
                                <TableHead>Date / Réf</TableHead>
                                <TableHead>Description / Agence</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Montant</TableHead>
                                <TableHead className="text-center">Statut</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {!loading && filtered.length === 0 && (
                                <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-8">Aucune transaction.</TableCell></TableRow>
                            )}
                            {filtered.map(tx => (
                                <TableRow key={tx.id} className="border-white/10 hover:bg-white/5">
                                    <TableCell><Checkbox checked={selectedRows.includes(tx.id)} onCheckedChange={(c) => setSelectedRows(prev => c ? [...prev, tx.id] : prev.filter(id => id !== tx.id))} /></TableCell>
                                    <TableCell className="font-mono text-xs">
                                        <div className="text-white">{new Date(tx.date).toLocaleString()}</div>
                                        <div className="text-slate-500">TX-{tx.id}</div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium text-white">{tx.description || '-'}</div>
                                        <div className="text-xs text-slate-400">{tx.agencyId ? (agencies[tx.agencyId]?.name || `Agence #${tx.agencyId}`) : 'Siège'}</div>
                                    </TableCell>
                                    <TableCell><Badge variant="outline" className="text-xs bg-slate-800">{OP_TYPE_LABEL[tx.operationType] || tx.operationType}</Badge></TableCell>
                                    <TableCell className={`text-right font-bold ${tx.type === 'credit' ? 'text-emerald-400' : 'text-white'}`}>
                                        {tx.type === 'credit' ? <ArrowUpRight className="w-3 h-3 inline mr-1"/> : <ArrowDownLeft className="w-3 h-3 inline mr-1"/>}
                                        {tx.amount.toLocaleString()} {tx.currency}
                                    </TableCell>
                                    <TableCell className="text-center">
                                         <Badge className={STATUS_CONFIG[tx.status]?.className}>{STATUS_CONFIG[tx.status]?.label || tx.status}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 text-white">
                                                <DropdownMenuItem onClick={() => setDetailTx(tx)}>Détails complets</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleStub('Ajouter Note')}>Ajouter Note</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => openAuditFor(tx)}>Journal Audit</DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-slate-700"/>
                                                <DropdownMenuItem
                                                    onClick={() => setReverseDialog({ open: true, tx, reason: '' })}
                                                    disabled={tx.status !== 'posted'}
                                                    className="text-red-400"
                                                >
                                                    Inverser Transaction
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Détails / Audit dialog */}
            <Dialog open={!!detailTx} onOpenChange={(o) => { if (!o) { setDetailTx(null); setAuditEntries(null); } }}>
                <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Transaction TX-{detailTx?.id}</DialogTitle>
                        <DialogDescription>{detailTx?.description || 'Sans description'}</DialogDescription>
                    </DialogHeader>
                    {detailTx && (
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div><span className="text-slate-400">Montant : </span>{detailTx.amount.toLocaleString()} {detailTx.currency}</div>
                                <div><span className="text-slate-400">Statut : </span>{STATUS_CONFIG[detailTx.status]?.label || detailTx.status}</div>
                                <div><span className="text-slate-400">Type opération : </span>{OP_TYPE_LABEL[detailTx.operationType] || detailTx.operationType}</div>
                                <div><span className="text-slate-400">Validation auto : </span>{detailTx.autoValidated ? 'Oui' : 'Non'}</div>
                                <div><span className="text-slate-400">Émetteur : </span>{detailTx.emitter || '-'}</div>
                                <div><span className="text-slate-400">Récepteur : </span>{detailTx.receiver || '-'}</div>
                            </div>
                            {detailTx.approvals?.length > 0 && (
                                <div>
                                    <p className="text-slate-400 mb-1">Approbations</p>
                                    <ul className="space-y-1">
                                        {detailTx.approvals.map((a, i) => (
                                            <li key={i} className="flex justify-between bg-slate-800/60 rounded px-2 py-1">
                                                <span>{a.approver} ({a.role})</span>
                                                <span className={a.decision === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}>{a.decision}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {auditEntries !== null && (
                                <div>
                                    <p className="text-slate-400 mb-1">Journal d'audit</p>
                                    {auditEntries.length === 0 ? (
                                        <p className="text-xs text-slate-500">Aucune entrée d'audit.</p>
                                    ) : (
                                        <ul className="space-y-1 max-h-48 overflow-y-auto">
                                            {auditEntries.map((e) => (
                                                <li key={e.id} className="text-xs bg-slate-800/60 rounded px-2 py-1 flex justify-between">
                                                    <span>{e.action} — {e.user}</span>
                                                    <span className="text-slate-500">{new Date(e.timestamp).toLocaleString()}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Reverse dialog */}
            <Dialog open={reverseDialog.open} onOpenChange={(o) => setReverseDialog((p) => ({ ...p, open: o }))}>
                <DialogContent className="bg-slate-900 border-slate-700 text-white">
                    <DialogHeader>
                        <DialogTitle>Inverser TX-{reverseDialog.tx?.id}</DialogTitle>
                        <DialogDescription>Cette opération contre-passe la transaction comptabilisée. Motif requis.</DialogDescription>
                    </DialogHeader>
                    <Textarea value={reverseDialog.reason} onChange={(e) => setReverseDialog((p) => ({ ...p, reason: e.target.value }))}
                        placeholder="Motif de l'annulation..." className="bg-slate-800 border-slate-700" />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReverseDialog({ open: false, tx: null, reason: '' })}>Annuler</Button>
                        <Button className="bg-red-600" disabled={!reverseDialog.reason} onClick={handleReverse}>Confirmer l'inversion</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <StepUpOtpDialog
                open={otpDialog.open}
                transactionId={otpDialog.txId}
                onOpenChange={(o) => setOtpDialog((p) => ({ ...p, open: o }))}
                onApproved={loadData}
            />
        </Layout>
    );
};

export default Transactions;
