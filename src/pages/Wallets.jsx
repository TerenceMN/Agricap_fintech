import React, { useState, useMemo, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
    Landmark, Plus, Search, MoreHorizontal, FileDown, Eye, Edit, Trash2, Shuffle,
    BarChart2, FileText, Lock, MessageSquare, Upload, TrendingUp, AlertTriangle, Clock, CheckCircle,
    Calculator, Link2, Gauge,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { exportToExcel } from '@/lib/export.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError } from '@/services/api';
// Principe 6 : dialogues et constantes d'affichage extraits vers `components/treasury/`,
// partagés à l'identique avec la vue « Caisses » (`pages/Caisses.tsx`). Aucun jumeau.
import {
    AccountFormModal, TransferModal, FlowModal, ReassignModal, DetailsModal,
    RegisterDialog, PartnerLinkDialog, CeilingModal,
    RISK_LEVEL_LABEL, RISK_LEVEL_CLASS, STATUS_CODE_TO_LABEL,
} from '@/components/treasury/CaisseDialogs';

const SummaryCard = ({ title, value, change, observation }) => {
    const isUp = !change.startsWith('-');
    const changeColor = isUp ? 'text-emerald-400' : 'text-red-400';

    return (
        <div className="bg-slate-800/50 p-4 rounded-lg flex flex-col justify-between">
            <div>
                <p className="text-sm text-slate-400">{title}</p>
                <p className="text-2xl font-bold text-white mt-1">{value}</p>
            </div>
            <div className="flex justify-between items-end mt-2">
                <p className="text-xs text-slate-500">{observation}</p>
                <p className={`text-sm font-semibold flex items-center gap-1 ${changeColor}`}>
                    {isUp ? <TrendingUp className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {change}
                </p>
            </div>
        </div>
    );
};

const Wallets = () => {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [walletsData, setWalletsData] = useState([]);
    const [agencies, setAgencies] = useState([]);

    const [isCreateOpen, setCreateOpen] = useState(false);
    const [editWallet, setEditWallet] = useState(null);
    const [transferWallet, setTransferWallet] = useState(null);
    const [flowWallet, setFlowWallet] = useState(null);
    const [reassignWallet, setReassignWallet] = useState(null);
    const [detailsWallet, setDetailsWallet] = useState(null);
    const [registerWallet, setRegisterWallet] = useState(null);
    const [partnerWallet, setPartnerWallet] = useState(null);
    const [ceilingWallet, setCeilingWallet] = useState(null);

    // Mappe le compte de trésorerie réel (backend `caisses`) vers la forme attendue
    // par ce tableau.
    //
    // `yield: 0` reste SUPPRIMÉ, avec la colonne « Rendement » et sa colonne
    // d'export : une trésorerie n'a pas de rendement, et un zéro dans un tableur se
    // lit — et se moyenne — comme une mesure. La bonne réponse n'est pas zéro,
    // c'est l'absence de colonne.
    const loadWallets = () => api.caisses.accounts.list().then(rows => setWalletsData(rows.map(a => ({
        id: a.code, name: a.name, type: a.kind, source: '-', manager: a.manager || '-',
        initialAmount: a.initialAmount, balance: a.balance, currency: a.currency,
        status: STATUS_CODE_TO_LABEL[a.status] || a.status,
        createdAt: a.createdAt, creationDate: new Date(a.createdAt).toLocaleDateString('fr-FR'),
        scope: a.scope || '-', riskLevel: a.riskLevel || null,
        dailyCeiling: a.dailyCeiling, partnerId: a.partnerId, partnerName: a.partnerName,
    })))).catch(() => {});
    useEffect(() => { loadWallets(); api.agencies.list().then(setAgencies).catch(() => {}); }, []);

    const summaryData = [];

    const filteredWallets = useMemo(() => {
        return walletsData.filter(wallet =>
            (wallet.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            wallet.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            wallet.manager.toLowerCase().includes(searchTerm.toLowerCase()) ||
            wallet.scope.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [searchTerm, walletsData]);

    const getStatusBadge = (status) => {
        switch (status) {
            case 'Actif': return { variant: 'success', icon: <CheckCircle className="w-3 h-3" /> };
            case 'En traitement': return { variant: 'info', icon: <Clock className="w-3 h-3" /> };
            case 'En observation': return { variant: 'destructive', icon: <AlertTriangle className="w-3 h-3" /> };
            default: return { variant: 'secondary', icon: null };
        }
    };

    const reportSingle = (wallet) => {
        exportToExcel([{
            "ID Portefeuille": wallet.id, "Nom": wallet.name, "Type": wallet.type, "Gestionnaire": wallet.manager,
            "Montant Initial": wallet.initialAmount, "Solde Actuel": wallet.balance, "Devise": wallet.currency,
            "Statut": wallet.status, "Date Création": wallet.creationDate, "Zone": wallet.scope,
            // « Taux Risque (%) » exportait 2/5/8 pour un champ à trois valeurs :
            // dans un classeur, ce nombre entre dans une moyenne. On exporte le
            // NIVEAU, qui est ce que le serveur connaît.
            "Niveau de risque": RISK_LEVEL_LABEL[wallet.riskLevel] ?? (wallet.riskLevel || 'non servi'),
        }], `rapport_${wallet.id}`);
        toast({ title: "Exportation réussie", description: `Rapport de ${wallet.name} téléchargé.` });
    };

    const handleAction = async (action, id) => {
        const wallet = walletsData.find(w => w.id === id);
        try {
            if (action === 'add') { setCreateOpen(true); return; }
            if (action === 'edit') { setEditWallet(wallet); return; }
            if (action === 'transfer') { setTransferWallet(wallet); return; }
            if (action === 'add_flow') { setFlowWallet(wallet); return; }
            if (action === 'reassign') { setReassignWallet(wallet); return; }
            if (action === 'details') { setDetailsWallet(wallet); return; }
            if (action === 'report') { reportSingle(wallet); return; }
            if (action === 'register') { setRegisterWallet(wallet); return; }
            if (action === 'partner_link') { setPartnerWallet(wallet); return; }
            if (action === 'set_ceiling') { setCeilingWallet(wallet); return; }
            if (action === 'block') {
                await api.caisses.accounts.block(id);
            } else if (action === 'archive') {
                await api.caisses.accounts.archive(id);
            } else {
                toast({
                    title: action === 'analytics' ? 'Analyse graphique' : 'Commentaire',
                    description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
                });
                return;
            }
            toast({ title: 'Action effectuée', description: `"${action}" appliqué à ${id}.` });
            loadWallets();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleCreate = async (form) => {
        try {
            await api.caisses.accounts.create({
                code: form.code, name: form.name, kind: form.kind, currency: form.currency,
                agencyId: form.agencyId || null, manager: form.manager, initialAmount: form.initialAmount,
            });
            setCreateOpen(false);
            loadWallets();
            toast({ title: 'Compte de trésorerie créé' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleEdit = async (form) => {
        try {
            const data = { name: form.name, manager: form.manager, scope: form.scope };
            if (form.riskLevel) data.riskLevel = form.riskLevel;
            await api.caisses.accounts.update(editWallet.id, data);
            setEditWallet(null);
            loadWallets();
            toast({ title: 'Compte de trésorerie mis à jour' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleTransfer = async (toCode, amount, reason) => {
        try {
            await api.caisses.accounts.transfer(transferWallet.id, toCode, Number(amount), reason);
            setTransferWallet(null);
            loadWallets();
            toast({ title: 'Transfert effectué' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleFlow = async (amount, direction, reason) => {
        try {
            await api.caisses.accounts.addFlow(flowWallet.id, Number(amount), direction, reason);
            setFlowWallet(null);
            loadWallets();
            toast({ title: 'Flux ajouté' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleReassign = async (manager) => {
        try {
            await api.caisses.accounts.reassign(reassignWallet.id, manager);
            setReassignWallet(null);
            loadWallets();
            toast({ title: 'Gérant changé' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleSetCeiling = async (value) => {
        try {
            await api.caisses.accounts.setDailyCeiling(ceilingWallet.id, value);
            setCeilingWallet(null);
            loadWallets();
            toast({ title: 'Plafond journalier mis à jour' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleExport = () => {
        const dataToExport = filteredWallets.map(w => ({
            "ID Portefeuille": w.id,
            "Nom": w.name,
            "Type": w.type,
            "Source": w.source,
            "Gestionnaire": w.manager,
            "Montant Initial": w.initialAmount,
            "Solde Actuel": w.balance,
            "Devise": w.currency,
            // « Rendement (%) » exportait un 0 en dur : un compte de trésorerie n'a
            // pas de rendement, et un zéro dans un tableur se lit — et se moyenne —
            // comme une mesure. La colonne n'existe plus.
            "Statut": w.status,
            "Date Création": w.creationDate,
            "Zone": w.scope,
            "Niveau de risque": RISK_LEVEL_LABEL[w.riskLevel] ?? (w.riskLevel || 'non servi'),
        }));
        exportToExcel(dataToExport, 'rapport_portefeuilles_global');
        toast({ title: "Exportation réussie!", description: "Le fichier 'rapport_portefeuilles_global.xlsx' a été téléchargé." });
    };

    return (
        <Layout>
            <Helmet>
                <title>Portefeuilles - AGRICAP FINTECH</title>
                <meta name="description" content="Gestion des portefeuilles et des liquidités." />
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-4xl font-bold gradient-text mb-2">Gestion des Portefeuilles</h1>
                <p className="text-gray-400">Suivi centralisé des fonds, des liquidités et des mouvements financiers.</p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 my-8">
                {summaryData.map((stat, index) => <SummaryCard key={index} {...stat} />)}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-effect rounded-2xl p-6">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
                    <div className="relative w-full md:w-1/3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            placeholder="Rechercher par nom, ID, gestionnaire, zone..."
                            className="pl-10 bg-slate-900/50 border-slate-700"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handleExport}><FileDown className="w-4 h-4 mr-2" /> Exporter (Excel)</Button>
                        <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Créer un compte</Button>
                    </div>
                </div>

                <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-slate-800 hover:bg-transparent text-xs whitespace-nowrap">
                                <TableHead>ID</TableHead>
                                <TableHead>Nom du Portefeuille</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Gestionnaire</TableHead>
                                <TableHead>Solde Actuel</TableHead>
                                {/* La colonne « Rendement » servait `yield: 0`, en dur. */}
                                <TableHead>Statut</TableHead>
                                <TableHead>Zone</TableHead>
                                <TableHead>Risque</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredWallets.map((wallet) => {
                                const statusInfo = getStatusBadge(wallet.status);
                                return (
                                <TableRow key={wallet.id} className="border-slate-800 text-sm">
                                    <TableCell className="font-mono text-xs text-slate-400">{wallet.id}</TableCell>
                                    <TableCell className="font-semibold text-white">{wallet.name}</TableCell>
                                    <TableCell>{wallet.type}</TableCell>
                                    <TableCell>{wallet.partnerName || wallet.source}</TableCell>
                                    <TableCell>{wallet.manager}</TableCell>
                                    <TableCell className="font-mono text-emerald-400">{wallet.balance.toLocaleString('fr-FR')} {wallet.currency}</TableCell>
                                    <TableCell>
                                        <Badge variant={statusInfo.variant} className="flex items-center gap-1.5">
                                            {statusInfo.icon} {wallet.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{wallet.scope}</TableCell>
                                    <TableCell>
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger>
                                                    <span className={RISK_LEVEL_CLASS[wallet.riskLevel] ?? 'text-slate-400'}>
                                                        {RISK_LEVEL_LABEL[wallet.riskLevel] ?? (wallet.riskLevel || 'non servi')}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-slate-800 text-white border-slate-700">
                                                    <p>Niveau de risque du compte, classé par l'institution</p>
                                                    <p className="text-xs text-slate-400">
                                                        Trois valeurs possibles — ce n'est pas un taux mesuré.
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                                                <DropdownMenuItem onSelect={() => handleAction('details', wallet.id)}><Eye className="mr-2 h-4 w-4" />Voir détails</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('report', wallet.id)}><FileText className="mr-2 h-4 w-4" />Exporter rapport</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('analytics', wallet.id)}><BarChart2 className="mr-2 h-4 w-4" />Analyse graphique</DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-slate-700"/>
                                                <DropdownMenuItem onSelect={() => handleAction('edit', wallet.id)}><Edit className="mr-2 h-4 w-4" />Modifier infos</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('add_flow', wallet.id)}><Landmark className="mr-2 h-4 w-4" />Ajouter flux</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('transfer', wallet.id)}><Upload className="mr-2 h-4 w-4" />Transférer fonds</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('reassign', wallet.id)}><Shuffle className="mr-2 h-4 w-4" />Changer de gérant</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('comment', wallet.id)}><MessageSquare className="mr-2 h-4 w-4" />Commenter / Noter</DropdownMenuItem>
                                                {wallet.type === 'CAISSE' && (
                                                    <>
                                                        <DropdownMenuItem onSelect={() => handleAction('register', wallet.id)}><Calculator className="mr-2 h-4 w-4" />Séance de caisse</DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => handleAction('set_ceiling', wallet.id)}><Gauge className="mr-2 h-4 w-4" />Plafond journalier</DropdownMenuItem>
                                                    </>
                                                )}
                                                {wallet.type === 'MOBILE_MONEY' && (
                                                    <DropdownMenuItem onSelect={() => handleAction('partner_link', wallet.id)}><Link2 className="mr-2 h-4 w-4" />Partenaire API</DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator className="bg-slate-700"/>
                                                <DropdownMenuItem onSelect={() => handleAction('block', wallet.id)} className="text-yellow-400 focus:text-yellow-300"><Lock className="mr-2 h-4 w-4" />Bloquer</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('archive', wallet.id)} className="text-red-400 focus:text-red-300"><Trash2 className="mr-2 h-4 w-4" />Archiver</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            )})}
                        </TableBody>
                    </Table>
                </div>
            </motion.div>

            <AccountFormModal isOpen={isCreateOpen} onClose={() => setCreateOpen(false)} wallet={null} agencies={agencies} onSave={handleCreate} />
            <AccountFormModal isOpen={!!editWallet} onClose={() => setEditWallet(null)} wallet={editWallet} agencies={agencies} onSave={handleEdit} />
            <TransferModal wallet={transferWallet} wallets={walletsData} onClose={() => setTransferWallet(null)} onSubmit={handleTransfer} />
            <FlowModal wallet={flowWallet} onClose={() => setFlowWallet(null)} onSubmit={handleFlow} />
            <ReassignModal wallet={reassignWallet} onClose={() => setReassignWallet(null)} onSubmit={handleReassign} />
            <DetailsModal wallet={detailsWallet} onClose={() => setDetailsWallet(null)} />
            <RegisterDialog wallet={registerWallet} onClose={() => setRegisterWallet(null)} toast={toast} onChanged={loadWallets} />
            <PartnerLinkDialog wallet={partnerWallet} onClose={() => setPartnerWallet(null)} toast={toast} onChanged={loadWallets} />
            <CeilingModal wallet={ceilingWallet} onClose={() => setCeilingWallet(null)} onSubmit={handleSetCeiling} />
        </Layout>
    );
};

export default Wallets;
