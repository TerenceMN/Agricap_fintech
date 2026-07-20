import React, { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useToast } from '@/components/ui/use-toast.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    MessageSquare, Phone, Eye, Send, CheckCircle, Clock, AlertTriangle,
    User, CreditCard, PiggyBank, Smartphone, Repeat, X, Search,
    BarChart3, ShieldAlert, FileText, CheckCircle2, UserCog, History,
    Briefcase, Activity, AlertCircle, ArrowUpRight, Star, RotateCcw, XCircle,
    Loader2, Zap, TrendingUp, AlertOctagon,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { api, ApiError } from '@/services/api';
import { menuKeyFor } from '@/components/Layout';


// ── Constantes ─────────────────────────────────────────────────────────────────

const TICKET_CATEGORIES = {
    'credit': { label: 'Crédit', icon: CreditCard, color: 'text-blue-400' },
    'epargne': { label: 'Épargne', icon: PiggyBank, color: 'text-emerald-400' },
    'mobile-money': { label: 'Mobile Money', icon: Smartphone, color: 'text-orange-400' },
    'comptabilite': { label: 'Comptabilité', icon: Briefcase, color: 'text-purple-400' },
    'fx': { label: 'Change (FX)', icon: Repeat, color: 'text-indigo-400' },
    'technique': { label: 'Technique', icon: Activity, color: 'text-slate-400' }
};

const PRIORITIES = {
    'faible': { label: 'Faible', color: 'bg-slate-500/20 text-slate-300' },
    'normal': { label: 'Normal', color: 'bg-blue-500/20 text-blue-300' },
    'urgent': { label: 'Urgent', color: 'bg-orange-500/20 text-orange-300' },
    'critique': { label: 'Critique', color: 'bg-red-500/20 text-red-300' }
};

const STATUSES = {
    'ouvert': { label: 'Ouvert', color: 'bg-blue-500/20 text-blue-400' },
    'en-traitement': { label: 'En Traitement', color: 'bg-yellow-500/20 text-yellow-400' },
    'escalade': { label: 'Escaladé', color: 'bg-orange-500/20 text-orange-400' },
    'en-attente-client': { label: 'En attente client', color: 'bg-amber-500/20 text-amber-400' },
    'resolu': { label: 'Résolu', color: 'bg-emerald-500/20 text-emerald-400' },
    'rejete': { label: 'Rejeté', color: 'bg-red-500/20 text-red-400' }
};

const REJECT_TYPES = [
    { value: 'doublon', label: 'Doublon' },
    { value: 'hors_perimetre', label: 'Hors périmètre' },
    { value: 'informations_insuffisantes', label: 'Informations insuffisantes' },
    { value: 'fraude_suspectee', label: 'Fraude suspectée' },
];


// ── Composants utilitaires ─────────────────────────────────────────────────────

const StatusBadge = ({ status }) => (
    <Badge className={`${STATUSES[status]?.color || 'bg-gray-500'} border-0`}>
        {STATUSES[status]?.label || status}
    </Badge>
);

const PriorityBadge = ({ priority }) => (
    <Badge className={`${PRIORITIES[priority]?.color || 'bg-gray-500'} border-0`}>
        {PRIORITIES[priority]?.label || priority}
    </Badge>
);

const SlaBadge = ({ ticket }) => {
    if (!ticket) return null;
    if (ticket.slaBreachedFirstResponse || ticket.slaBreachedResolution) {
        return <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">SLA dépassé</Badge>;
    }
    if (ticket.waitingOn === 'client') {
        return <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-[10px]">En attente client</Badge>;
    }
    if (ticket.slaResolutionDue && !['resolu', 'rejete'].includes(ticket.status)) {
        return (
            <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px]">
                Échéance {new Date(ticket.slaResolutionDue).toLocaleDateString()}
            </Badge>
        );
    }
    return null;
};

