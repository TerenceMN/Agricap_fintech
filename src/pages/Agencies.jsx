import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { motion } from 'framer-motion';
import {
    Store, Plus, Search, MapPin, Building2, AlertTriangle,
    MoreHorizontal, RefreshCcw, Download, History, Lock, ShieldCheck, ArrowLeftRight, Eye, ClipboardCheck,
    Clock, CheckCircle2, XCircle, Send, UserCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { exportToExcel } from '@/lib/export.js';
import { api, ApiError } from '@/services/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const AGENCY_TYPES = [
    { value: 'SIEGE', label: 'Siège' },
    { value: 'RURALE', label: 'Rurale' },
    { value: 'URBAINE', label: 'Urbaine' },
    { value: 'POINT_SERVICE', label: 'Point de service' },
];

const STATUS_LABELS = { ACTIF: 'Actif', SUSPENDU: 'Suspendu', FERMEE: 'Fermée' };

const ACTION_TYPE_META = {
    SUSPEND:           { label: 'Suspension',              color: 'text-amber-400 border-amber-500/30 bg-amber-500/10',   needsDoc: false },
    CLOSE:             { label: 'Fermeture',               color: 'text-red-400 border-red-500/30 bg-red-500/10',         needsDoc: false },
    UNLOCK_TEMPORARY:  { label: 'Déverrouillage temp.',    color: 'text-blue-400 border-blue-500/30 bg-blue-500/10',      needsDoc: true  },
    REOPEN:            { label: 'Réouverture',             color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', needsDoc: true },
};

const REQ_STATUS_META = {
    PENDING_APPROVAL: { label: 'En attente',  color: 'text-amber-400 border-amber-500/30 bg-amber-500/10'  },
    EXECUTED:         { label: 'Approuvé',    color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
    REJECTED:         { label: 'Rejeté',      color: 'text-red-400 border-red-500/30 bg-red-500/10'        },
};

const StatusBadge = ({ status }) => {
    const styles = {
        ACTIF: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        SUSPENDU: 'bg-red-500/20 text-red-400 border-red-500/30',
        FERMEE: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    };
    return <Badge variant="outline" className={styles[status] || 'bg-slate-700 text-slate-300'}>{STATUS_LABELS[status] || status}</Badge>;
};

const EMPTY_FORM = { code: '', name: '', type: 'URBAINE', city: '', province: '', manager: '' };

const AgencyFormModal = ({ isOpen, onClose, agency, onSave }) => {
    const [form, setForm] = useState(EMPTY_FORM);
    useEffect(() => {
        setForm(agency
            ? { code: agency.code, name: agency.name, type: agency.type, city: agency.city, province: agency.province, manager: agency.manager }
            : EMPTY_FORM);
    }, [agency, isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>{agency ? "Modifier l'agence" : 'Nouvelle Agence'}</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        {agency ? `Mise à jour de ${agency.code}` : "Crée un nouveau point d'agence dans le réseau."}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    {!agency && (
                        <div>
                            <Label>Code agence</Label>
                            <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="AG-KIN-01" />
                        </div>
                    )}
                    <div>
                        <Label>Nom</Label>
                        <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Agence Kinshasa Centre" />
                    </div>
                    {!agency && (
                        <div>
                            <Label>Type</Label>
                            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {AGENCY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Ville</Label>
                            <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Province</Label>
                            <Input value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} />
                        </div>
                    </div>
                    <div>
                        <Label>Responsable (identifiant)</Label>
                        <Input value={form.manager} onChange={e => setForm(f => ({ ...f, manager: e.target.value }))} placeholder="sub de l'utilisateur responsable" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onSave(form)}>
                        {agency ? 'Enregistrer' : 'Créer'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ReasonDialog = ({ open, title, description, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    useEffect(() => { if (open) setReason(''); }, [open]);
    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-slate-400">{description}</DialogDescription>
                </DialogHeader>
                <div className="py-2">
                    <Label>Motif</Label>
                    <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Raison de cette action..." />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button variant="destructive" onClick={() => onConfirm(reason)}>Confirmer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ReactivationDialog = ({ open, title, description, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const [document, setDocument] = useState(null);
    useEffect(() => { if (open) { setReason(''); setDocument(null); } }, [open]);

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-slate-400">{description}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div>
                        <Label>Justification écrite</Label>
                        <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Raison de la réactivation..." />
                    </div>
                    <div>
                        <Label>Document justificatif</Label>
                        <Input type="file" onChange={e => setDocument(e.target.files?.[0] || null)} />
                        <p className="text-xs text-slate-500 mt-1">Requis : preuve à l'appui (ex. levée de sanction, approbation, rapport de contrôle).</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button
                        className="bg-emerald-600 hover:bg-emerald-700"
                        disabled={!reason.trim() || !document}
                        onClick={() => onConfirm(reason, document)}
                    >
                        Confirmer la réactivation
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// Maker-Checker — étape 1 : le maker soumet une demande d'action sensible.
// L'action n'est PAS exécutée immédiatement : elle crée un AgencyActionRequest "pending"
// qu'un checker devra approuver (avec code OTP par SMS) avant que rien ne se passe.
const MakerRequestDialog = ({ agency, actionType, pendingRequest, onClose, onSubmitted, toast }) => {
    const [reason, setReason] = useState('');
    const [document, setDocument] = useState(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => { if (agency) { setReason(''); setDocument(null); } }, [agency]);

    const meta = ACTION_TYPE_META[actionType] || {};
    const needsDoc = meta.needsDoc;

    const handleSubmit = async () => {
        if (!reason.trim()) return;
        setLoading(true);
        try {
            await api.agencies.actionRequests.create(agency.code, actionType, reason, document || undefined);
            toast({ title: 'Demande soumise', description: `La demande de ${meta.label?.toLowerCase()} pour ${agency.code} est en attente d'un second approbateur.` });
            onSubmitted();
            onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    const handleCancelAndResend = async () => {
        if (!pendingRequest) return;
        setLoading(true);
        try {
            await api.agencies.actionRequests.cancel(pendingRequest.id);
            toast({ title: 'Demande précédente annulée', description: 'Vous pouvez maintenant soumettre une nouvelle demande.' });
            onSubmitted();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={!!agency} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Send className="w-5 h-5 text-amber-400" />
                        Soumettre une demande — {meta.label}
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Cette action <strong className="text-white">ne s'exécutera pas immédiatement</strong>.
                        Un second agent (checker) devra l'approuver avec un code SMS avant qu'elle prenne effet sur {agency?.code}.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    {pendingRequest && (
                        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-amber-300 font-medium">Une demande est déjà en attente</p>
                                <p className="text-xs text-amber-400/70 mt-0.5">
                                    Demande #{pendingRequest.id} soumise le {new Date(pendingRequest.createdAt).toLocaleDateString()}.
                                    Annulez-la pour en soumettre une nouvelle.
                                </p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleCancelAndResend}
                                disabled={loading}
                                className="shrink-0 border-amber-500/50 text-amber-400 hover:bg-amber-500/10 text-xs h-7"
                            >
                                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCcw className="w-3 h-3 mr-1" />}
                                Annuler et renvoyer
                            </Button>
                        </div>
                    )}
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-800 border border-slate-700">
                        <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-white">{agency?.name}</p>
                            <p className="text-xs text-slate-400">{agency?.code} · {agency?.city}</p>
                        </div>
                        <Badge variant="outline" className={`ml-auto text-xs ${meta.color}`}>{meta.label}</Badge>
                    </div>
                    <div>
                        <Label>Motif de la demande <span className="text-red-400">*</span></Label>
                        <Textarea
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Décrivez la raison qui justifie cette action..."
                            className="mt-1"
                            rows={3}
                        />
                    </div>
                    {needsDoc && (
                        <div>
                            <Label>Document justificatif {needsDoc && <span className="text-red-400">*</span>}</Label>
                            <Input type="file" className="mt-1" onChange={e => setDocument(e.target.files?.[0] || null)} />
                            <p className="text-xs text-slate-500 mt-1">
                                Requis pour cette action : rapport de contrôle, levée de sanction, approbation hiérarchique…
                            </p>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>Annuler</Button>
                    <Button
                        className="bg-amber-600 hover:bg-amber-700"
                        disabled={!reason.trim() || (needsDoc && !document) || loading}
                        onClick={handleSubmit}
                    >
                        {loading ? 'Envoi…' : 'Soumettre la demande'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// Maker-Checker — étape 2 : l'approbateur saisit le code OTP reçu par SMS à la soumission
// pour accuser réception, puis consulte les détails et approuve ou rejette.
const CheckerDialog = ({ request, onClose, onDone, toast }) => {
    const [challengeId, setChallengeId] = useState(null);
    const [otpCode, setOtpCode] = useState('');
    const [rejectNote, setRejectNote] = useState('');
    // 'otp' → saisie du code · 'review' → détails + actions · 'rejecting' → motif rejet
    const [panel, setPanel] = useState('otp');
    const [loading, setLoading] = useState(false);
    const [otpError, setOtpError] = useState('');

    useEffect(() => {
        if (request) {
            setChallengeId(null); setOtpCode(''); setRejectNote('');
            setPanel(request.status === 'PENDING_APPROVAL' ? 'otp' : 'review');
            setOtpError('');
        }
    }, [request]);

    if (!request) return null;
    const actionMeta = ACTION_TYPE_META[request.actionType] || { label: request.actionType, color: '' };
    const statusMeta = REQ_STATUS_META[request.status] || { label: request.status, color: '' };

    // Renvoyer un nouveau code OTP par SMS
    const handleRequestCode = async () => {
        setLoading(true);
        setOtpError('');
        try {
            const res = await api.agencies.actionRequests.requestCode(request.id);
            setChallengeId(res.challengeId);
            toast(res.smsSent
                ? { title: 'Nouveau code envoyé ✓', description: `Valable jusqu'à ${new Date(res.expiresAt).toLocaleTimeString()}.` }
                : { variant: 'destructive', title: 'SMS non envoyé', description: 'Code généré mais SMS échoué — consultez les logs serveur.' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    // Vérifier le code OTP = accusé de réception
    const handleVerifyOtp = async () => {
        if (otpCode.length !== 6) return;
        setLoading(true);
        setOtpError('');
        try {
            const res = await api.agencies.actionRequests.verifyCode(request.id, otpCode, challengeId || undefined);
            if (res.verified) {
                setChallengeId(res.challengeId);
                setPanel('review');
                toast({ title: 'Code vérifié ✓', description: 'Réception accusée. Vous pouvez maintenant traiter la demande.' });
            } else {
                setOtpError('Code incorrect. Vérifiez le SMS et réessayez.');
            }
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : String(e);
            if (msg.includes('expiré') || msg.includes('introuvable')) {
                setOtpError('Code expiré ou introuvable. Demandez un nouveau code.');
            } else {
                setOtpError(msg);
            }
        } finally { setLoading(false); }
    };

    const handleApprove = async () => {
        setLoading(true);
        try {
            const res = await api.agencies.actionRequests.approve(request.id, otpCode);
            console.log('[AGRICAP] Approuvé request=%s status=%s', request.id, res?.status);
            toast({ title: 'Demande approuvée ✓', description: `Action ${actionMeta.label?.toLowerCase()} sur ${request.agencyCode} exécutée.` });
            onDone(); onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Approbation refusée', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    const handleReject = async () => {
        if (!rejectNote.trim()) return;
        setLoading(true);
        try {
            await api.agencies.actionRequests.reject(request.id, rejectNote);
            toast({ title: 'Demande rejetée', description: `La demande sur ${request.agencyCode} a été refusée.` });
            onDone(); onClose();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally { setLoading(false); }
    };

    return (
        <Dialog open={!!request} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-emerald-400" />
                        {panel === 'otp' ? 'Accusé de réception — demande #' + request.id : 'Traiter la demande #' + request.id}
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        {panel === 'otp'
                            ? 'Un code OTP a été envoyé par SMS lors de la soumission. Saisissez-le pour accuser réception et consulter les détails.'
                            : 'En tant que checker, vous validez ou refusez cette demande d\'action sensible.'}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Panel OTP : accusé de réception ── */}
                {panel === 'otp' && (
                    <div className="space-y-4">
                        <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Agence</span>
                                <span className="text-sm font-medium">{request.agencyCode}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Action</span>
                                <Badge variant="outline" className={`text-xs ${actionMeta.color}`}>{actionMeta.label}</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Soumise par</span>
                                <span className="text-sm text-slate-300">{request.requestedBy}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-slate-300 flex items-center gap-2">
                                <Send className="w-3.5 h-3.5 text-emerald-400" />
                                Code OTP reçu par SMS
                            </Label>
                            <Input
                                value={otpCode}
                                onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                                onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                                placeholder="_ _ _ _ _ _"
                                className="text-center tracking-widest text-xl font-mono bg-slate-800 border-slate-600"
                                maxLength={6}
                                autoFocus
                            />
                            {otpError && (
                                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {otpError}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button variant="outline" className="border-slate-600 text-slate-400" onClick={handleRequestCode} disabled={loading}>
                                <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> {loading ? 'Envoi…' : 'Renvoyer le code'}
                            </Button>
                            <Button
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                disabled={otpCode.length !== 6 || loading}
                                onClick={handleVerifyOtp}
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                                Accuser réception
                            </Button>
                        </div>
                    </div>
                )}

                {/* ── Panel review : détails + actions ── */}
                {panel === 'review' && (
                    <div className="space-y-4">
                        {/* Badge accusé de réception */}
                        {request.status === 'PENDING_APPROVAL' && (
                            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                Réception accusée — vous pouvez approuver ou rejeter cette demande.
                            </div>
                        )}

                        <div className="space-y-2 rounded-lg bg-slate-800 border border-slate-700 p-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Agence</span>
                                <span className="text-sm font-medium">{request.agencyCode}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Action demandée</span>
                                <Badge variant="outline" className={`text-xs ${actionMeta.color}`}>{actionMeta.label}</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Demandeur</span>
                                <span className="text-sm text-slate-300">{request.requestedBy}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Date</span>
                                <span className="text-sm text-slate-300">{new Date(request.createdAt).toLocaleString()}</span>
                            </div>
                            {request.reason && (
                                <div className="border-t border-slate-700 pt-2 mt-1">
                                    <p className="text-xs text-slate-500 mb-1">Motif</p>
                                    <p className="text-sm text-slate-200 italic">« {request.reason} »</p>
                                </div>
                            )}
                            {request.hasDocument && (
                                <p className="text-xs text-emerald-400 flex items-center gap-1 pt-1">
                                    <CheckCircle2 className="w-3 h-3" /> Document justificatif joint
                                </p>
                            )}
                            <div className="flex items-center justify-between border-t border-slate-700 pt-2">
                                <span className="text-xs text-slate-500">Statut</span>
                                <Badge variant="outline" className={`text-xs ${statusMeta.color}`}>{statusMeta.label}</Badge>
                            </div>
                        </div>

                        {request.status === 'PENDING_APPROVAL' && (
                            <div className="flex gap-2">
                                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleApprove} disabled={loading}>
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                                    Approuver
                                </Button>
                                <Button variant="outline" className="flex-1 border-red-500/40 text-red-400 hover:bg-red-500/10"
                                    onClick={() => setPanel('rejecting')} disabled={loading}>
                                    <XCircle className="w-4 h-4 mr-2" /> Rejeter
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {panel === 'rejecting' && (
                    <div className="space-y-3 border border-red-500/30 rounded-lg p-4 bg-red-500/5">
                        <Label>Note de rejet <span className="text-red-400">*</span></Label>
                        <Textarea
                            value={rejectNote}
                            onChange={e => setRejectNote(e.target.value)}
                            placeholder="Expliquez pourquoi cette demande est refusée..."
                            rows={3}
                        />
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1 text-slate-400" onClick={() => setPanel('review')}>
                                ← Retour
                            </Button>
                            <Button
                                variant="destructive"
                                className="flex-1"
                                disabled={!rejectNote.trim() || loading}
                                onClick={handleReject}
                            >
                                {loading ? 'Rejet…' : 'Confirmer le rejet'}
                            </Button>
                        </div>
                    </div>
                )}

                {panel !== 'otp' && (
                    <DialogFooter>
                        <Button variant="outline" onClick={onClose} className="border-slate-600">Fermer</Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
};

// Plan d'évolution — checklist de prérequis à cocher avant que le type réel de l'agence
// ne change (remplace le changement instantané `action('evolve_type')` pour tout nouveau
// câblage). Un plan IN_PROGRESS bloque toute demande d'un nouveau plan côté serveur.
const EvolutionPlanDialog = ({ agency, onClose, toast, onChanged }) => {
    const [plans, setPlans] = useState(undefined); // undefined = chargement
    const [newType, setNewType] = useState('');
    const [reason, setReason] = useState('');

    const load = useCallback(() => {
        if (!agency) return;
        setPlans(undefined);
        api.agencies.evolutionPlans.list(agency.code).then(setPlans).catch(() => setPlans([]));
    }, [agency]);

    useEffect(() => { load(); setNewType(''); setReason(''); }, [load]);

    const current = plans?.find(p => p.status === 'IN_PROGRESS');
    const options = AGENCY_TYPES.filter(t => t.value !== agency?.type);

    const handleStart = async () => {
        try {
            await api.agencies.evolutionPlans.start(agency.code, newType, reason);
            toast({ title: "Plan d'évolution démarré", description: `Checklist créée pour ${agency.code}.` });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleCheck = async (itemId) => {
        try {
            await api.agencies.evolutionPlans.checkItem(current.id, itemId);
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleComplete = async () => {
        try {
            await api.agencies.evolutionPlans.complete(current.id);
            toast({ title: 'Évolution appliquée', description: `${agency.code} est maintenant de type ${AGENCY_TYPES.find(t => t.value === current.toType)?.label}.` });
            load();
            onChanged();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleCancel = async () => {
        try {
            await api.agencies.evolutionPlans.cancel(current.id);
            toast({ title: 'Plan annulé' });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    return (
        <Dialog open={!!agency} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
                <DialogHeader>
                    <DialogTitle>Plan d'Évolution — {agency?.code}</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Fait évoluer l'agence vers une nouvelle catégorie du réseau une fois tous les prérequis
                        cochés. Type actuel : {AGENCY_TYPES.find(t => t.value === agency?.type)?.label}.
                    </DialogDescription>
                </DialogHeader>
                {plans === undefined ? (
                    <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
                ) : current ? (
                    <div className="space-y-3 py-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Vers</span>
                            <span className="font-medium">{AGENCY_TYPES.find(t => t.value === current.toType)?.label}</span>
                        </div>
                        {current.reason && <p className="text-xs text-slate-500 italic">« {current.reason} »</p>}
                        <div className="space-y-2">
                            {current.items.map(item => (
                                <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input type="checkbox" checked={item.isDone} disabled={item.isDone}
                                        onChange={() => handleCheck(item.id)} className="accent-emerald-500" />
                                    <span className={item.isDone ? 'line-through text-slate-500' : 'text-slate-200'}>{item.label}</span>
                                </label>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={handleCancel}>Annuler le plan</Button>
                            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                disabled={current.items.some(i => !i.isDone)} onClick={handleComplete}>
                                Finaliser l'évolution
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 py-2">
                        <div>
                            <Label>Nouveau type</Label>
                            <Select value={newType} onValueChange={setNewType}>
                                <SelectTrigger><SelectValue placeholder="Sélectionner le type cible" /></SelectTrigger>
                                <SelectContent>
                                    {options.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Justification</Label>
                            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Croissance du volume, ouverture d'un guichet permanent..." />
                        </div>
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!newType} onClick={handleStart}>
                            Démarrer le plan d'évolution
                        </Button>
                        {plans.length > 0 && (
                            <div className="pt-3 border-t border-slate-800">
                                <p className="text-xs text-slate-500 mb-1">Historique</p>
                                {plans.map(p => (
                                    <div key={p.id} className="flex justify-between text-xs text-slate-400 py-1">
                                        <span>{AGENCY_TYPES.find(t => t.value === p.fromType)?.label || p.fromType} → {AGENCY_TYPES.find(t => t.value === p.toType)?.label || p.toType}</span>
                                        <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// Détail du score de conformité PAR AGENCE — même pattern que Supervision.jsx
// ComplianceDetailsDialog, mais scopé à une agence (`agencies.compliance`, distinct du
// score réseau global).
const AgencyComplianceDialog = ({ agency, onClose }) => {
    const [result, setResult] = useState(undefined);
    useEffect(() => {
        if (!agency) return;
        setResult(undefined);
        api.agencies.complianceScore(agency.code).then(setResult).catch(() => setResult({ score: null, components: [] }));
    }, [agency]);

    return (
        <Dialog open={!!agency} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Score de conformité — {agency?.code}</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Composantes sans donnée disponible (aucun rapprochement clôturé, aucune transaction en
                        attente...) sont ignorées et leur poids redistribué sur les autres, plutôt que comptées
                        comme 0.
                    </DialogDescription>
                </DialogHeader>
                {result === undefined ? (
                    <p className="text-slate-500 text-sm py-6 text-center">Calcul en cours...</p>
                ) : (
                    <div className="space-y-2">
                        <div className="flex justify-between items-center border-b border-slate-700 pb-2 mb-2">
                            <span className="text-sm text-slate-400">Score global</span>
                            <span className="text-xl font-bold text-emerald-400">{result.score === null ? 'N/D' : `${result.score}%`}</span>
                        </div>
                        {result.components.map((c) => (
                            <div key={c.code} className="flex justify-between items-center border-b border-slate-800 py-2">
                                <div>
                                    <p className="text-sm text-white">{c.label}</p>
                                    <p className="text-xs text-slate-500">Poids {(c.weight * 100).toFixed(0)}%</p>
                                </div>
                                <span className={`font-mono ${c.score === null ? 'text-slate-600' : 'text-emerald-400'}`}>
                                    {c.score === null ? 'N/D' : `${c.score}%`}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

const ReportDialog = ({ open, title, rows, onClose }) => (
    <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
            {rows === null ? (
                <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
            ) : rows.length === 0 ? (
                <p className="text-slate-500 text-sm py-6 text-center">Aucune donnée disponible.</p>
            ) : (
                <div className="space-y-1 text-sm">
                    {rows.map((row, i) => (
                        <div key={i} className="flex justify-between border-b border-slate-800 py-1.5">
                            <span className="text-slate-400">{row.action || row.name || row.code}</span>
                            <span className="font-mono text-slate-300">
                                {row.timestamp ? new Date(row.timestamp).toLocaleString() : (row.balance ?? '')}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </DialogContent>
    </Dialog>
);

const STATUS_HISTORY_KIND = {
    SUSPEND: { label: 'Suspension', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    CLOSE: { label: 'Fermeture', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    UNLOCK: { label: 'Déverrouillage', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    REOPEN: { label: 'Réouverture', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
};

const StatusHistoryDialog = ({ open, agencyCode, rows, onClose }) => (
    <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle>Historique de statut — {agencyCode}</DialogTitle>
                <DialogDescription className="text-slate-400">
                    Suspensions, fermetures et réactivations (avec motif et document à l'appui), du plus récent au plus ancien.
                </DialogDescription>
            </DialogHeader>
            {rows === null ? (
                <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
            ) : rows.length === 0 ? (
                <p className="text-slate-500 text-sm py-6 text-center">Aucun changement de statut enregistré.</p>
            ) : (
                <div className="space-y-2">
                    {rows.map((row, i) => {
                        const kind = STATUS_HISTORY_KIND[row.kind] || { label: row.kind, className: 'bg-slate-700 text-slate-300' };
                        return (
                            <div key={i} className="border border-slate-800 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-1">
                                    <Badge variant="outline" className={kind.className}>{kind.label}</Badge>
                                    <span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleString()}</span>
                                </div>
                                <p className="text-sm text-slate-300">{row.reason || 'Aucun motif renseigné.'}</p>
                                <div className="flex items-center justify-between mt-1">
                                    <span className="text-xs text-slate-500">Par {row.createdBy || '—'}</span>
                                    {row.documentUrl && (
                                        <a href={row.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">
                                            Voir le document
                                        </a>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </DialogContent>
    </Dialog>
);

const RECONCILIATION_STATUS_LABELS = { PENDING: 'En attente', IN_PROGRESS: 'En cours', COMPLETED: 'Terminé' };

const ReconciliationDialog = ({ agency, onClose, toast }) => {
    const [current, setCurrent] = useState(undefined); // undefined = chargement, null = aucun en cours
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [assigneeSub, setAssigneeSub] = useState('');
    const [deltaAmount, setDeltaAmount] = useState('0');
    const [currency, setCurrency] = useState('USD');
    const [notes, setNotes] = useState('');

    const load = useCallback(() => {
        if (!agency) return;
        setCurrent(undefined);
        api.agencies.reconciliations.list({ agency: agency.code }).then(rows => {
            const active = rows.find(r => r.status !== 'COMPLETED');
            setCurrent(active || null);
        }).catch(() => setCurrent(null));
    }, [agency]);

    useEffect(() => {
        load();
        setPeriodStart(''); setPeriodEnd(''); setAssigneeSub(''); setDeltaAmount('0'); setNotes('');
    }, [load]);

    const handleOpen = async () => {
        try {
            await api.agencies.reconciliations.open(agency.code, periodStart, periodEnd);
            toast({ title: 'Rapprochement ouvert', description: `${agency.code} : période ${periodStart} → ${periodEnd}.` });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleAssign = async () => {
        try {
            await api.agencies.reconciliations.assign(current.id, assigneeSub);
            toast({ title: 'Rapprochement assigné', description: `Assigné à ${assigneeSub}.` });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleComplete = async () => {
        try {
            await api.agencies.reconciliations.complete(current.id, deltaAmount, currency, notes);
            toast({ title: 'Rapprochement terminé', description: `Écart constaté : ${deltaAmount} ${currency}.` });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    return (
        <Dialog open={!!agency} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Rapprochement structuré — {agency?.code}</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Suivi ouvert → assigné → terminé, distinct du rapport de balance en lecture seule
                        (action « Rapprochement »).
                    </DialogDescription>
                </DialogHeader>
                {current === undefined ? (
                    <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
                ) : current === null ? (
                    <div className="space-y-3 py-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Début de période</Label>
                                <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                            </div>
                            <div>
                                <Label>Fin de période</Label>
                                <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                            </div>
                        </div>
                        <Button className="bg-emerald-600 hover:bg-emerald-700 w-full" disabled={!periodStart || !periodEnd} onClick={handleOpen}>
                            Ouvrir le rapprochement
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-3 py-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Période</span>
                            <span>{current.periodStart} → {current.periodEnd}</span>
                        </div>
                        <div className="flex justify-between text-sm items-center">
                            <span className="text-slate-400">Statut</span>
                            <Badge variant="outline">{RECONCILIATION_STATUS_LABELS[current.status]}</Badge>
                        </div>
                        {current.status === 'PENDING' && (
                            <div className="space-y-2">
                                <Label>Assigner à (identifiant)</Label>
                                <Input value={assigneeSub} onChange={e => setAssigneeSub(e.target.value)} placeholder="sub de l'agent responsable" />
                                <Button className="w-full" disabled={!assigneeSub} onClick={handleAssign}>Assigner</Button>
                            </div>
                        )}
                        {current.status === 'IN_PROGRESS' && (
                            <div className="space-y-2">
                                <p className="text-xs text-slate-500">Assigné à {current.assignedTo}</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label>Écart constaté</Label>
                                        <Input type="number" value={deltaAmount} onChange={e => setDeltaAmount(e.target.value)} />
                                    </div>
                                    <div>
                                        <Label>Devise</Label>
                                        <Select value={currency} onValueChange={setCurrency}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="USD">USD</SelectItem>
                                                <SelectItem value="CDF">CDF</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <Label>Notes</Label>
                                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observations sur l'écart..." />
                                <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={handleComplete}>
                                    Terminer le rapprochement
                                </Button>
                            </div>
                        )}
                    </div>
                )}
                <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const Agencies = () => {
    const { toast } = useToast();
    const [agencies, setAgencies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [formAgency, setFormAgency] = useState(undefined); // undefined = fermé, null = création, objet = édition
    const [reasonAction, setReasonAction] = useState(null); // { agency, action, title }
    const [evolutionAgency, setEvolutionAgency] = useState(null);
    const [reactivation, setReactivation] = useState(null); // { agency, action, title, description }
    const [report, setReport] = useState(null); // { title, rows }
    const [statusHistory, setStatusHistory] = useState(null); // { agencyCode, rows }
    const [reconcilingAgency, setReconcilingAgency] = useState(null);
    const [complianceAgency, setComplianceAgency] = useState(null);
    // Maker-checker : demandes en attente d'approbation
    const [actionRequests, setActionRequests] = useState([]);
    const [makerRequest, setMakerRequest] = useState(null);   // { agency, actionType } | null
    const [checkerRequest, setCheckerRequest] = useState(null); // demande complète | null
    const [activeAgencyTab, setActiveAgencyTab] = useState('agencies');

    const load = useCallback(() => {
        setLoading(true);
        api.agencies.list().then(setAgencies).catch((e) => {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        }).finally(() => setLoading(false));
    }, [toast]);

    const loadRequests = useCallback(() => {
        api.agencies.actionRequests.list().then(setActionRequests).catch(() => {});
    }, []);

    useEffect(() => { load(); loadRequests(); }, [load, loadRequests]);

    const handleSave = async (form) => {
        try {
            if (formAgency) {
                await api.agencies.update(formAgency.code, { name: form.name, city: form.city, province: form.province, manager: form.manager });
                toast({ title: 'Agence mise à jour', description: `${formAgency.code} a été modifiée.` });
            } else {
                await api.agencies.create(form);
                toast({ title: 'Agence créée', description: `${form.code} a été ajoutée au réseau.` });
            }
            setFormAgency(undefined);
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const runAction = async (agency, action, reason = '') => {
        try {
            await api.agencies.action(agency.code, action, reason);
            toast({ title: 'Action effectuée', description: `${agency.code} : action « ${action} » appliquée.` });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Action refusée', description: e instanceof ApiError ? e.message : String(e) });
        } finally {
            setReasonAction(null);
        }
    };

    const runReactivation = async (reason, document) => {
        const { agency, action } = reactivation;
        try {
            await api.agencies.actionWithDocument(agency.code, action, reason, document);
            toast({ title: 'Agence réactivée', description: `${agency.code} est de nouveau active.` });
            load();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Réactivation refusée', description: e instanceof ApiError ? e.message : String(e) });
        } finally {
            setReactivation(null);
        }
    };

    const openReconciliation = async (agency) => {
        setReport({ title: `Rapprochement — ${agency.code} (balance générale, pas encore filtrée par agence)`, rows: null });
        try {
            const rows = await api.agencies.reconciliation(agency.code);
            setReport({ title: `Rapprochement — ${agency.code} (balance générale, pas encore filtrée par agence)`, rows });
        } catch {
            setReport({ title: `Rapprochement — ${agency.code}`, rows: [] });
        }
    };

    const openAuditTrail = async (agency) => {
        setReport({ title: `Journal d'audit — ${agency.code}`, rows: null });
        try {
            const rows = await api.agencies.auditTrail(agency.code);
            setReport({ title: `Journal d'audit — ${agency.code}`, rows });
        } catch {
            setReport({ title: `Journal d'audit — ${agency.code}`, rows: [] });
        }
    };

    const openStatusHistory = async (agency) => {
        setStatusHistory({ agencyCode: agency.code, rows: null });
        try {
            const rows = await api.agencies.statusHistory(agency.code);
            setStatusHistory({ agencyCode: agency.code, rows });
        } catch {
            setStatusHistory({ agencyCode: agency.code, rows: [] });
        }
    };

    const handleExport = () => {
        if (agencies.length === 0) {
            toast({ title: 'Rien à exporter', description: 'Aucune agence à exporter.' });
            return;
        }
        exportToExcel(agencies.map(a => ({
            Code: a.code, Nom: a.name, Type: a.type, Ville: a.city, Province: a.province,
            Responsable: a.manager, Conformité: a.complianceScore, Solde: a.balanceUSD, Statut: a.status,
        })), 'agences_reseau');
        toast({ title: 'Exportation réussie', description: 'Réseau d\'agences exporté en Excel.' });
    };

    const filtered = agencies.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.code.toLowerCase().includes(searchTerm.toLowerCase()));
    const activeCount = agencies.filter(a => a.status === 'ACTIF').length;
    const suspendedCount = agencies.filter(a => a.status === 'SUSPENDU').length;
    const avgCompliance = agencies.length ? Math.round(agencies.reduce((s, a) => s + a.complianceScore, 0) / agencies.length) : 0;
    const activeAlerts = agencies.reduce((s, a) => s + a.alerts.length, 0);

    return (
        <Layout>
            <Helmet>
                <title>Gestion Agences & Réseau - AGRICAP</title>
            </Helmet>

            <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Store className="w-8 h-8 text-emerald-400" />
                            Réseau d'Agences
                        </h1>
                        <p className="text-slate-400 mt-1">Gérez les points de vente, la conformité, et les actions de supervision.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" className="border-slate-600 hover:bg-slate-700" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2"/> Exporter
                        </Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setFormAgency(null)}>
                            <Plus className="w-4 h-4 mr-2"/> Nouvelle Agence
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="glass-effect p-4 rounded-xl border border-white/10">
                        <div className="text-slate-400 text-sm mb-1">Agences Actives</div>
                        <div className="text-2xl font-bold text-white">{activeCount}</div>
                    </div>
                    <div className="glass-effect p-4 rounded-xl border border-white/10">
                        <div className="text-slate-400 text-sm mb-1 flex items-center justify-between">Agences Suspendues <AlertTriangle className="w-4 h-4 text-red-400"/></div>
                        <div className="text-2xl font-bold text-white">{suspendedCount}</div>
                    </div>
                    <div className="glass-effect p-4 rounded-xl border border-white/10">
                        <div className="text-slate-400 text-sm mb-1 flex items-center justify-between">Score Conformité Moyen <ShieldCheck className="w-4 h-4 text-blue-400"/></div>
                        <div className="text-2xl font-bold text-white">{avgCompliance}%</div>
                    </div>
                    <div className="glass-effect p-4 rounded-xl border border-white/10">
                        <div className="text-slate-400 text-sm mb-1 flex items-center justify-between">Alertes Actives <RefreshCcw className="w-4 h-4 text-amber-400"/></div>
                        <div className="text-2xl font-bold text-white">{activeAlerts}</div>
                    </div>
                </div>

                <Tabs value={activeAgencyTab} onValueChange={setActiveAgencyTab}>
                    <TabsList className="bg-slate-900/60 border border-slate-700">
                        <TabsTrigger value="agencies" className="data-[state=active]:bg-slate-700">
                            <Store className="w-4 h-4 mr-2" />
                            Agences
                        </TabsTrigger>
                        <TabsTrigger value="requests" className="data-[state=active]:bg-slate-700 gap-2">
                            <Clock className="w-4 h-4" />
                            Demandes en attente
                            {actionRequests.filter(r => r.status === 'PENDING_APPROVAL').length > 0 && (
                                <Badge className="bg-amber-500 text-white text-[10px] h-4 min-w-4 px-1">
                                    {actionRequests.filter(r => r.status === 'PENDING_APPROVAL').length}
                                </Badge>
                            )}
                        </TabsTrigger>
                    </TabsList>

                    {/* ── Tab Agences ── */}
                    <TabsContent value="agencies" className="mt-4 space-y-4">
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    placeholder="Rechercher une agence..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="pl-10 bg-slate-900/50 border-slate-700"
                                />
                            </div>
                        </div>

                        <div className="rounded-md border border-slate-800 bg-card overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-900/50 border-slate-800">
                                        <TableHead>Agence</TableHead>
                                        <TableHead>Type & Loc.</TableHead>
                                        <TableHead>Responsable</TableHead>
                                        <TableHead className="text-center">Score Conf.</TableHead>
                                        <TableHead className="text-right">Solde Total</TableHead>
                                        <TableHead>Statut</TableHead>
                                        <TableHead className="text-center">Historique de statut</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">Chargement...</TableCell></TableRow>
                                    ) : filtered.length === 0 ? (
                                        <TableRow><TableCell colSpan={8} className="text-center text-slate-500 py-8">Aucune agence.</TableCell></TableRow>
                                    ) : filtered.map((agency) => (
                                        <TableRow key={agency.id} className="border-slate-800 hover:bg-slate-800/30">
                                            <TableCell>
                                                <div className="font-medium text-white">{agency.name}</div>
                                                <div className="text-xs text-slate-400">{agency.code}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 text-xs mb-1"><Building2 className="w-3 h-3 text-blue-400"/> {AGENCY_TYPES.find(t => t.value === agency.type)?.label || agency.type}</div>
                                                <div className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="w-3 h-3"/> {agency.city}{agency.city && agency.province ? ', ' : ''}{agency.province}</div>
                                            </TableCell>
                                            <TableCell className="text-sm">{agency.manager || '—'}</TableCell>
                                            <TableCell className="text-center">
                                                <button type="button" onClick={() => setComplianceAgency(agency)}>
                                                    <Badge variant="outline" className={`cursor-pointer hover:opacity-80 ${agency.complianceScore > 90 ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>
                                                        {agency.complianceScore}%
                                                    </Badge>
                                                </button>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="font-mono text-emerald-400">{agency.balanceUSD.toLocaleString()} $</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <StatusBadge status={agency.status} />
                                                    {agency.alerts.length > 0 && <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white"
                                                    title="Voir l'historique de statut"
                                                    onClick={() => openStatusHistory(agency)}
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white">
                                                            <MoreHorizontal className="w-4 h-4"/>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-700 text-white">
                                                        <DropdownMenuLabel>Supervision</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => setFormAgency(agency)}>Modifier</DropdownMenuItem>
                                                        {agency.status !== 'SUSPENDU' && (
                                                            <DropdownMenuItem
                                                                onClick={() => setMakerRequest({ agency, actionType: 'SUSPEND' })}
                                                                className="text-amber-400 focus:text-amber-300"
                                                            ><Lock className="w-4 h-4 mr-2"/> Suspendre l'Agence</DropdownMenuItem>
                                                        )}
                                                        {agency.status === 'SUSPENDU' && (
                                                            <DropdownMenuItem onClick={() => setMakerRequest({ agency, actionType: 'UNLOCK_TEMPORARY' })}>
                                                                <ShieldCheck className="w-4 h-4 mr-2"/> Déverrouillage Temp.
                                                            </DropdownMenuItem>
                                                        )}
                                                        {agency.status !== 'FERMEE' && (
                                                            <DropdownMenuItem
                                                                onClick={() => setMakerRequest({ agency, actionType: 'CLOSE' })}
                                                                className="text-red-400 focus:text-red-300"
                                                            ><AlertTriangle className="w-4 h-4 mr-2"/> Fermer l'Agence</DropdownMenuItem>
                                                        )}
                                                        {agency.status === 'FERMEE' && (
                                                            <DropdownMenuItem onClick={() => setMakerRequest({ agency, actionType: 'REOPEN' })}>
                                                                <ShieldCheck className="w-4 h-4 mr-2"/> Réouvrir l'Agence
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuSeparator className="bg-slate-700"/>
                                                        <DropdownMenuLabel>Opérations</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => openReconciliation(agency)}><RefreshCcw className="w-4 h-4 mr-2"/> Rapprochement</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setReconcilingAgency(agency)}><ClipboardCheck className="w-4 h-4 mr-2"/> Suivi Rapprochement</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => openAuditTrail(agency)}><History className="w-4 h-4 mr-2"/> Journal d'Audit</DropdownMenuItem>
                                                        <DropdownMenuSeparator className="bg-slate-700"/>
                                                        <DropdownMenuItem onClick={() => setEvolutionAgency(agency)}>
                                                            <ArrowLeftRight className="w-4 h-4 mr-2"/> Plan d'Évolution
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    {/* ── Tab Demandes en attente ── */}
                    <TabsContent value="requests" className="mt-4">
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-white font-medium flex items-center gap-2 text-sm">
                                    <Clock className="w-4 h-4 text-amber-400" />
                                    Demandes en attente d'approbation
                                    <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10">
                                        {actionRequests.filter(r => r.status === 'PENDING_APPROVAL').length} en attente
                                    </Badge>
                                </h3>
                                <Button variant="ghost" size="sm" className="text-slate-400 text-xs h-7" onClick={loadRequests}>
                                    <RefreshCcw className="w-3 h-3 mr-1" /> Actualiser
                                </Button>
                            </div>
                            {actionRequests.length === 0 ? (
                                <p className="text-slate-500 text-sm py-4 text-center">Aucune demande en cours.</p>
                            ) : (
                                <div className="space-y-2">
                                    {actionRequests.map(req => {
                                        const aMeta = ACTION_TYPE_META[req.actionType] || { label: req.actionType, color: '' };
                                        const sMeta = REQ_STATUS_META[req.status] || { label: req.status, color: '' };
                                        return (
                                            <div key={req.id} className="flex items-center gap-3 bg-slate-900/60 rounded-lg px-4 py-3 border border-slate-800">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-mono text-sm text-white">{req.agencyCode}</span>
                                                        <Badge variant="outline" className={`text-[11px] ${aMeta.color}`}>{aMeta.label}</Badge>
                                                        <Badge variant="outline" className={`text-[11px] ${sMeta.color}`}>{sMeta.label}</Badge>
                                                    </div>
                                                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                                                        {req.requestedBy && <span className="mr-2 text-slate-500">par {req.requestedBy}</span>}
                                                        {req.reason || 'Aucun motif renseigné'}
                                                        <span className="ml-2 text-slate-600">· {new Date(req.createdAt).toLocaleDateString()}</span>
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {req.status === 'PENDING_APPROVAL' && (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs h-7"
                                                                onClick={async () => {
                                                                    try {
                                                                        // Annuler puis recréer (la création envoie les codes OTP automatiquement)
                                                                        await api.agencies.actionRequests.cancel(req.id);
                                                                        const newReq = await api.agencies.actionRequests.create(
                                                                            req.agencyCode, req.actionType, req.reason
                                                                        );
                                                                        toast({ title: 'Demande renvoyée', description: `Nouvelle demande #${newReq.id} créée. Les codes OTP ont été envoyés aux approbateurs.` });
                                                                        loadRequests();
                                                                    } catch (e) {
                                                                        if (e.status === 409) {
                                                                            // La demande a déjà été annulée ou traitée — rafraîchir la liste
                                                                            toast({ variant: 'destructive', title: 'Demande déjà traitée', description: 'Cette demande n\'est plus en attente. La liste a été mise à jour.' });
                                                                            loadRequests();
                                                                        } else {
                                                                            toast({ variant: 'destructive', title: 'Erreur', description: e.message });
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                <RefreshCcw className="w-3 h-3 mr-1" /> Renvoyer
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs h-7"
                                                                onClick={async () => {
                                                                    console.group('%c[AGRICAP AGENCIES] Annuler demande', 'color:#f87171;font-weight:bold');
                                                                    console.log('requestId  :', req.id);
                                                                    console.log('agency     :', req.agencyCode);
                                                                    console.log('actionType :', req.actionType);
                                                                    console.log('status     :', req.status);
                                                                    console.log('requestedBy:', req.requestedBy);
                                                                    console.log('→ POST /api/agencies/action-requests/%s/cancel', req.id);
                                                                    try {
                                                                        const res = await api.agencies.actionRequests.cancel(req.id);
                                                                        console.log('✅ Annulé  nouvel état:', res);
                                                                        console.groupEnd();
                                                                        toast({ title: 'Demande annulée', description: `Demande #${req.id} annulée.` });
                                                                        loadRequests();
                                                                    } catch (e) {
                                                                        console.error('❌ Erreur cancel:', e.status, e.message, e);
                                                                        console.groupEnd();
                                                                        toast({ variant: 'destructive', title: 'Erreur', description: e.message });
                                                                    }
                                                                }}
                                                            >
                                                                <XCircle className="w-3 h-3 mr-1" /> Annuler
                                                            </Button>
                                                        </>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        variant={req.status === 'PENDING_APPROVAL' ? 'default' : 'ghost'}
                                                        className={req.status === 'PENDING_APPROVAL' ? 'bg-emerald-600 hover:bg-emerald-700' : 'text-slate-500'}
                                                        onClick={() => {
                                                            console.group('%c[AGRICAP AGENCIES] Traiter / Voir demande', 'color:#34d399;font-weight:bold');
                                                            console.log('requestId  :', req.id);
                                                            console.log('agency     :', req.agencyCode);
                                                            console.log('actionType :', req.actionType);
                                                            console.log('status     :', req.status);
                                                            console.log('approver   :', req.approvedBy || '(aucun)');
                                                            console.log('requestedBy:', req.requestedBy);
                                                            console.groupEnd();
                                                            setCheckerRequest(req);
                                                        }}
                                                    >
                                                        {req.status === 'PENDING_APPROVAL' ? <><UserCheck className="w-3 h-3 mr-1" /> Traiter</> : <><Eye className="w-3 h-3 mr-1" /> Voir</>}
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            <AgencyFormModal isOpen={formAgency !== undefined} onClose={() => setFormAgency(undefined)} agency={formAgency} onSave={handleSave} />
            <ReasonDialog
                open={!!reasonAction}
                title={reasonAction?.title || ''}
                description="Cette action sera enregistrée dans le journal d'audit."
                onClose={() => setReasonAction(null)}
                onConfirm={(reason) => runAction(reasonAction.agency, reasonAction.action, reason)}
            />
            <ReportDialog open={!!report} title={report?.title || ''} rows={report?.rows ?? null} onClose={() => setReport(null)} />
            <EvolutionPlanDialog agency={evolutionAgency} onClose={() => setEvolutionAgency(null)} toast={toast} onChanged={load} />
            <AgencyComplianceDialog agency={complianceAgency} onClose={() => setComplianceAgency(null)} />
            <ReactivationDialog
                open={!!reactivation}
                title={reactivation?.title || ''}
                description={reactivation?.description || ''}
                onClose={() => setReactivation(null)}
                onConfirm={runReactivation}
            />
            <StatusHistoryDialog
                open={!!statusHistory}
                agencyCode={statusHistory?.agencyCode || ''}
                rows={statusHistory?.rows ?? null}
                onClose={() => setStatusHistory(null)}
            />
            <ReconciliationDialog agency={reconcilingAgency} onClose={() => setReconcilingAgency(null)} toast={toast} />
            <MakerRequestDialog
                agency={makerRequest?.agency || null}
                actionType={makerRequest?.actionType || ''}
                pendingRequest={actionRequests.find(r => r.agencyCode === makerRequest?.agency?.code && r.status === 'PENDING_APPROVAL') || null}
                onClose={() => setMakerRequest(null)}
                onSubmitted={loadRequests}
                toast={toast}
            />
            <CheckerDialog
                request={checkerRequest}
                onClose={() => setCheckerRequest(null)}
                onDone={() => { load(); loadRequests(); }}
                toast={toast}
            />
        </Layout>
    );
};

export default Agencies;
