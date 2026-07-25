import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Wallet, Landmark, Users, Activity, Plus, Search, MoreHorizontal, FileDown, Eye, Edit, Trash2, Shuffle,
    BarChart2, FileText, Lock, MessageSquare, Upload, TrendingUp, AlertTriangle, Clock, CheckCircle,
    Calculator, Link2, Gauge
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { exportToExcel } from '@/lib/export.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError } from '@/services/api';

/*
 * `RISK_LABEL_TO_PCT = { FAIBLE: 2, MODERE: 5, ELEVE: 8 }` a été SUPPRIMÉ.
 *
 * `caisses.TreasuryAccount.risk_level` est un champ CATÉGORIEL à trois valeurs.
 * Le convertir en 2 / 5 / 8 fabriquait une grandeur continue là où il n'y a
 * qu'un classement : « 5 % » se lit comme un taux mesuré, avec sa précision et
 * sa comparabilité, alors que rien de tel n'a jamais été calculé. Le chiffre
 * partait de surcroît dans `rapport_portefeuilles_global.xlsx` sous l'en-tête
 * « Taux Risque (%) », où il pouvait entrer dans une moyenne.
 *
 * On affiche le NIVEAU servi, avec son libellé.
 */
const RISK_LEVEL_LABEL = { FAIBLE: 'Faible', MODERE: 'Modéré', ELEVE: 'Élevé' };
const RISK_LEVEL_CLASS = {
  FAIBLE: 'text-emerald-400', MODERE: 'text-yellow-400', ELEVE: 'text-red-400',
};
const STATUS_CODE_TO_LABEL = { ACTIF: 'Actif', EN_TRAITEMENT: 'En traitement', EN_OBSERVATION: 'En observation',
    BLOQUE: 'Bloqué', ARCHIVE: 'Archivé' };

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

