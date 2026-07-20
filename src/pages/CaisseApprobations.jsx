import React, { useEffect, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import {
    CheckCircle2, XCircle, Loader2, RefreshCw, ShieldCheck, Send,
    ArrowDownCircle, RotateCcw, Clock, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';

const STATUS_META = {
    pending_validation: { label: 'En attente', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
    posted:             { label: 'Validé',      color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    rejected:           { label: 'Rejeté',      color: 'text-red-400 border-red-500/30 bg-red-500/10' },
};

const fmtAmt = (n) => `${Number(n ?? 0).toLocaleString('fr-FR')} USD`;
const fmtDate = (s) => s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const StatusBadge = ({ status }) => {
    const m = STATUS_META[status] || { label: status, color: 'text-slate-400 border-slate-500/30 bg-slate-500/10' };
    return (
        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${m.color}`}>
            {m.label}
        </span>
    );
};

/** Dialog OTP générique — fonctionne pour withdrawal-requests et regularization-orders */
const OtpApprovalDialog = ({ open, onClose, item, type, onApproved }) => {
    const { toast } = useToast();
    const [phase, setPhase] = useState('idle'); // idle | requesting | entering | verifying | done
    const [challengeId, setChallengeId] = useState(null);
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);

    const apis = type === 'withdrawal'
        ? api.caisses.withdrawalRequests
        : api.caisses.regularizationOrders;
    const itemId = type === 'withdrawal' ? item?.requestId : item?.orderId;

    useEffect(() => {
        if (!open) { setPhase('idle'); setChallengeId(null); setCode(''); }
    }, [open]);

    const requestCode = async () => {
        setLoading(true);
        try {
            const res = await apis.otpRequest(itemId);
            setChallengeId(res.challengeId);
            setPhase('entering');
            toast({ title: 'Code envoyé', description: 'Vérifiez vos SMS/email.' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    const verify = async () => {
        if (!challengeId || code.length !== 6) return;
        setLoading(true);
        try {
            const res = await apis.otpVerify(itemId, challengeId, code);
            if (!res.verified) {
                toast({ variant: 'destructive', title: 'Code incorrect', description: 'Code invalide ou expiré.' });
                return;
            }
            await apis.approve(itemId, code);
            toast({ title: 'Approuvé', description: `${type === 'withdrawal' ? 'Retrait' : 'Régularisation'} #${itemId} approuvé.` });
            setPhase('done');
            onApproved?.();
            onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    if (!item) return null;
    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-emerald-400" />
                        Approuver {type === 'withdrawal' ? 'le retrait' : 'la régularisation'} #{itemId}
                    </DialogTitle>
                    <DialogDescription>
                        Montant : <strong>{fmtAmt(item.amount)}</strong>
                        {item.detail ? ` — ${item.detail}` : ''}
                    </DialogDescription>
                </DialogHeader>

                {phase === 'idle' && (
                    <div className="space-y-4 py-2">
                        <p className="text-sm text-slate-400">
                            Un code OTP sera envoyé par SMS pour confirmer cette approbation.
                        </p>
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={requestCode} disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                            Envoyer le code OTP
                        </Button>
                    </div>
                )}

                {phase === 'entering' && (
                    <div className="space-y-4 py-2">
                        <div>
                            <Label>Code reçu par SMS</Label>
                            <Input
                                value={code}
                                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="_ _ _ _ _ _"
                                maxLength={6}
                                className="mt-1 font-mono tracking-widest text-center text-xl bg-slate-800 border-slate-600"
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={requestCode} disabled={loading} className="flex-1">
                                <Send className="w-3 h-3 mr-1" /> Renvoyer
                            </Button>
                            <Button
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                onClick={verify}
                                disabled={loading || code.length !== 6}
                            >
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                                Vérifier &amp; Approuver
                            </Button>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={loading}>Annuler</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

/** Dialog de rejet */
const RejectDialog = ({ open, onClose, item, type, onRejected }) => {
    const { toast } = useToast();
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);

    const apis = type === 'withdrawal'
        ? api.caisses.withdrawalRequests
        : api.caisses.regularizationOrders;
    const itemId = type === 'withdrawal' ? item?.requestId : item?.orderId;

    useEffect(() => { if (!open) setNote(''); }, [open]);

    const handleReject = async () => {
        setLoading(true);
        try {
            await apis.reject(itemId, note);
            toast({ title: 'Rejeté', description: `${type === 'withdrawal' ? 'Retrait' : 'Régularisation'} #${itemId} rejeté.` });
            onRejected?.();
            onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    if (!item) return null;
    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-red-400">
                        <XCircle className="w-5 h-5" />
                        Rejeter {type === 'withdrawal' ? 'le retrait' : 'la régularisation'} #{itemId}
                    </DialogTitle>
                    <DialogDescription>
                        Montant : <strong>{fmtAmt(item.amount)}</strong>
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                    <Label>Motif du rejet <span className="text-slate-500">(optionnel)</span></Label>
                    <Textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Expliquez la raison du rejet..."
                        rows={3}
                        className="bg-slate-800 border-slate-700"
                    />
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={loading}>Annuler</Button>
                    <Button variant="destructive" onClick={handleReject} disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                        Confirmer le rejet
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ItemCard = ({ item, type, onRefresh }) => {
    const [approveOpen, setApproveOpen] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const isPending = item.status === 'pending_validation';
    const id = type === 'withdrawal' ? item.requestId : item.orderId;

    return (
        <div className="glass-effect rounded-xl border border-white/10 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        {type === 'withdrawal'
                            ? <ArrowDownCircle className="w-4 h-4 text-orange-400" />
                            : <RotateCcw className="w-4 h-4 text-blue-400" />}
                        <span className="font-semibold text-white text-sm">
                            #{id} — {fmtAmt(item.amount)}
                        </span>
                        {item.autoValidated && (
                            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30">Auto-validé</Badge>
                        )}
                    </div>
                    {item.detail && <p className="text-xs text-slate-400">{item.detail}</p>}
                    {item.ticketId && (
                        <p className="text-xs text-slate-500">Ticket #{item.ticketId}</p>
                    )}
                </div>
                <StatusBadge status={item.status} />
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {item.requiredApprovals > 0
                        ? `${item.approvalsCount}/${item.requiredApprovals} approbations`
                        : 'Approbation requise'}
                </span>
            </div>

            {isPending && (
                <div className="flex gap-2 pt-1">
                    <Button
                        size="sm"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs"
                        onClick={() => setApproveOpen(true)}
                    >
                        <ShieldCheck className="w-3 h-3 mr-1" /> Approuver
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                        onClick={() => setRejectOpen(true)}
                    >
                        <XCircle className="w-3 h-3 mr-1" /> Rejeter
                    </Button>
                </div>
            )}

            <OtpApprovalDialog
                open={approveOpen}
                onClose={() => setApproveOpen(false)}
                item={item}
                type={type}
                onApproved={onRefresh}
            />
            <RejectDialog
                open={rejectOpen}
                onClose={() => setRejectOpen(false)}
                item={item}
                type={type}
                onRejected={onRefresh}
            />
        </div>
    );
};

const ListSection = ({ items, type, loading, onRefresh }) => {
    if (loading) {
        return (
            <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Chargement…
            </div>
        );
    }
    if (!items.length) {
        return (
            <div className="text-center py-16 text-slate-500">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500/40" />
                <p>Aucun élément en attente.</p>
            </div>
        );
    }
    const pending = items.filter(i => i.status === 'pending_validation');
    const others  = items.filter(i => i.status !== 'pending_validation');
    return (
        <div className="space-y-6">
            {pending.length > 0 && (
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3" /> En attente ({pending.length})
                    </h3>
                    {pending.map(item => (
                        <ItemCard key={type === 'withdrawal' ? item.requestId : item.orderId}
                            item={item} type={type} onRefresh={onRefresh} />
                    ))}
                </div>
            )}
            {others.length > 0 && (
                <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Historique récent</h3>
                    {others.map(item => (
                        <ItemCard key={type === 'withdrawal' ? item.requestId : item.orderId}
                            item={item} type={type} onRefresh={onRefresh} />
                    ))}
                </div>
            )}
        </div>
    );
};

const CaisseApprobations = () => {
    const [withdrawals, setWithdrawals] = useState([]);
    const [regularizations, setRegularizations] = useState([]);
    const [loadingW, setLoadingW] = useState(false);
    const [loadingR, setLoadingR] = useState(false);
    const { toast } = useToast();

    const loadWithdrawals = useCallback(() => {
        setLoadingW(true);
        api.caisses.withdrawalRequests.list()
            .then(setWithdrawals)
            .catch(e => toast({ variant: 'destructive', title: 'Erreur retraits', description: e instanceof ApiError ? e.message : String(e) }))
            .finally(() => setLoadingW(false));
    }, [toast]);

    const loadRegularizations = useCallback(() => {
        setLoadingR(true);
        api.caisses.regularizationOrders.list()
            .then(setRegularizations)
            .catch(e => toast({ variant: 'destructive', title: 'Erreur régularisations', description: e instanceof ApiError ? e.message : String(e) }))
            .finally(() => setLoadingR(false));
    }, [toast]);

    useEffect(() => { loadWithdrawals(); loadRegularizations(); }, [loadWithdrawals, loadRegularizations]);

    const pendingW = withdrawals.filter(w => w.status === 'pending_validation').length;
    const pendingR = regularizations.filter(r => r.status === 'pending_validation').length;

    return (
        <>
            <Helmet><title>Approbations Caisse — AGRICAP</title></Helmet>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <ShieldCheck className="w-6 h-6 text-emerald-400" />
                            Approbations Caisse
                        </h1>
                        <p className="text-slate-400 mt-1 text-sm">
                            Retraits clients et ordres de régularisation à approuver (OTP requis).
                        </p>
                    </div>
                    <Button variant="outline" onClick={() => { loadWithdrawals(); loadRegularizations(); }}>
                        <RefreshCw className="w-4 h-4 mr-2" /> Actualiser
                    </Button>
                </div>

                <Tabs defaultValue="withdrawals">
                    <TabsList className="bg-slate-800/50">
                        <TabsTrigger value="withdrawals" className="flex items-center gap-2">
                            <ArrowDownCircle className="w-4 h-4 text-orange-400" />
                            Retraits
                            {pendingW > 0 && (
                                <Badge className="bg-amber-500 text-white text-[10px] h-4 min-w-4 px-1 ml-1">
                                    {pendingW}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="regularizations" className="flex items-center gap-2">
                            <RotateCcw className="w-4 h-4 text-blue-400" />
                            Régularisations
                            {pendingR > 0 && (
                                <Badge className="bg-amber-500 text-white text-[10px] h-4 min-w-4 px-1 ml-1">
                                    {pendingR}
                                </Badge>
                            )}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="withdrawals" className="mt-4">
                        <ListSection
                            items={withdrawals}
                            type="withdrawal"
                            loading={loadingW}
                            onRefresh={loadWithdrawals}
                        />
                    </TabsContent>

                    <TabsContent value="regularizations" className="mt-4">
                        <ListSection
                            items={regularizations}
                            type="regularization"
                            loading={loadingR}
                            onRefresh={loadRegularizations}
                        />
                    </TabsContent>
                </Tabs>
            </div>
        </>
    );
};

export default CaisseApprobations;