const RatingWidget = ({ ticket, onRated }) => {
    const { toast } = useToast();
    const [hovered, setHovered] = useState(0);
    const [saving, setSaving] = useState(false);

    if (ticket.satisfactionRating) {
        return (
            <div className="flex items-center gap-1 text-xs text-slate-400">
                Votre note :
                {[1, 2, 3, 4, 5].map(n => (
                    <Star key={n} className={`w-3.5 h-3.5 ${n <= ticket.satisfactionRating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                ))}
            </div>
        );
    }

    const rate = async (value) => {
        setSaving(true);
        try {
            await api.support.tickets.rate(ticket.id, value);
            toast({ title: "Merci pour votre retour !" });
            onRated();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setSaving(false); }
    };

    return (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <span className="text-xs text-slate-400 mr-1">Évaluer :</span>
            {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" disabled={saving}
                    onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
                    onClick={() => rate(n)}>
                    <Star className={`w-4 h-4 ${n <= hovered ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                </button>
            ))}
        </div>
    );
};

const RISK_COLORS = { 'Bas': 'text-emerald-400', 'Moyen': 'text-amber-400', 'Élevé': 'text-red-400' };

const ClientCRMCard = ({ client, data360, onReveal, revealedContact, isStaff }) => {
    if (!client) return <div className="p-4 text-center text-slate-500">Sélectionnez un ticket pour voir le profil client</div>;
    const d = data360;
    return (
        <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-emerald-500">
                        <AvatarFallback className="bg-emerald-900 text-emerald-200 font-bold text-sm">
                            {(client.name || '?').substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <CardTitle className="text-base text-white truncate">{client.name}</CardTitle>
                        <CardDescription className="font-mono text-xs truncate">{client.sub}</CardDescription>
                    </div>
                    {d?.risk && (
                        <span className={`text-xs font-semibold shrink-0 ${RISK_COLORS[d.risk.label] || 'text-slate-400'}`}>
                            ● {d.risk.label}
                        </span>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                {/* KYC */}
                <div className="flex justify-between">
                    <span className="text-slate-400 text-xs">KYC</span>
                    <span className="text-white text-xs flex items-center gap-1">
                        {(d?.kyc?.status || client.kycStatus) === 'Validé'
                            ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            : <AlertCircle className="w-3 h-3 text-amber-500" />}
                        {d?.kyc?.levelLabel || client.kycStatus || 'N/D'}
                    </span>
                </div>
                {d?.kyc?.limitations && (
                    <p className="text-[11px] text-slate-500 bg-slate-800/60 rounded px-2 py-1">{d.kyc.limitations}</p>
                )}
                {d?.kyc?.warnings?.map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-500/10 rounded px-2 py-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> {w}
                    </div>
                ))}

                {/* Historique support */}
                {d?.support && (
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Tickets support</span>
                        <span className="text-white text-xs">{d.support.total} total · {d.support.open} ouvert(s)</span>
                    </div>
                )}
                {d?.support?.repeatIssueWarning && (
                    <div className="flex items-center gap-1.5 text-[11px] text-orange-400 bg-orange-500/10 rounded px-2 py-1">
                        <AlertOctagon className="w-3 h-3 shrink-0" /> Problème répété sur cette catégorie (30 j)
                    </div>
                )}
                {d?.support?.avgSatisfaction && (
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Satisfaction</span>
                        <span className="text-amber-400 text-xs flex items-center gap-1">
                            <Star className="w-3 h-3 fill-amber-400" /> {d.support.avgSatisfaction}/5
                        </span>
                    </div>
                )}

                {/* Contact */}
                {d?.contact && (
                    <div className="pt-1 border-t border-slate-800 space-y-1">
                        {revealedContact ? (
                            <>
                                {revealedContact.phone && (
                                    <div className="flex justify-between">
                                        <span className="text-slate-400 text-xs">Tél.</span>
                                        <span className="text-emerald-400 text-xs font-mono">{revealedContact.phone}</span>
                                    </div>
                                )}
                                {revealedContact.email && (
                                    <div className="flex justify-between">
                                        <span className="text-slate-400 text-xs">Email</span>
                                        <span className="text-emerald-400 text-xs font-mono truncate max-w-[140px]">{revealedContact.email}</span>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="flex justify-between">
                                    <span className="text-slate-400 text-xs">Tél.</span>
                                    <span className="text-slate-500 text-xs font-mono">{d.contact.phoneMasked || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400 text-xs">Email</span>
                                    <span className="text-slate-500 text-xs font-mono truncate max-w-[140px]">{d.contact.emailMasked || '—'}</span>
                                </div>
                                {isStaff && onReveal && (
                                    <Button size="sm" variant="ghost" className="h-6 w-full text-[10px] text-slate-400 border border-slate-700 mt-1"
                                        onClick={onReveal}>
                                        <Eye className="w-3 h-3 mr-1" /> Révéler coordonnées
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Fallback KYC simple */}
                {!d && (
                    <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Statut</span>
                        <span className="text-white text-xs">{client.kycStatus || 'N/D'} {client.kycLevel && `(${client.kycLevel})`}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};


// ── Dialogs ────────────────────────────────────────────────────────────────────

const VerifyMmDialog = ({ open, description, onClose, onConfirm }) => {
    const autoRef = React.useMemo(() => {
        if (!description) return '';
        const m = description.match(/\b(AG-\d+|MP\d+|OM\d+)\b/i);
        return m ? m[0].toUpperCase() : '';
    }, [description]);
    const [ref, setRef] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => { if (open) setRef(autoRef); }, [open, autoRef]);
    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-orange-400" /> Vérifier Mobile Money
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Entrez la référence de transaction à vérifier chez l'opérateur (format : AG-12345, MP123456, OM789…).
                    </DialogDescription>
                </DialogHeader>
                <Input value={ref} onChange={e => setRef(e.target.value)}
                    placeholder="Ex : AG-889900 ou MP123456"
                    className="bg-slate-800 border-slate-700 font-mono"
                    autoFocus />
                {autoRef && ref === autoRef && (
                    <p className="text-xs text-emerald-400">Référence détectée automatiquement dans la description.</p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="border-slate-600">Annuler</Button>
                    <Button className="bg-orange-600 hover:bg-orange-700" disabled={!ref.trim() || loading}
                        onClick={async () => { setLoading(true); await onConfirm(ref.trim()); setLoading(false); }}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Vérifier
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const AwaitClientDialog = ({ open, onClose, onConfirm }) => {
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => { if (open) setQuestion(''); }, [open]);
    const valid = question.trim().length >= 15;
    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-amber-400" /> En attente client
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Posez une question précise au client (min. 15 caractères). Le SLA sera mis en pause
                        jusqu'à sa réponse. Des relances automatiques seront envoyées à J+2 et J+5.
                    </DialogDescription>
                </DialogHeader>
                <Textarea value={question} onChange={e => setQuestion(e.target.value)}
                    placeholder="Ex : Pouvez-vous nous envoyer une capture du SMS de confirmation de la transaction ?"
                    className="bg-slate-800 border-slate-700 min-h-[90px]" autoFocus />
                {question.length > 0 && !valid && (
                    <p className="text-xs text-amber-400">{15 - question.trim().length} caractère(s) manquant(s)</p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="border-slate-600">Annuler</Button>
                    <Button className="bg-amber-600 hover:bg-amber-700" disabled={!valid || loading}
                        onClick={async () => { setLoading(true); await onConfirm(question); setLoading(false); }}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Mettre en attente
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const EscalateDialog = ({ open, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => { if (open) setReason(''); }, [open]);
    const valid = reason.trim().length >= 20;
    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Escalader le ticket</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Expliquez pourquoi ce ticket doit passer au niveau supérieur (min. 20 caractères).
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Ex : problème de débit répétitif nécessitant l'analyse back-office..."
                    className="bg-slate-800 border-slate-700 min-h-[100px]"
                    autoFocus
                />
                {reason.length > 0 && !valid && (
                    <p className="text-xs text-amber-400">{20 - reason.trim().length} caractère(s) manquant(s)</p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="border-slate-600">Annuler</Button>
                    <Button className="bg-orange-600 hover:bg-orange-700" disabled={!valid || loading}
                        onClick={async () => { setLoading(true); await onConfirm(reason); setLoading(false); }}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Escalader
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ResolveDialog = ({ open, onClose, onConfirm }) => {
    const [summary, setSummary] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => { if (open) setSummary(''); }, [open]);
    const valid = summary.trim().length >= 30;
    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Clôturer le ticket</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Résumez la solution apportée au client (min. 30 caractères).
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    value={summary} onChange={e => setSummary(e.target.value)}
                    placeholder="Ex : transaction retrouvée chez l'opérateur et créditée manuellement suite à vérification..."
                    className="bg-slate-800 border-slate-700 min-h-[100px]"
                    autoFocus
                />
                {summary.length > 0 && !valid && (
                    <p className="text-xs text-amber-400">{30 - summary.trim().length} caractère(s) manquant(s)</p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="border-slate-600">Annuler</Button>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!valid || loading}
                        onClick={async () => { setLoading(true); await onConfirm(summary); setLoading(false); }}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Clôturer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const RejectDialog = ({ open, onClose, onConfirm }) => {
    const [rejectType, setRejectType] = useState('hors_perimetre');
    const [reason, setReason] = useState('');
    const [originalTicketId, setOriginalTicketId] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => { if (open) { setRejectType('hors_perimetre'); setReason(''); setOriginalTicketId(''); } }, [open]);
    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Rejeter le ticket</DialogTitle>
                    <DialogDescription className="text-slate-400">Sélectionnez le type de rejet et expliquez le motif.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label>Type de rejet</Label>
                        <Select value={rejectType} onValueChange={setRejectType}>
                            <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {REJECT_TYPES.map(rt => <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    {rejectType === 'doublon' && (
                        <div className="space-y-1">
                            <Label>ID du ticket original (optionnel)</Label>
                            <Input value={originalTicketId} onChange={e => setOriginalTicketId(e.target.value)}
                                placeholder="Ex: 42" className="bg-slate-800 border-slate-700" type="number" />
                        </div>
                    )}
                    <div className="space-y-1">
                        <Label>Motif détaillé <span className="text-red-400">*</span></Label>
                        <Textarea value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Motif du rejet..." className="bg-slate-800 border-slate-700" />
                    </div>
                    {rejectType === 'fraude_suspectee' && (
                        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                            <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
                            Une alerte interne sera envoyée à la Conformité. Le client ne verra pas la mention "fraude".
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} className="border-slate-600">Annuler</Button>
                    <Button variant="destructive" disabled={!reason.trim() || loading}
                        onClick={async () => {
                            setLoading(true);
                            await onConfirm({
                                rejectType, reason,
                                originalTicketId: originalTicketId ? Number(originalTicketId) : null,
                            });
                            setLoading(false);
                        }}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Rejeter
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ForceCreditDialog = ({ open, ticket, onClose, onDone, toast }) => {
    const [loading, setLoading] = useState(false);
    const [rejectNote, setRejectNote] = useState('');
    const [rejectMode, setRejectMode] = useState(false);
    useEffect(() => { if (open) { setRejectNote(''); setRejectMode(false); } }, [open]);

    const pfa = ticket?.pendingFinancialAction;

    const handleInitiate = async () => {
        setLoading(true);
        try {
            await api.support.tickets.forceCredit(ticket.id, {});
            toast({ title: 'Régularisation initiée', description: 'En attente d\'approbation par un second administrateur.' });
            onDone(); onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    const handleApprove = async () => {
        setLoading(true);
        try {
            await api.support.tickets.forceCredit(ticket.id, { actionId: pfa.id, decision: 'approve' });
            toast({ title: 'Crédit approuvé ✓', description: `Écriture comptable générée.` });
            onDone(); onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    const handleReject = async () => {
        if (!rejectNote.trim()) return;
        setLoading(true);
        try {
            await api.support.tickets.forceCredit(ticket.id, { actionId: pfa.id, decision: 'reject', note: rejectNote });
            toast({ title: 'Régularisation rejetée' });
            onDone(); onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                {!pfa ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Zap className="w-5 h-5 text-emerald-400" /> Forcer Crédit — Initiation
                            </DialogTitle>
                            <DialogDescription className="text-slate-400">
                                La vérification Mobile Money a confirmé l'anomalie. Initier la régularisation
                                nécessite l'approbation d'un second administrateur (principe maker-checker).
                            </DialogDescription>
                        </DialogHeader>
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-400">
                            Le montant sera celui confirmé par l'opérateur lors de la vérification.
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={onClose} className="border-slate-600">Annuler</Button>
                            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleInitiate} disabled={loading}>
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Initier la régularisation
                            </Button>
                        </DialogFooter>
                    </>
                ) : rejectMode ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Motif de rejet</DialogTitle>
                        </DialogHeader>
                        <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                            placeholder="Pourquoi rejetez-vous cette régularisation ?"
                            className="bg-slate-800 border-slate-700" />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setRejectMode(false)} className="border-slate-600">Retour</Button>
                            <Button variant="destructive" disabled={!rejectNote.trim() || loading} onClick={handleReject}>
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Confirmer le rejet
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-emerald-400" /> Approuver la Régularisation
                            </DialogTitle>
                            <DialogDescription className="text-slate-400">
                                Régularisation de <strong className="text-white">{pfa.amount} {pfa.currency}</strong> initiée
                                par <strong className="text-white">{pfa.initiatedBy}</strong>.
                                Votre approbation exécutera le crédit immédiatement.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setRejectMode(true)} className="border-red-500/40 text-red-400">Rejeter</Button>
                            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleApprove} disabled={loading}>
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Approuver et créditer
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};


// ── TicketDetail ───────────────────────────────────────────────────────────────

const TicketDetail = ({ ticket, client, onAction, onClose, currentUserSub, refreshKey, toast, isStaff }) => {
    const [reply, setReply] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [messages, setMessages] = useState([]);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [sending, setSending] = useState(false);
    const [escalateOpen, setEscalateOpen] = useState(false);
    const [resolveOpen, setResolveOpen] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [forceCreditOpen, setForceCreditOpen] = useState(false);
    const [verifyMmOpen, setVerifyMmOpen] = useState(false);
    const [awaitClientOpen, setAwaitClientOpen] = useState(false);
    const [client360, setClient360] = useState(null);
    const [revealedContact, setRevealedContact] = useState(null);
    const actions = ticket.availableActions || [];
    const isClosed = ['resolu', 'rejete'].includes(ticket.status);

    const loadMessages = () => {
        setLoadingMessages(true);
        api.support.tickets.messages(ticket.id)
            .then(setMessages).catch(() => setMessages([]))
            .finally(() => setLoadingMessages(false));
    };
    useEffect(() => { loadMessages(); }, [ticket.id, refreshKey]);
    useEffect(() => {
        setClient360(null);
        setRevealedContact(null);
        if (isStaff) {
            api.support.tickets.client360(ticket.id).then(setClient360).catch(() => {});
        }
    }, [ticket.id]);

    const handleRevealContact = async () => {
        try {
            const data = await api.support.tickets.revealContact(ticket.id);
            setRevealedContact(data);
            toast({ title: 'Coordonnées révélées', description: 'Accès tracé dans le journal d\'audit.' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Accès refusé', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleSend = async () => {
        if (!reply.trim()) return;
        setSending(true);
        try {
            await api.support.tickets.sendMessage(ticket.id, reply, isInternal);
            setReply(''); loadMessages();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setSending(false); }
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700 w-full lg:w-[450px] fixed right-0 top-0 bottom-0 z-50 shadow-2xl lg:relative lg:shadow-none">
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="font-mono text-xs text-slate-400 border-slate-600">
                            {ticket.publicId || `#${ticket.id}`}
                        </Badge>
                        <PriorityBadge priority={ticket.priority} />
                        <Badge variant="outline" className="text-xs border-slate-700 text-slate-500">{ticket.level}</Badge>
                    </div>
                    <h3 className="font-bold text-white">{ticket.subject}</h3>
                    {ticket.assignedTeam && (
                        <p className="text-xs text-slate-500 mt-0.5">→ {ticket.assignedTeam}</p>
                    )}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
            </div>

            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                {/* MM anomaly banner */}
                {ticket.hasMmAnomaly && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Anomalie Mobile Money confirmée chez l'opérateur — crédit absent en base.
                    </div>
                )}
                {/* Pending financial action banner */}
                {ticket.pendingFinancialAction && (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                        <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                        Régularisation de {ticket.pendingFinancialAction.amount} {ticket.pendingFinancialAction.currency} en attente d'approbation.
                    </div>
                )}

                {/* En attente client — banner */}
                {ticket.awaitingSince && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        En attente de réponse client depuis {new Date(ticket.awaitingSince).toLocaleString()}
                    </div>
                )}

                {/* Client 360° */}
                <ClientCRMCard client={client} data360={client360} isStaff={isStaff}
                    onReveal={handleRevealContact} revealedContact={revealedContact} />

                {/* Description */}
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Description</h4>
                    <p className="text-sm text-slate-200 leading-relaxed">{ticket.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2 items-center text-xs text-slate-400">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(ticket.createdAt).toLocaleString()}</span>
                        {ticket.assignee && (
                            <span className="flex items-center gap-1">
                                <User className="w-3 h-3" /> {ticket.assignee.displayName}
                                {ticket.assignee.sub === currentUserSub && (
                                    <Badge className="ml-1 bg-emerald-500/20 text-emerald-400 border-0 text-[10px] py-0 px-1">vous</Badge>
                                )}
                            </span>
                        )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <SlaBadge ticket={ticket} />
                    </div>
                </div>

                {/* Actions pilotées par availableActions */}
                {actions.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                        {/* MM — vérifier */}
                        {actions.includes('verify_mobile_money') && (
                            <Button size="sm" variant="outline" className="text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10 col-span-2"
                                onClick={() => setVerifyMmOpen(true)}>
                                <Smartphone className="w-3 h-3 mr-1" /> Vérifier API Mobile Money
                            </Button>
                        )}
                        {/* MM — forcer crédit */}
                        {actions.includes('force_credit') && (
                            <Button size="sm" variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 col-span-2"
                                onClick={() => setForceCreditOpen(true)}>
                                <Zap className="w-3 h-3 mr-1" />
                                {ticket.pendingFinancialAction ? 'Approuver la régularisation' : 'Forcer Crédit'}
                            </Button>
                        )}
                        {/* Claim */}
                        {actions.includes('claim') && (
                            <Button size="sm" variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => onAction('assign_me')}>
                                <User className="w-3 h-3 mr-1" /> M'assigner
                            </Button>
                        )}
                        {/* En attente client */}
                        {actions.includes('await_client') && (
                            <Button size="sm" variant="outline" className="text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                onClick={() => setAwaitClientOpen(true)}>
                                <Clock className="w-3 h-3 mr-1" /> En attente client
                            </Button>
                        )}
                        {/* Escalader */}
                        {actions.includes('escalate') && (
                            <Button size="sm" variant="outline" className="text-xs border-slate-600"
                                onClick={() => setEscalateOpen(true)}>
                                ↑ Escalader
                            </Button>
                        )}
                        {/* Clôturer */}
                        {actions.includes('close') && (
                            <Button size="sm" variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => setResolveOpen(true)}>
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Clôturer
                            </Button>
                        )}
                        {/* Rejeter */}
                        {actions.includes('reject') && (
                            <Button size="sm" variant="outline" className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 col-span-2"
                                onClick={() => setRejectOpen(true)}>
                                <XCircle className="w-3 h-3 mr-1" /> Rejeter
                            </Button>
                        )}
                        {/* Réouvrir */}
                        {actions.includes('reopen') && (
                            <Button size="sm" variant="outline" className="text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10 col-span-2"
                                onClick={() => onAction('reopen')}>
                                <RotateCcw className="w-3 h-3 mr-1" /> Réouvrir le ticket
                            </Button>
                        )}
                    </div>
                )}

                {/* Dialogs */}
                <VerifyMmDialog open={verifyMmOpen} description={ticket.description}
                    onClose={() => setVerifyMmOpen(false)}
                    onConfirm={async (transactionRef) => { setVerifyMmOpen(false); await onAction('verify_mm', { transactionRef }); }} />
                <AwaitClientDialog open={awaitClientOpen} onClose={() => setAwaitClientOpen(false)}
                    onConfirm={async (question) => { setAwaitClientOpen(false); await onAction('await_client', { question }); }} />
                <EscalateDialog open={escalateOpen} onClose={() => setEscalateOpen(false)}
                    onConfirm={async (reason) => { setEscalateOpen(false); await onAction('escalate', { reason }); }} />
                <ResolveDialog open={resolveOpen} onClose={() => setResolveOpen(false)}
                    onConfirm={async (summary) => { setResolveOpen(false); await onAction('resolve', { summary }); }} />
                <RejectDialog open={rejectOpen} onClose={() => setRejectOpen(false)}
                    onConfirm={async (params) => { setRejectOpen(false); await onAction('reject', params); }} />
                <ForceCreditDialog open={forceCreditOpen} ticket={ticket}
                    onClose={() => setForceCreditOpen(false)}
                    onDone={() => onAction('_refresh')}
                    toast={toast} />

                {/* Messages */}
                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase">Fil de discussion</h4>
                    {loadingMessages && <p className="text-xs text-slate-500 italic text-center py-2">Chargement...</p>}
                    {!loadingMessages && messages.map(msg => (
                        <div key={msg.id} className={`p-3 rounded-lg text-sm ${
                            msg.isInternal
                                ? 'bg-amber-900/20 border border-amber-900/30 ml-4'
                                : msg.authorSub === 'system'
                                    ? 'bg-slate-800/40 border border-slate-700/50 italic'
                                    : 'bg-slate-800 border border-slate-700'
                        }`}>
                            <div className="flex justify-between mb-1">
                                <span className={`font-semibold text-xs ${msg.isInternal ? 'text-amber-400' : msg.authorSub === 'system' ? 'text-slate-500' : 'text-blue-400'}`}>
                                    {msg.authorName || (msg.authorSub === 'system' ? 'Système' : msg.authorSub)}
                                    {msg.isInternal ? ' · note interne' : ''}
                                </span>
                                <span className="text-[10px] text-slate-500">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-slate-300">{msg.text}</p>
                        </div>
                    ))}
                    {!loadingMessages && messages.length === 0 && (
                        <p className="text-xs text-slate-500 italic text-center py-2">Aucun message</p>
                    )}
                </div>
            </div>

            {/* Input */}
            {!isClosed && (
                <div className="p-3 bg-slate-900 border-t border-slate-700">
                    <Textarea placeholder="Ajouter une note interne ou répondre..."
                        className="min-h-[80px] bg-slate-800 border-slate-700 mb-2 text-sm"
                        value={reply} onChange={e => setReply(e.target.value)} />
                    <div className="flex justify-between items-center">
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                            <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="accent-amber-500" />
                            Note interne (invisible au client)
                        </label>
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={sending} onClick={handleSend}>
                            {sending ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Send className="w-3 h-3 mr-2" />}
                            Envoyer
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};


// ── Création ticket ────────────────────────────────────────────────────────────

const CreateTicketModal = ({ isOpen, onClose, onSubmit }) => {
    const [formData, setFormData] = useState({ category: 'mobile-money', priority: 'normal', subject: '', description: '' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        if (!formData.description) return;
        setLoading(true);
        await onSubmit(formData);
        setLoading(false);
        setFormData({ category: 'mobile-money', priority: 'normal', subject: '', description: '' });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Nouvelle réclamation</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Décrivez votre problème précisément. Incluez les références de transaction si applicable
                        — la priorité est ajustée automatiquement selon le montant.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                            <Label>Catégorie</Label>
                            <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(TICKET_CATEGORIES).map(([key, val]) => (
                                        <SelectItem key={key} value={key}>{val.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Priorité suggérée</Label>
                            <Select value={formData.priority} onValueChange={v => setFormData({ ...formData, priority: v })}>
                                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(PRIORITIES).map(([key, val]) => (
                                        <SelectItem key={key} value={key}>{val.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label>Sujet / Objet</Label>
                        <Input value={formData.subject} onChange={e => setFormData({ ...formData, subject: e.target.value })}
                            placeholder="Ex: Dépôt non reçu" className="bg-slate-800 border-slate-700" />
                    </div>
                    <div className="grid gap-1.5">
                        <Label>Description détaillée</Label>
                        <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Inclure ID transaction (ex: AG-889900), date, montant en FC/USD..."
                            className="bg-slate-800 border-slate-700 min-h-[100px]" />
                    </div>
                    <p className="text-xs text-slate-500">
                        La priorité peut être rehaussée automatiquement si le montant ou les mots-clés l'indiquent.
                    </p>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} className="text-slate-400">Annuler</Button>
                    <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700" disabled={loading || !formData.description}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Soumettre
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// ── Page principale ────────────────────────────────────────────────────────────

const Support = () => {
    const { user } = useAuth();
    const { toast } = useToast();

    const [tickets, setTickets] = useState([]);
    const [stats, setStats] = useState(null);
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [viewMode, setViewMode] = useState('agent');
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [kycProfiles, setKycProfiles] = useState([]);
    const [messagesRefreshKey, setMessagesRefreshKey] = useState(0);

    const isStaff = user && menuKeyFor(user) !== 'client' && menuKeyFor(user) !== 'investor';

    const loadTickets = () =>
        api.support.tickets.list().then(rows => setTickets(rows.map(t => ({ ...t, created: t.createdAt, subCategory: t.subject })))).catch(() => {});
    const loadStats = () =>
        api.support.tickets.stats().then(setStats).catch(() => {});

    useEffect(() => { loadTickets(); loadStats(); }, []);
    useEffect(() => { api.compliance.kycProfiles().then(setKycProfiles).catch(() => {}); }, []);

    const selectedTicket = useMemo(() => tickets.find(t => t.id === selectedTicketId), [tickets, selectedTicketId]);
    const uniqueClients = useMemo(() => {
        const bySub = new Map();
        tickets.forEach(t => {
            if (!t.clientSub || bySub.has(t.clientSub)) return;
            const kyc = kycProfiles.find(k => k.userSub === t.clientSub);
            bySub.set(t.clientSub, { name: t.clientName, sub: t.clientSub, kycStatus: kyc?.kycStatus, kycLevel: kyc?.kycLevel });
        });
        return Array.from(bySub.values());
    }, [tickets, kycProfiles]);
    const selectedClient = useMemo(() => {
        if (!selectedTicket) return null;
        return uniqueClients.find(c => c.sub === selectedTicket.clientSub) || { name: selectedTicket.clientName, sub: selectedTicket.clientSub };
    }, [selectedTicket, uniqueClients]);

    useEffect(() => { setViewMode(isStaff ? 'agent' : 'client'); }, [user]);

    const handleTicketAction = async (action, extra = {}) => {
        if (!selectedTicket && action !== '_refresh') return;
        const id = selectedTicket?.id;
        try {
            switch (action) {
                case 'verify_mm': {
                    const verif = await api.support.tickets.verifyMm(id, extra.transactionRef);
                    const verdicts = {
                        found_operator_side: { title: 'Anomalie confirmée ✓', desc: `Transaction ${verif.transactionRef} trouvée chez ${verif.operator} mais absente en base.` },
                        not_found: { title: 'Transaction introuvable', desc: `Aucune transaction ${verif.transactionRef} chez ${verif.operator}.` },
                        already_credited: { title: 'Déjà créditée', desc: `Transaction ${verif.transactionRef} déjà créditée. Solde client correct.` },
                        failed: { title: 'API indisponible', desc: `L'API ${verif.operator} ne répond pas.` },
                    };
                    const v = verdicts[verif.status] || { title: 'Vérification effectuée', desc: verif.status };
                    toast({ title: v.title, description: v.desc });
                    break;
                }
                case 'recalc_schedule':
                    await api.support.tickets.sendMessage(id, "Recalcul de l'échéancier lancé. Différentiel de change identifié et corrigé. (simulation)", true);
                    toast({ title: "Échéancier mis à jour" });
                    break;
                case 'correct_allocation':
                    await api.support.tickets.sendMessage(id, "Correction d'affectation lancée sur ce dossier crédit. (simulation)", true);
                    toast({ title: "Affectation corrigée" });
                    break;
                case 'escalate':
                    await api.support.tickets.escalate(id, extra.reason || '');
                    toast({ title: "Ticket escaladé" });
                    break;
                case 'resolve':
                    await api.support.tickets.resolve(id, extra.summary || '');
                    toast({ title: "Ticket clôturé ✓" });
                    break;
                case 'reject':
                    await api.support.tickets.reject(id, {
                        rejectType: extra.rejectType || 'hors_perimetre',
                        reason: extra.reason || '',
                        originalTicketId: extra.originalTicketId,
                    });
                    toast({ title: "Ticket rejeté" });
                    break;
                case 'reopen':
                    await api.support.tickets.reopen(id);
                    toast({ title: "Ticket réouvert" });
                    break;
                case 'waiting_on':
                    await api.support.tickets.setWaitingOn(id, extra.value);
                    toast({ title: extra.value === 'client' ? "En attente client" : "En attente agent" });
                    break;
                case 'assign_me':
                    await api.support.tickets.claim(id);
                    toast({ title: "Ticket assigné à vous ✓" });
                    break;
                case 'await_client':
                    await api.support.tickets.awaitClient(id, extra.question);
                    toast({ title: "En attente client", description: "SLA mis en pause. Relances à J+2 et J+5." });
                    break;
                case '_refresh':
                    break;
                default:
                    return;
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
            return;
        }
        loadTickets();
        loadStats();
        setMessagesRefreshKey(k => k + 1);
    };

    const handleCreateTicket = async (data) => {
        try {
            const t = await api.support.tickets.create({
                category: data.category, priority: data.priority || 'normal',
                subject: data.subject || 'Réclamation', description: data.description,
            });
            setCreateModalOpen(false);
            loadTickets(); loadStats();
            const autoPrio = t.priority !== data.priority;
            toast({
                title: "Ticket créé ✓",
                description: autoPrio
                    ? `Priorité ajustée automatiquement à « ${PRIORITIES[t.priority]?.label || t.priority} » selon le contenu.`
                    : `Réf : ${t.publicId}`,
            });
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
                toast({ variant: 'destructive', title: 'Doublon détecté', description: e.message });
            } else {
                toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
            }
        }
    };

    // ── Vue agent ──────────────────────────────────────────────────────────────

    const AgentView = () => (
        <div className="flex h-[calc(100vh-140px)]">
            <div className={`flex-1 overflow-hidden transition-all duration-300 ${selectedTicketId ? 'lg:mr-[450px]' : ''}`}>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
                    <div className="flex justify-between items-center mb-4">
                        <TabsList className="bg-slate-800 border border-slate-700">
                            <TabsTrigger value="dashboard"><BarChart3 className="w-4 h-4 mr-2" /> Tableau de bord</TabsTrigger>
                            <TabsTrigger value="tickets">
                                <MessageSquare className="w-4 h-4 mr-2" />
                                Tickets {stats ? `(${stats.open} ouverts)` : ''}
                            </TabsTrigger>
                            <TabsTrigger value="clients"><UserCog className="w-4 h-4 mr-2" /> CRM Clients</TabsTrigger>
                        </TabsList>
                        {activeTab === 'tickets' && (
                            <div className="flex gap-2">
                                <Select value={filterStatus} onValueChange={setFilterStatus}>
                                    <SelectTrigger className="w-[150px] h-9 bg-slate-800 border-slate-700"><SelectValue placeholder="Statut" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Tous</SelectItem>
                                        {Object.entries(STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setCreateModalOpen(true)}>
                                    <ArrowUpRight className="w-4 h-4 mr-2" /> Créer Ticket
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Dashboard */}
                    <TabsContent value="dashboard" className="flex-1 overflow-y-auto">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            {[
                                { label: 'Tickets ouverts', value: stats?.open ?? '…', color: 'text-blue-400', icon: MessageSquare },
                                { label: 'Escaladés (L2/L3)', value: stats?.escalated ?? '…', color: 'text-orange-400', icon: TrendingUp },
                                { label: 'Résolus (24 h)', value: stats?.resolved24h ?? '…', color: 'text-emerald-400', icon: CheckCircle },
                                { label: 'Satisfaction moy.', value: stats?.avgSatisfaction ? `${stats.avgSatisfaction}/5` : '—', color: 'text-amber-400', icon: Star },
                            ].map(kpi => (
                                <Card key={kpi.label} className="bg-slate-800/50 border-slate-700">
                                    <CardHeader className="pb-1 pt-3 px-4">
                                        <CardTitle className="text-xs text-slate-400 flex items-center gap-1.5">
                                            <kpi.icon className="w-3.5 h-3.5" /> {kpi.label}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-4 pb-3">
                                        <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>

                        {/* Hors SLA */}
                        {stats?.outOfSla > 0 && (
                            <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
                                <AlertOctagon className="w-4 h-4 shrink-0" />
                                <strong>{stats.outOfSla}</strong> ticket(s) en dépassement SLA — action requise.
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card className="bg-slate-900 border-slate-800">
                                <CardHeader><CardTitle className="text-white text-sm">Tickets urgents & critiques</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {tickets.filter(t => ['urgent', 'critique'].includes(t.priority) && t.status !== 'resolu').map(t => (
                                            <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-red-500/50 cursor-pointer"
                                                onClick={() => { setActiveTab('tickets'); setSelectedTicketId(t.id); }}>
                                                <div className="flex items-center gap-2">
                                                    <PriorityBadge priority={t.priority} />
                                                    <div>
                                                        <p className="text-sm font-medium text-white">{t.subject}</p>
                                                        <p className="text-xs text-slate-400">{t.clientName} · {new Date(t.createdAt).toLocaleDateString()}</p>
                                                    </div>
                                                </div>
                                                <StatusBadge status={t.status} />
                                            </div>
                                        ))}
                                        {tickets.filter(t => ['urgent', 'critique'].includes(t.priority) && t.status !== 'resolu').length === 0 && (
                                            <p className="text-sm text-slate-500 text-center py-4">Aucun ticket urgent</p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="bg-slate-900 border-slate-800">
                                <CardHeader><CardTitle className="text-white text-sm">Par catégorie (ouverts)</CardTitle></CardHeader>
                                <CardContent>
                                    {stats?.byCategory ? (
                                        <div className="space-y-2">
                                            {Object.entries(stats.byCategory).map(([cat, count]) => {
                                                const meta = TICKET_CATEGORIES[cat];
                                                const total = Object.values(stats.byCategory).reduce((a, b) => a + b, 0) || 1;
                                                return (
                                                    <div key={cat} className="flex items-center gap-2">
                                                        <span className={`text-xs w-28 shrink-0 ${meta?.color || 'text-slate-400'}`}>{meta?.label || cat}</span>
                                                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                                                            <div className="h-full bg-emerald-600/70 rounded-full transition-all"
                                                                style={{ width: `${(count / total) * 100}%` }} />
                                                        </div>
                                                        <span className="text-xs text-slate-400 w-4 text-right">{count}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-500 text-center py-4">Chargement…</p>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* Tickets list */}
                    <TabsContent value="tickets" className="flex-1 overflow-hidden flex flex-col">
                        <div className="mb-4 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input placeholder="Rechercher par ID, client, sujet ou description..."
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                className="pl-10 bg-slate-900 border-slate-700" />
                        </div>
                        <div className="flex-1 rounded-md border border-slate-800 overflow-auto bg-slate-900/50">
                            <Table>
                                <TableHeader className="bg-slate-900 sticky top-0 z-10">
                                    <TableRow className="border-slate-800 hover:bg-slate-900">
                                        <TableHead className="w-[110px]">Réf</TableHead>
                                        <TableHead>Client</TableHead>
                                        <TableHead>Sujet</TableHead>
                                        <TableHead>Catégorie</TableHead>
                                        <TableHead>Priorité</TableHead>
                                        <TableHead>Statut</TableHead>
                                        <TableHead>Assigné</TableHead>
                                        <TableHead className="text-right w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tickets
                                        .filter(t => filterStatus === 'all' || t.status === filterStatus)
                                        .filter(t => {
                                            const q = searchTerm.toLowerCase();
                                            return !q || (
                                                (t.clientName || '').toLowerCase().includes(q) ||
                                                String(t.id).includes(q) ||
                                                (t.publicId || '').toLowerCase().includes(q) ||
                                                (t.subject || '').toLowerCase().includes(q) ||
                                                (t.description || '').toLowerCase().includes(q)
                                            );
                                        })
                                        .map(ticket => (
                                            <TableRow key={ticket.id}
                                                className={`border-slate-800 cursor-pointer ${selectedTicketId === ticket.id ? 'bg-emerald-500/10 border-l-2 border-l-emerald-500' : 'hover:bg-slate-800/50'}`}
                                                onClick={() => setSelectedTicketId(ticket.id)}>
                                                <TableCell className="font-mono text-xs text-slate-400">
                                                    {ticket.publicId || `#${ticket.id}`}
                                                    {ticket.hasMmAnomaly && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-400" title="Anomalie MM" />}
                                                </TableCell>
                                                <TableCell className="font-medium text-white">{ticket.clientName}</TableCell>
                                                <TableCell className="max-w-[180px] truncate text-slate-300" title={ticket.subject}>{ticket.subject}</TableCell>
                                                <TableCell>
                                                    {TICKET_CATEGORIES[ticket.category] ? (
                                                        <Badge variant="outline" className={`${TICKET_CATEGORIES[ticket.category].color} border-slate-700 bg-slate-900`}>
                                                            {TICKET_CATEGORIES[ticket.category].label}
                                                        </Badge>
                                                    ) : ticket.category}
                                                </TableCell>
                                                <TableCell><PriorityBadge priority={ticket.priority} /></TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <StatusBadge status={ticket.status} />
                                                        <SlaBadge ticket={ticket} />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-400">{ticket.assignee?.displayName || (ticket.assignedTo ? ticket.assignedTo.substring(0, 8) + '…' : '—')}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400"><Eye className="w-4 h-4" /></Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    {/* CRM */}
                    <TabsContent value="clients" className="flex-1 overflow-y-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {uniqueClients.length === 0 && (
                                <p className="text-sm text-slate-500 col-span-full text-center py-8">Aucun client avec un ticket.</p>
                            )}
                            {uniqueClients.map(client => <ClientCRMCard key={client.sub} client={client} />)}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            <AnimatePresence>
                {selectedTicket && (
                    <motion.div
                        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed right-0 top-16 bottom-0 z-40">
                        <TicketDetail
                            ticket={selectedTicket} client={selectedClient}
                            onAction={handleTicketAction}
                            onClose={() => setSelectedTicketId(null)}
                            currentUserSub={user?.sub}
                            refreshKey={messagesRefreshKey}
                            toast={toast}
                            isStaff={isStaff}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );

    // ── Vue client ─────────────────────────────────────────────────────────────

    const ClientPortalView = () => (
        <div className="max-w-4xl mx-auto space-y-8">
            <Card className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border-emerald-500/30">
                <CardHeader>
                    <CardTitle className="text-2xl text-white">Bonjour, {user?.name || 'Client'}</CardTitle>
                    <CardDescription>Bienvenue sur votre centre de support. Nous sommes là pour vous aider 24/7.</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-4">
                    <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setCreateModalOpen(true)}>
                        <MessageSquare className="w-5 h-5 mr-2" /> Ouvrir une réclamation
                    </Button>
                    <Button size="lg" variant="outline" className="border-slate-600 hover:bg-slate-800">
                        <Phone className="w-5 h-5 mr-2" /> Contacter par WhatsApp
                    </Button>
                </CardContent>
            </Card>

            <div className="space-y-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-400" /> Vos tickets récents
                </h3>
                {tickets.length === 0 ? (
                    <div className="text-center p-8 bg-slate-900/50 rounded-xl border border-slate-800 text-slate-500">
                        Aucun ticket trouvé.
                    </div>
                ) : tickets.map(ticket => (
                    <div key={ticket.id} className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl hover:bg-slate-900 transition-colors">
                        <div className="flex justify-between items-center">
                            <div className="flex gap-3 items-center">
                                <div className="p-2.5 rounded-full bg-slate-800">
                                    {TICKET_CATEGORIES[ticket.category]?.icon
                                        ? React.createElement(TICKET_CATEGORIES[ticket.category].icon, { className: "w-5 h-5 text-slate-400" })
                                        : <AlertCircle className="w-5 h-5" />}
                                </div>
                                <div>
                                    <h4 className="font-bold text-white">{ticket.subject}</h4>
                                    <p className="text-sm text-slate-400">
                                        {ticket.publicId || `#${ticket.id}`} · {new Date(ticket.createdAt).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <StatusBadge status={ticket.status} />
                                <Button variant="ghost" size="sm" onClick={() => { setSelectedTicketId(ticket.id); setViewMode('agent'); }}>
                                    Voir détails
                                </Button>
                            </div>
                        </div>
                        {ticket.status === 'resolu' && (
                            <div className="mt-3 pt-3 border-t border-slate-800">
                                <RatingWidget ticket={ticket} onRated={loadTickets} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <Layout>
            <Helmet><title>Centre de Support - AGRICAP</title></Helmet>
            <CreateTicketModal isOpen={isCreateModalOpen} onClose={() => setCreateModalOpen(false)} onSubmit={handleCreateTicket} />
            {viewMode === 'client' ? <ClientPortalView /> : <AgentView />}
        </Layout>
    );
};

export default Support;
