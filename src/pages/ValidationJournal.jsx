import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    CheckCircle, Clock, XCircle, Bot, UserCheck, MoreHorizontal, Eye, MessageSquare,
    FileDown, DollarSign, Calendar, ChevronsRight,
    Check, X, Send, Save
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/services/api';
import StepUpOtpDialog from '@/components/transactions/StepUpOtpDialog';

const OP_TYPES = ['PAYMENT', 'REIMBURSEMENT', 'TRANSFER'];
const OP_KEY = { PAYMENT: 'payment', REIMBURSEMENT: 'reimbursement', TRANSFER: 'transfer' };
const OP_LABEL = { PAYMENT: 'Paiement', REIMBURSEMENT: 'Remboursement', TRANSFER: 'Transfert' };
const STATUS_TO_FR = {
    pending_validation: 'En attente', draft: 'En attente', submitted: 'En attente',
    posted: 'Validée', approved: 'Validée',
    rejected: 'Rejetée', reversed: 'Rejetée',
};

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

const ValidationJournal = () => {
    const { toast } = useToast();
    const [journal, setJournal] = useState([]);
    const [loading, setLoading] = useState(true);
    const [thresholdsMeta, setThresholdsMeta] = useState({});
    const [thresholds, setThresholds] = useState({
        payment: 1000,
        reimbursement: 500,
        transfer: 5000,
        manualValidationTimeout: 24,
        enableNotifications: true,
    });
    const [detailItem, setDetailItem] = useState(null);
    const [otpDialog, setOtpDialog] = useState({ open: false, txId: null });

    const loadJournal = () => {
        setLoading(true);
        return api.transactions.list()
            .then(setJournal)
            .catch((err) => toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' }))
            .finally(() => setLoading(false));
    };

    const loadThresholds = () => {
        api.transactions.thresholds().then((rows) => {
            const meta = {};
            const next = { ...thresholds };
            rows.forEach((r) => {
                meta[r.operationType] = r;
                const key = OP_KEY[r.operationType];
                if (key) next[key] = r.autoLimit;
                if (r.operationType === 'PAYMENT') next.manualValidationTimeout = r.manualTimeoutHours;
            });
            setThresholdsMeta(meta);
            setThresholds(next);
        }).catch(() => {});
    };

    useEffect(() => { loadJournal(); loadThresholds(); }, []);

    const handleThresholdChange = (e) => {
        const { name, value } = e.target;
        setThresholds(prev => ({ ...prev, [name]: value }));
    };

    const handleSwitchChange = (checked) => {
      setThresholds(prev => ({ ...prev, enableNotifications: checked }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        try {
            await Promise.all(OP_TYPES.map((opType) => api.transactions.setThreshold({
                operationType: opType,
                autoLimit: thresholds[OP_KEY[opType]],
                managerLimit: thresholdsMeta[opType]?.managerLimit ?? 5000,
                manualTimeoutHours: thresholds.manualValidationTimeout,
            })));
            toast({
                title: "Paramètres sauvegardés !",
                description: "Les nouveaux seuils de validation ont été enregistrés avec succès.",
            });
            loadThresholds();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Sauvegarde impossible.', variant: 'destructive' });
        }
    };

    const handleValidate = async (item) => {
        try {
            await api.transactions.approve(item.id);
            toast({ title: 'Transaction validée', description: `TX-${item.id} approuvée.` });
            loadJournal();
        } catch (err) {
            if (err.status === 428) {
                setOtpDialog({ open: true, txId: item.id });
            } else {
                toast({ title: 'Erreur', description: err.message || 'Validation impossible.', variant: 'destructive' });
            }
        }
    };

    const handleReject = async (item) => {
        try {
            await api.transactions.reject(item.id);
            toast({ title: 'Transaction rejetée', description: `TX-${item.id} rejetée.` });
            loadJournal();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Rejet impossible.', variant: 'destructive' });
        }
    };

    const handleStub = (action, item) => {
        toast({
            title: action,
            description: `TX-${item.id} : aucune fonctionnalité correspondante côté serveur pour le moment.`,
        });
    };

    const StatusBadge = ({ status }) => {
        const fr = STATUS_TO_FR[status] || status;
        const config = {
            'Validée': { className: 'bg-emerald-500/20 text-emerald-400', icon: <CheckCircle className="w-3 h-3" /> },
            'En attente': { className: 'bg-blue-500/20 text-blue-400', icon: <Clock className="w-3 h-3" /> },
            'Rejetée': { className: 'bg-red-500/20 text-red-400', icon: <XCircle className="w-3 h-3" /> },
        };
        const current = config[fr] || {};
        return <Badge className={`gap-1.5 ${current.className || ''}`}>{current.icon} {fr}</Badge>;
    };

    const ModeBadge = ({ mode }) => {
        const config = {
            'Auto': { icon: <Bot className="w-3 h-3" />, text: 'Auto', className: 'text-purple-400' },
            'Manuelle': { icon: <UserCheck className="w-3 h-3" />, text: 'Manuelle', className: 'text-blue-400' },
        };
        const current = config[mode] || {};
        return <span className={`flex items-center gap-1.5 font-medium ${current.className}`}>{current.icon} {current.text}</span>;
    };

    const ImpactIndicator = ({ impacted }) => {
        return impacted ?
            <CheckCircle className="w-4 h-4 text-emerald-400" /> :
            <XCircle className="w-4 h-4 text-red-500" />;
    };

    const today = new Date().toISOString().slice(0, 10);
    const todayCount = journal.filter((j) => j.date?.slice(0, 10) === today).length;
    const autoCount = journal.filter((j) => j.autoValidated).length;
    const pendingCount = journal.filter((j) => STATUS_TO_FR[j.status] === 'En attente').length;

    return (
        <Layout>
            <Helmet>
                <title>Journal de Validation - AGRICAP FINTECH</title>
                <meta name="description" content="Journalisation et validation des transactions." />
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <h1 className="text-4xl font-bold gradient-text mb-2">Journal de Validation</h1>
                <p className="text-gray-400">Contrôle et validation des transactions selon les seuils de responsabilité.</p>
            </motion.div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <SummaryCard title="Transactions du jour" value={todayCount} icon={Calendar} color="bg-blue-500" />
                <SummaryCard title="Validées auto." value={autoCount} icon={Bot} color="bg-emerald-500" />
                <SummaryCard title="En attente" value={pendingCount} icon={Clock} color="bg-yellow-500" />
                <SummaryCard title="Temps valid. moyen" value="N/D" icon={ChevronsRight} color="bg-purple-500"
                    hint="Non calculable : l'horodatage de décision par approbateur n'est pas encore journalisé côté serveur." />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2 glass-effect rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-white">Journal des Transactions</h2>
                         <div className="flex gap-2">
                             <Button variant="outline" onClick={() => handleStub('Exporter', { id: '-' })}><FileDown className="w-4 h-4 mr-2" />Exporter</Button>
                         </div>
                    </div>
                     <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-800 hover:bg-transparent text-xs whitespace-nowrap">
                                    <TableHead>Réf.</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Montant</TableHead>
                                    <TableHead>Émetteur → Récepteur</TableHead>
                                    <TableHead>Statut</TableHead>
                                    <TableHead>Mode Valid.</TableHead>
                                    <TableHead>Impact Émetteur</TableHead>
                                    <TableHead>Impact Récepteur</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!loading && journal.length === 0 && (
                                    <TableRow><TableCell colSpan={9} className="text-center text-slate-500 py-8">Aucune transaction.</TableCell></TableRow>
                                )}
                                {journal.map((item) => {
                                    const impacted = item.status === 'posted';
                                    const isPending = STATUS_TO_FR[item.status] === 'En attente';
                                    return (
                                    <TableRow key={item.id} className="border-slate-800 text-sm">
                                        <TableCell className="font-mono text-slate-400">TX-{item.id}</TableCell>
                                        <TableCell>{OP_LABEL[item.operationType] || item.operationType}</TableCell>
                                        <TableCell className="font-semibold text-emerald-300">{item.currency} {item.amount.toLocaleString()}</TableCell>
                                        <TableCell className="flex items-center gap-2">
                                            <span>{item.emitter || '-'}</span>
                                            <ChevronsRight className="w-4 h-4 text-slate-500"/>
                                            <span>{item.receiver || '-'}</span>
                                        </TableCell>
                                        <TableCell><StatusBadge status={item.status} /></TableCell>
                                        <TableCell><ModeBadge mode={item.autoValidated ? 'Auto' : 'Manuelle'} /></TableCell>
                                        <TableCell><ImpactIndicator impacted={impacted} /></TableCell>
                                        <TableCell><ImpactIndicator impacted={impacted} /></TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                                                    <DropdownMenuItem onSelect={() => setDetailItem(item)}><Eye className="mr-2 h-4 w-4" />Voir détails</DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-slate-700"/>
                                                    <DropdownMenuItem onSelect={() => handleValidate(item)} disabled={!isPending} className="text-emerald-400 focus:text-emerald-300"><Check className="mr-2 h-4 w-4" />Valider</DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => handleReject(item)} disabled={!isPending} className="text-red-400 focus:text-red-300"><X className="mr-2 h-4 w-4" />Rejeter</DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => handleStub('Soumettre à révision', item)} disabled={!isPending} className="text-purple-400 focus:text-purple-300"><Send className="mr-2 h-4 w-4" />Soumettre à révision</DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-slate-700"/>
                                                    <DropdownMenuItem onSelect={() => handleStub('Ajouter une note', item)}><MessageSquare className="mr-2 h-4 w-4" />Ajouter une note</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                );})}
                            </TableBody>
                        </Table>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="glass-effect rounded-2xl p-6">
                     <h2 className="text-xl font-bold text-white mb-4">Paramètres de Validation</h2>
                     <Tabs defaultValue="thresholds" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-slate-800/60">
                            <TabsTrigger value="thresholds">Seuils par Opération</TabsTrigger>
                            <TabsTrigger value="rules">Règles Générales</TabsTrigger>
                        </TabsList>
                        <form onSubmit={handleSaveSettings}>
                        <TabsContent value="thresholds" className="mt-6">
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="payment">Seuil de validation auto. (Paiement)</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <Input id="payment" name="payment" type="number" value={thresholds.payment} onChange={handleThresholdChange} className="pl-9 bg-slate-800/80 border-slate-700" />
                                    </div>
                                    <p className="text-xs text-slate-500">Montant max. validé sans intervention.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="reimbursement">Seuil de validation auto. (Remboursement)</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <Input id="reimbursement" name="reimbursement" type="number" value={thresholds.reimbursement} onChange={handleThresholdChange} className="pl-9 bg-slate-800/80 border-slate-700" />
                                    </div>
                                    <p className="text-xs text-slate-500">Montant max. pour les remboursements.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="transfer">Seuil de validation auto. (Transfert)</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <Input id="transfer" name="transfer" type="number" value={thresholds.transfer} onChange={handleThresholdChange} className="pl-9 bg-slate-800/80 border-slate-700" />
                                    </div>
                                    <p className="text-xs text-slate-500">Montant max. pour les transferts internes.</p>
                                </div>
                            </div>
                        </TabsContent>
                        <TabsContent value="rules" className="mt-6">
                           <div className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="manualValidationTimeout">Délai max. validation manuelle (heures)</Label>
                                     <Input id="manualValidationTimeout" name="manualValidationTimeout" type="number" value={thresholds.manualValidationTimeout} onChange={handleThresholdChange} className="bg-slate-800/80 border-slate-700" />
                                    <p className="text-xs text-slate-500">Temps limite avant auto-rejet ou alerte.</p>
                                </div>
                                 <div className="flex items-center space-x-2">
                                      <Switch id="enable-notifications" checked={thresholds.enableNotifications} onCheckedChange={handleSwitchChange} />
                                      <Label htmlFor="enable-notifications">Notifier en cas de dépassement de seuil</Label>
                                  </div>
                           </div>
                        </TabsContent>
                        <div className="mt-6">
                           <Button type="submit" className="w-full bg-gradient-to-r from-emerald-500 to-blue-600 hover:opacity-90 transition-opacity">
                                <Save className="w-4 h-4 mr-2" />
                                Enregistrer les modifications
                            </Button>
                        </div>
                        </form>
                     </Tabs>
                </motion.div>
            </div>

            <Dialog open={!!detailItem} onOpenChange={(o) => { if (!o) setDetailItem(null); }}>
                <DialogContent className="bg-slate-900 border-slate-700 text-white">
                    <DialogHeader>
                        <DialogTitle>Transaction TX-{detailItem?.id}</DialogTitle>
                        <DialogDescription>{detailItem?.description || 'Sans description'}</DialogDescription>
                    </DialogHeader>
                    {detailItem && (
                        <div className="space-y-2 text-sm">
                            <div><span className="text-slate-400">Montant : </span>{detailItem.currency} {detailItem.amount.toLocaleString()}</div>
                            <div><span className="text-slate-400">Statut : </span>{STATUS_TO_FR[detailItem.status]}</div>
                            <div><span className="text-slate-400">Mode : </span>{detailItem.autoValidated ? 'Auto' : 'Manuelle'}</div>
                            {detailItem.approvals?.length > 0 && (
                                <ul className="space-y-1 mt-2">
                                    {detailItem.approvals.map((a, i) => (
                                        <li key={i} className="flex justify-between bg-slate-800/60 rounded px-2 py-1">
                                            <span>{a.approver} ({a.role})</span>
                                            <span className={a.decision === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}>{a.decision}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <StepUpOtpDialog
                open={otpDialog.open}
                transactionId={otpDialog.txId}
                onOpenChange={(o) => setOtpDialog((p) => ({ ...p, open: o }))}
                onApproved={loadJournal}
            />
        </Layout>
    );
};

export default ValidationJournal;