const AccountFormModal = ({ isOpen, onClose, wallet, agencies, onSave }) => {
    const emptyForm = { code: '', name: '', kind: 'CAISSE', currency: 'USD', agencyId: '', manager: '', initialAmount: '0', scope: '', riskLevel: 'FAIBLE' };
    const [form, setForm] = useState(emptyForm);

    useEffect(() => {
        setForm(wallet
            ? { code: wallet.id, name: wallet.name, manager: wallet.manager === '-' ? '' : wallet.manager, scope: wallet.scope === '-' ? '' : wallet.scope, riskLevel: '' }
            : emptyForm);
    }, [wallet, isOpen]);

    const handleSubmit = () => {
        if (!form.name.trim() || (!wallet && !form.code.trim())) return;
        onSave(form);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>{wallet ? `Modifier ${wallet.name}` : 'Créer un Portefeuille'}</DialogTitle>
                    <DialogDescription>
                        {wallet ? 'Nom, gestionnaire et zone du compte de trésorerie.' : "Nouveau compte de trésorerie (caisse, banque ou mobile money)."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {!wallet && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Code</Label>
                            <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                                placeholder="Ex: CAISSE-KIN-01" className="col-span-3 bg-slate-900 border-slate-700" />
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Nom</Label>
                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                            className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    {!wallet && (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Type</Label>
                                <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                                    <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CAISSE">Caisse</SelectItem>
                                        <SelectItem value="BANQUE">Banque</SelectItem>
                                        <SelectItem value="MOBILE_MONEY">Mobile Money</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Devise</Label>
                                <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                                    <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="USD">USD</SelectItem>
                                        <SelectItem value="CDF">CDF</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Agence</Label>
                                <Select value={form.agencyId ? String(form.agencyId) : 'hq'} onValueChange={v => setForm({ ...form, agencyId: v === 'hq' ? '' : v })}>
                                    <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue placeholder="Siège (HQ)" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="hq">Siège (HQ)</SelectItem>
                                        {agencies.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Montant Initial</Label>
                                <Input type="number" value={form.initialAmount} onChange={e => setForm({ ...form, initialAmount: e.target.value })}
                                    className="col-span-3 bg-slate-900 border-slate-700" />
                            </div>
                        </>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Gestionnaire</Label>
                        <Input value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })}
                            placeholder="sub du gestionnaire" className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Zone</Label>
                        <Input value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}
                            className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    {wallet && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">Niveau Risque</Label>
                            <Select value={form.riskLevel || 'FAIBLE'} onValueChange={v => setForm({ ...form, riskLevel: v })}>
                                <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="FAIBLE">Faible</SelectItem>
                                    <SelectItem value="MODERE">Modéré</SelectItem>
                                    <SelectItem value="ELEVE">Élevé</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">{wallet ? 'Enregistrer' : 'Créer'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const TransferModal = ({ wallet, wallets, onClose, onSubmit }) => {
    const [toCode, setToCode] = useState('');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => { setToCode(''); setAmount(''); setReason(''); }, [wallet]);

    const others = wallets.filter(w => w.id !== wallet?.id);

    return (
        <Dialog open={!!wallet} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>Transférer des fonds</DialogTitle>
                    <DialogDescription>Depuis {wallet?.name} (${wallet?.balance.toLocaleString()})</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Vers</Label>
                        <Select value={toCode} onValueChange={setToCode}>
                            <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue placeholder="Compte destination" /></SelectTrigger>
                            <SelectContent>
                                {others.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.id})</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Montant</Label>
                        <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Motif</Label>
                        <Input value={reason} onChange={e => setReason(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button disabled={!toCode || !amount} onClick={() => onSubmit(toCode, amount, reason)} className="bg-emerald-600 hover:bg-emerald-700">Transférer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const FlowModal = ({ wallet, onClose, onSubmit }) => {
    const [amount, setAmount] = useState('');
    const [direction, setDirection] = useState('in');
    const [reason, setReason] = useState('');

    useEffect(() => { setAmount(''); setDirection('in'); setReason(''); }, [wallet]);

    return (
        <Dialog open={!!wallet} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>Ajouter un flux</DialogTitle>
                    <DialogDescription>{wallet?.name}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Sens</Label>
                        <Select value={direction} onValueChange={setDirection}>
                            <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="in">Entrée</SelectItem>
                                <SelectItem value="out">Sortie</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Montant</Label>
                        <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Motif</Label>
                        <Input value={reason} onChange={e => setReason(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button disabled={!amount} onClick={() => onSubmit(amount, direction, reason)} className="bg-emerald-600 hover:bg-emerald-700">Ajouter</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ReassignModal = ({ wallet, onClose, onSubmit }) => {
    const [manager, setManager] = useState('');
    useEffect(() => { setManager(wallet && wallet.manager !== '-' ? wallet.manager : ''); }, [wallet]);

    return (
        <Dialog open={!!wallet} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>Réaffecter le gestionnaire</DialogTitle>
                    <DialogDescription>{wallet?.name}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Gestionnaire</Label>
                        <Input value={manager} onChange={e => setManager(e.target.value)} placeholder="sub du nouveau gestionnaire" className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button disabled={!manager.trim()} onClick={() => onSubmit(manager)} className="bg-emerald-600 hover:bg-emerald-700">Réaffecter</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const DetailsModal = ({ wallet, onClose }) => (
    <Dialog open={!!wallet} onOpenChange={onClose}>
        <DialogContent className="glass-effect text-white sm:max-w-[450px]">
            <DialogHeader>
                <DialogTitle>{wallet?.name}</DialogTitle>
                <DialogDescription className="font-mono text-xs">{wallet?.id}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
                {[
                    ['Type', wallet?.type], ['Gestionnaire', wallet?.manager], ['Solde Actuel', `$${wallet?.balance.toLocaleString()}`],
                    ['Montant Initial', `$${wallet?.initialAmount.toLocaleString()}`], ['Statut', wallet?.status],
                    ['Zone', wallet?.scope],
                    ['Niveau de risque', RISK_LEVEL_LABEL[wallet?.riskLevel] ?? (wallet?.riskLevel || 'non servi')],
                    ['Date Création', wallet?.creationDate],
                ].map(([label, value]) => (
                    <div key={label} className="flex justify-between border-b border-slate-800 pb-1">
                        <span className="text-slate-400">{label}</span>
                        <span className="text-white">{value}</span>
                    </div>
                ))}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={onClose}>Fermer</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

// Discipline de caisse journalière (comptes `kind=CAISSE`) — comptage d'ouverture/clôture
// comparé au solde système ; un écart au-delà de la tolérance gèle automatiquement le compte.
const RegisterDialog = ({ wallet, onClose, toast, onChanged }) => {
    const [sessions, setSessions] = useState(undefined);
    const [openingCount, setOpeningCount] = useState('');
    const [closingCount, setClosingCount] = useState('');

    const load = useCallback(() => {
        if (!wallet) return;
        setSessions(undefined);
        api.caisses.accounts.registerSessions(wallet.id).then(setSessions).catch(() => setSessions([]));
    }, [wallet]);

    useEffect(() => { load(); setOpeningCount(''); setClosingCount(''); }, [load]);

    const current = sessions?.find(s => s.status === 'OPEN');

    const handleOpen = async () => {
        try {
            await api.caisses.accounts.registerOpen(wallet.id, Number(openingCount));
            toast({ title: 'Séance de caisse ouverte' });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleClose = async () => {
        try {
            const result = await api.caisses.accounts.registerClose(wallet.id, Number(closingCount));
            if (result.status === 'DISCREPANCY') {
                toast({ variant: 'destructive', title: 'Écart constaté — compte gelé', description: `Écart : ${result.discrepancy}` });
            } else {
                toast({ title: 'Séance clôturée sans écart' });
            }
            load();
            onChanged();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    return (
        <Dialog open={!!wallet} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>Séance de caisse — {wallet?.name}</DialogTitle>
                    <DialogDescription>
                        Comptage d'ouverture puis de clôture comparé au solde système. Un écart au-delà de la
                        tolérance gèle automatiquement le compte.
                    </DialogDescription>
                </DialogHeader>
                {sessions === undefined ? (
                    <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
                ) : current ? (
                    <div className="space-y-3 py-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Ouverte par</span><span>{current.openedBy || '—'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Comptage d'ouverture</span><span>{current.openingCount.toLocaleString()}</span>
                        </div>
                        <div className="space-y-2">
                            <Label>Comptage de clôture</Label>
                            <Input type="number" value={closingCount} onChange={e => setClosingCount(e.target.value)} className="bg-slate-900 border-slate-700" />
                        </div>
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!closingCount} onClick={handleClose}>
                            Clôturer la séance
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-3 py-2">
                        <div className="space-y-2">
                            <Label>Comptage d'ouverture</Label>
                            <Input type="number" value={openingCount} onChange={e => setOpeningCount(e.target.value)} className="bg-slate-900 border-slate-700" />
                        </div>
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!openingCount} onClick={handleOpen}>
                            Ouvrir la séance
                        </Button>
                    </div>
                )}
                <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// Rattachement + synchronisation partenaire (comptes `kind=MOBILE_MONEY`) — délègue au
// disjoncteur/health-check déjà réel de `partners`.
const PartnerLinkDialog = ({ wallet, onClose, toast, onChanged }) => {
    const [partners, setPartners] = useState([]);
    const [partnerId, setPartnerId] = useState('');

    useEffect(() => {
        if (!wallet) return;
        api.partners.list().then(setPartners).catch(() => setPartners([]));
        setPartnerId(wallet.partnerId ? String(wallet.partnerId) : '');
    }, [wallet]);

    const handleLink = async () => {
        try {
            await api.caisses.accounts.linkPartner(wallet.id, partnerId ? Number(partnerId) : null);
            toast({ title: 'Partenaire rattaché' });
            onChanged();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleSync = async () => {
        try {
            const result = await api.caisses.accounts.syncPartner(wallet.id);
            toast({ title: 'Synchronisation effectuée', description: `Statut : ${result.partnerSyncStatus} · disjoncteur : ${result.partnerCircuitState}` });
            onChanged();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    return (
        <Dialog open={!!wallet} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>Partenaire API — {wallet?.name}</DialogTitle>
                    <DialogDescription>Rattachement Mobile Money et synchronisation de connectivité.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-2">
                        <Label>Partenaire</Label>
                        <Select value={partnerId} onValueChange={setPartnerId}>
                            <SelectTrigger className="bg-slate-900 border-slate-700"><SelectValue placeholder="Aucun" /></SelectTrigger>
                            <SelectContent>
                                {partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button className="w-full" variant="outline" onClick={handleLink}>Enregistrer le rattachement</Button>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!wallet?.partnerId && !partnerId} onClick={handleSync}>
                        Synchroniser maintenant
                    </Button>
                </div>
                <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CeilingModal = ({ wallet, onClose, onSubmit }) => {
    const [ceiling, setCeiling] = useState('');
    useEffect(() => { setCeiling(wallet?.dailyCeiling != null ? String(wallet.dailyCeiling) : ''); }, [wallet]);

    return (
        <Dialog open={!!wallet} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>Plafond journalier de caisse</DialogTitle>
                    <DialogDescription>{wallet?.name} — laisser vide pour retirer le plafond.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Plafond</Label>
                        <Input type="number" value={ceiling} onChange={e => setCeiling(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button onClick={() => onSubmit(ceiling ? Number(ceiling) : null)} className="bg-emerald-600 hover:bg-emerald-700">Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
    // `yield: 0` a été SUPPRIMÉ, avec la colonne « Rendement » et sa colonne
    // d'export. Le commentaire d'origine disait justement qu'aucun rendement
    // n'existe sur une caisse cash — mais il concluait « laissés à 0 plutôt
    // qu'inventés », et un zéro EST une invention : « 0 % » se lit comme une
    // mesure, c'est-à-dire comme un compte qui ne rapporte rien, et il partait
    // dans un classeur où il entrait dans les moyennes. Une trésorerie n'a pas
    // de rendement : la bonne réponse n'est pas zéro, c'est l'absence de colonne.
    const loadWallets = () => api.caisses.accounts.list().then(rows => setWalletsData(rows.map(a => ({
        id: a.code, name: a.name, type: a.kind, source: '-', manager: a.manager || '-',
        initialAmount: a.initialAmount, balance: a.balance,
        status: STATUS_CODE_TO_LABEL[a.status] || a.status,
        creationDate: new Date(a.createdAt).toLocaleDateString('fr-FR'), scope: a.scope || '-',
        riskLevel: a.riskLevel || null,
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
            "Montant Initial ($)": wallet.initialAmount, "Solde Actuel ($)": wallet.balance, "Statut": wallet.status,
            "Date Création": wallet.creationDate, "Zone": wallet.scope,
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
            toast({ title: 'Portefeuille créé' });
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
            toast({ title: 'Portefeuille mis à jour' });
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
            toast({ title: 'Gestionnaire réaffecté' });
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
            "Montant Initial ($)": w.initialAmount,
            "Solde Actuel ($)": w.balance,
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
                        <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> Créer un Portefeuille</Button>
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
                                    <TableCell>{wallet.source}</TableCell>
                                    <TableCell>{wallet.manager}</TableCell>
                                    <TableCell className="font-mono text-emerald-400">${wallet.balance.toLocaleString()}</TableCell>
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
                                                <DropdownMenuItem onSelect={() => handleAction('reassign', wallet.id)}><Shuffle className="mr-2 h-4 w-4" />Réaffecter ressources</DropdownMenuItem>
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
                                                <DropdownMenuItem onSelect={() => handleAction('block', wallet.id)} className="text-yellow-400 focus:text-yellow-300"><Lock className="mr-2 h-4 w-4" />Bloquer portefeuille</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleAction('archive', wallet.id)} className="text-red-400 focus:text-red-300"><Trash2 className="mr-2 h-4 w-4" />Archiver / Supprimer</DropdownMenuItem>
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
