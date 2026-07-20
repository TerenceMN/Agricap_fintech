import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
    Check, X, Send, MessageSquare, Paperclip, MoreHorizontal, Eye, Clock,
    Box, Users, Bell
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/services/api';
import StepUpOtpDialog from '@/components/transactions/StepUpOtpDialog';

const COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444'];
const OP_LABEL = { PAYMENT: 'Paiement', REIMBURSEMENT: 'Remboursement', TRANSFER: 'Transfert' };
const ALERT_LABEL = { MOYEN: 'Moyen', ELEVE: 'Élevé', CRITIQUE: 'Critique' };
const CASE_STATUS_LABEL = { EN_TRANSIT: 'En transit', EN_OBSERVATION: 'En observation', BLOQUE: 'Bloqué' };

const SummaryCard = ({ title, value, icon: Icon, color, hint }) => (
    <div className="glass-effect p-4 rounded-xl flex items-center gap-4" title={hint}>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
            <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
            <p className="text-sm text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
        </div>
    </div>
);

const SpecialCases = () => {
    const { toast } = useToast();
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [detailCase, setDetailCase] = useState(null);
    const [txDetail, setTxDetail] = useState(null);
    const [escalateDialog, setEscalateDialog] = useState({ open: false, case: null, supervisorSub: '' });
    const [supervisors, setSupervisors] = useState([]);
    const [otpDialog, setOtpDialog] = useState({ open: false, txId: null });

    const loadCases = () => {
        setLoading(true);
        return api.transactions.specialCases()
            .then(setCases)
            .catch((err) => toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' }))
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadCases(); }, []);

    const anomalyDistribution = useMemo(() => {
        const counts = {};
        cases.forEach((c) => { counts[c.alertLevel] = (counts[c.alertLevel] || 0) + 1; });
        return Object.entries(counts).map(([level, value]) => ({ name: ALERT_LABEL[level] || level, value }));
    }, [cases]);

    const activeAgents = useMemo(() => new Set(cases.map((c) => c.escalatedTo).filter(Boolean)).size, [cases]);

    const handleStub = (action, c) => {
        toast({
            title: action,
            description: `Cas n°${c.id} : aucune fonctionnalité correspondante côté serveur pour le moment.`,
        });
    };

    const openDetails = async (c) => {
        setDetailCase(c);
        setTxDetail(null);
        try {
            const tx = await api.transactions.detail(c.transactionId);
            setTxDetail(tx);
        } catch (err) { /* stays null */ }
    };

    const handleApprove = async (c) => {
        try {
            await api.transactions.approve(c.transactionId);
            toast({ title: 'Transaction approuvée', description: `Cas n°${c.id} : TX-${c.transactionId} approuvée.` });
            loadCases();
        } catch (err) {
            if (err.status === 428) {
                setOtpDialog({ open: true, txId: c.transactionId });
            } else {
                toast({ title: 'Erreur', description: err.message || 'Approbation impossible.', variant: 'destructive' });
            }
        }
    };

    const handleReject = async (c) => {
        try {
            await api.transactions.reject(c.transactionId);
            toast({ title: 'Transaction rejetée', description: `Cas n°${c.id} : TX-${c.transactionId} rejetée.` });
            loadCases();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Rejet impossible.', variant: 'destructive' });
        }
    };

    const openEscalate = async (c) => {
        setEscalateDialog({ open: true, case: c, supervisorSub: '' });
        if (supervisors.length === 0) {
            try { setSupervisors(await api.rbac.supervisors()); } catch (err) { /* liste vide */ }
        }
    };

    const confirmEscalate = async () => {
        const { case: c, supervisorSub } = escalateDialog;
        if (!supervisorSub) return;
        try {
            await api.transactions.escalateSpecialCase(c.id, supervisorSub);
            toast({ title: 'Cas transféré', description: `Cas n°${c.id} transféré au superviseur.` });
            setEscalateDialog({ open: false, case: null, supervisorSub: '' });
            loadCases();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Transfert impossible.', variant: 'destructive' });
        }
    };

    const AlertBadge = ({ level }) => {
        const config = {
            ELEVE: { className: 'bg-yellow-500/80 text-white' },
            MOYEN: { className: 'bg-blue-500/80 text-white' },
            CRITIQUE: { className: 'bg-red-600/80 text-white' },
        };
        const label = ALERT_LABEL[level] || level;
        return <Badge className={config[level]?.className}>{config[level] ? `⚠️ ${label}` : label}</Badge>;
    };

    const StatusBadge = ({ status }) => {
        const config = {
            EN_TRANSIT: { className: 'bg-blue-500/20 text-blue-400' },
            EN_OBSERVATION: { className: 'bg-purple-500/20 text-purple-400' },
            BLOQUE: { className: 'bg-red-500/20 text-red-400' },
        };
        return <Badge className={config[status]?.className}>{CASE_STATUS_LABEL[status] || status}</Badge>;
    };

    return (
        <Layout>
            <Helmet>
                <title>Cas Spéciaux - AGRICAP FINTECH</title>
                <meta name="description" content="Gestion des cas particuliers et des opérations à problème." />
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <h1 className="text-4xl font-bold gradient-text mb-2">Gestion des Cas Particuliers</h1>
                <p className="text-gray-400">Zone de transit pour les transactions suspectes, atypiques ou problématiques.</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                 <SummaryCard title="Cas en transit" value={cases.length} icon={Box} color="bg-blue-500" />
                 <SummaryCard title="Temps moyen trait." value="N/D" icon={Clock} color="bg-purple-500"
                    hint="Non calculable : aucune date de clôture n'est journalisée pour les cas spéciaux." />
                 <SummaryCard title="Superviseurs assignés" value={activeAgents} icon={Users} color="bg-emerald-500" />
                 <div className="md:col-span-2 lg:col-span-1 glass-effect p-4 rounded-xl">
                     <h3 className="text-sm font-semibold text-white text-center mb-2">Répartition des anomalies</h3>
                     <ResponsiveContainer width="100%" height={80}>
                        <PieChart>
                            <Pie data={anomalyDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={25} outerRadius={40} paddingAngle={2}>
                                {anomalyDistribution.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: 'rgba(30,41,59,0.8)', border: 'none', borderRadius: '0.5rem', fontSize: '12px' }}/>
                        </PieChart>
                    </ResponsiveContainer>
                 </div>
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-effect rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-4">File des Cas à Traiter</h2>
                <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-slate-800 hover:bg-transparent text-xs whitespace-nowrap">
                                <TableHead>N°</TableHead>
                                <TableHead>Réf. Transaction</TableHead>
                                <TableHead>Client</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Montant</TableHead>
                                <TableHead>Date/Heure</TableHead>
                                <TableHead>Niveau d'Alerte</TableHead>
                                <TableHead>Statut</TableHead>
                                <TableHead>Recommandation</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {!loading && cases.length === 0 && (
                                <TableRow><TableCell colSpan={10} className="text-center text-slate-500 py-8">Aucun cas particulier.</TableCell></TableRow>
                            )}
                            {cases.map((c) => (
                                <TableRow key={c.id} className="border-slate-800 text-sm">
                                    <TableCell className="font-mono text-slate-400">#{String(c.id).padStart(3, '0')}</TableCell>
                                    <TableCell className="font-mono text-slate-400">{c.ref}</TableCell>
                                    <TableCell className="font-semibold text-white">{c.client}</TableCell>
                                    <TableCell>{OP_LABEL[c.type] || c.type}</TableCell>
                                    <TableCell className="font-semibold text-yellow-400">{c.amount.toLocaleString()} {c.currency}</TableCell>
                                    <TableCell>{new Date(c.date).toLocaleString()}</TableCell>
                                    <TableCell><AlertBadge level={c.alertLevel} /></TableCell>
                                    <TableCell><StatusBadge status={c.status} /></TableCell>
                                    <TableCell className="text-blue-300">{c.recommendation || '-'}</TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                                                <DropdownMenuItem onSelect={() => openDetails(c)}><Eye className="mr-2 h-4 w-4" />Revoir / Détails</DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-slate-700" />
                                                <DropdownMenuItem onSelect={() => handleApprove(c)} disabled={c.transactionStatus !== 'pending_validation'} className="text-emerald-400 focus:text-emerald-300"><Check className="mr-2 h-4 w-4" />Approuver</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleReject(c)} disabled={c.transactionStatus !== 'pending_validation'} className="text-red-400 focus:text-red-300"><X className="mr-2 h-4 w-4" />Rejeter</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => openEscalate(c)} className="text-purple-400 focus:text-purple-300"><Send className="mr-2 h-4 w-4" />Transférer au superviseur</DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-slate-700" />
                                                <DropdownMenuItem onSelect={() => handleStub('Ajouter une note', c)}><MessageSquare className="mr-2 h-4 w-4" />Ajouter une note</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleStub('Joindre un document', c)}><Paperclip className="mr-2 h-4 w-4" />Joindre un document</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleStub('Notifier le client', c)}><Bell className="mr-2 h-4 w-4" />Notifier le client</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </motion.div>

            <Dialog open={!!detailCase} onOpenChange={(o) => { if (!o) { setDetailCase(null); setTxDetail(null); } }}>
                <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Cas n°{detailCase?.id} — {detailCase?.ref}</DialogTitle>
                        <DialogDescription>{detailCase?.client}</DialogDescription>
                    </DialogHeader>
                    {detailCase && (
                        <div className="space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div><span className="text-slate-400">Montant : </span>{detailCase.amount.toLocaleString()} {detailCase.currency}</div>
                                <div><span className="text-slate-400">Niveau d'alerte : </span>{ALERT_LABEL[detailCase.alertLevel]}</div>
                                <div><span className="text-slate-400">Statut du cas : </span>{CASE_STATUS_LABEL[detailCase.status]}</div>
                                <div><span className="text-slate-400">Statut transaction : </span>{detailCase.transactionStatus}</div>
                                <div><span className="text-slate-400">Escaladé à : </span>{detailCase.escalatedTo || '-'}</div>
                            </div>
                            {txDetail?.approvals?.length > 0 && (
                                <div>
                                    <p className="text-slate-400 mb-1">Approbations</p>
                                    <ul className="space-y-1">
                                        {txDetail.approvals.map((a, i) => (
                                            <li key={i} className="flex justify-between bg-slate-800/60 rounded px-2 py-1">
                                                <span>{a.approver} ({a.role})</span>
                                                <span className={a.decision === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}>{a.decision}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={escalateDialog.open} onOpenChange={(o) => setEscalateDialog((p) => ({ ...p, open: o }))}>
                <DialogContent className="bg-slate-900 border-slate-700 text-white">
                    <DialogHeader>
                        <DialogTitle>Transférer au superviseur</DialogTitle>
                        <DialogDescription>Cas n°{escalateDialog.case?.id} — sélectionnez un superviseur destinataire.</DialogDescription>
                    </DialogHeader>
                    <Select value={escalateDialog.supervisorSub} onValueChange={(v) => setEscalateDialog((p) => ({ ...p, supervisorSub: v }))}>
                        <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Choisir un superviseur..." /></SelectTrigger>
                        <SelectContent>
                            {supervisors.map((s) => (
                                <SelectItem key={s.sub} value={s.sub}>{s.name} ({s.role})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEscalateDialog({ open: false, case: null, supervisorSub: '' })}>Annuler</Button>
                        <Button className="bg-purple-600" disabled={!escalateDialog.supervisorSub} onClick={confirmEscalate}>Transférer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <StepUpOtpDialog
                open={otpDialog.open}
                transactionId={otpDialog.txId}
                onOpenChange={(o) => setOtpDialog((p) => ({ ...p, open: o }))}
                onApproved={loadCases}
            />
        </Layout>
    );
};

export default SpecialCases;
