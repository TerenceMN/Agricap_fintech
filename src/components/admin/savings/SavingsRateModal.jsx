import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import {
    Percent, History, Ban, PauseCircle, PlayCircle, Save, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { Loading, Empty, ErrorPanel } from '@/components/backoffice/States';
import {
    savingsAdminApi, rateStatusLabel, rateStatusTone, rateActionLabel, describeRateChange,
    formatPct, validateAnnualRate, savingsOperationErrors,
} from '@/services/savingsApi';

/**
 * Configuration Taux & Intérêts d'un plan d'épargne.
 *
 * Avant, cette modale écrivait la config, l'historique et l'audit dans
 * `localStorage` et calculait le taux mensuel en `(val / 12)` côté client — un
 * chiffre métier fabriqué au navigateur, qui n'engageait rien et que personne
 * d'autre ne voyait (CLAUDE.md §5). Désormais :
 *   - la config COURANTE et l'historique append-only viennent du serveur
 *     (`GET /savings/plans/{id}/rate-config`) ;
 *   - le taux mensuel affiché est celui que le SERVEUR calcule et sert — jamais
 *     dérivé ici ;
 *   - toute action (modification, blocage, suspension, réactivation) part au
 *     serveur (`POST …/rate-config`), qui re-vérifie le plafond de 6 % ;
 *   - un refus 422 se déplie cause par cause et ne referme PAS le dialogue.
 */
const SavingsRateModal = ({ isOpen, onOpenChange, savings }) => {
    const { toast } = useToast();
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState([]);
    // Saisie du taux annuel (chaîne) — le taux mensuel n'est PAS saisi : il est
    // recalculé et servi par le serveur à l'enregistrement.
    const [annualInput, setAnnualInput] = useState('');
    const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
    const [reason, setReason] = useState('');
    const [inputError, setInputError] = useState(null);
    // Action en attente de confirmation ('rate_update' | 'block' | 'suspend' | 'resume').
    const [pendingAction, setPendingAction] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [serverErrors, setServerErrors] = useState([]);

    const planId = savings?.id;

    const load = useCallback(() => {
        if (planId === undefined || planId === null) return;
        setLoading(true);
        setLoadError([]);
        savingsAdminApi.rateConfig.get(planId)
            .then((cfg) => {
                setConfig(cfg);
                setAnnualInput(String(cfg.annualRate));
                setInputError(null);
                setServerErrors([]);
                setPendingAction(null);
            })
            .catch((e) => setLoadError(savingsOperationErrors(e)))
            .finally(() => setLoading(false));
    }, [planId]);

    useEffect(() => {
        if (isOpen && planId !== undefined && planId !== null) {
            setEffectiveDate(new Date().toISOString().split('T')[0]);
            setReason('');
            load();
        }
    }, [isOpen, planId, load]);

    if (!savings) return null;

    const status = config?.status ?? 'actif';
    const maxRate = config?.maxAnnualRate ?? 6;
    const blocked = status === 'bloque';

    const askRateUpdate = () => {
        const err = validateAnnualRate(annualInput, maxRate);
        if (err) { setInputError(err); return; }
        setInputError(null);
        setServerErrors([]);
        setPendingAction('rate_update');
    };

    const askAction = (action) => {
        setServerErrors([]);
        setPendingAction(action);
    };

    // Un refus serveur NE FERME PAS le dialogue : ses causes s'affichent sous la
    // confirmation, dépliées une par une, la saisie restant intacte derrière.
    const executePending = async () => {
        if (!pendingAction || planId === undefined || planId === null) return;
        setSubmitting(true);
        const payload = pendingAction === 'rate_update'
            ? { action: 'rate_update', annualRate: annualInput, effectiveDate, reason }
            : { action: pendingAction, effectiveDate, reason };
        try {
            const updated = await savingsAdminApi.rateConfig.apply(planId, payload);
            setConfig(updated);
            setAnnualInput(String(updated.annualRate));
            setPendingAction(null);
            setServerErrors([]);
            setReason('');
            toast({ title: 'Configuration enregistrée', description: 'Le serveur a appliqué le changement de taux.' });
        } catch (e) {
            const causes = savingsOperationErrors(e);
            setServerErrors(causes);
            toast({ variant: 'destructive', title: 'Refusé', description: causes.map(c => c.message).join(' · ') });
        } finally {
            setSubmitting(false);
        }
    };

    const history = config?.history ?? [];

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-2xl border-slate-700 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <Percent className="w-6 h-6 text-emerald-400" />
                        Configuration Taux & Intérêts
                        <Badge variant="outline" className={`ml-2 ${rateStatusTone(status)}`}>
                            {rateStatusLabel(status)}
                        </Badge>
                    </DialogTitle>
                    <DialogDescription>
                        Épargne : <span className="text-white font-medium">{savings.id}</span> - {savings.holder}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <Loading label="Chargement de la configuration de taux…" />
                ) : loadError.length > 0 ? (
                    <div className="mt-4 space-y-3">
                        <ErrorPanel errors={loadError} title="Configuration indisponible" />
                        <div className="flex justify-end">
                            <Button variant="outline" onClick={load}>Réessayer</Button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        {/* Settings */}
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-4">
                                <h4 className="font-semibold text-emerald-400 flex items-center gap-2">Paramètres Actuels</h4>
                                <div>
                                    <Label className="text-xs text-slate-400">Taux Annuel (%) - Max {maxRate}%</Label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Input
                                            type="number"
                                            step="0.001"
                                            max={maxRate}
                                            value={annualInput}
                                            onChange={(e) => { setAnnualInput(e.target.value); setInputError(null); }}
                                            className="bg-slate-900 border-slate-700 font-mono text-lg"
                                            disabled={blocked}
                                        />
                                    </div>
                                    {inputError && <p className="text-red-400 text-xs mt-1">{inputError}</p>}
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-xs text-slate-400">Taux Mensuel (serveur)</Label>
                                        <div className="font-mono text-sm text-slate-300 mt-1">{formatPct(config?.monthlyRate, 4)}</div>
                                        <p className="text-[10px] text-slate-500 mt-1">Recalculé par le serveur à l'enregistrement.</p>
                                    </div>
                                    <div>
                                        <Label className="text-xs text-slate-400">Date d'effet</Label>
                                        <Input
                                            type="date"
                                            value={effectiveDate}
                                            onChange={(e) => setEffectiveDate(e.target.value)}
                                            className="bg-slate-900 border-slate-700 mt-1 h-8 text-xs"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-400">Motif (optionnel)</Label>
                                    <Textarea
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        className="bg-slate-900 border-slate-700 mt-1 text-sm"
                                        placeholder="Justification consignée dans le journal…"
                                    />
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-2 gap-2">
                                <Button onClick={askRateUpdate} disabled={blocked || submitting} className="col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                                    <Save className="w-4 h-4 mr-2" /> Enregistrer Taux
                                </Button>
                                {status === 'actif' || status === 'suspendu' ? (
                                    <>
                                        {status === 'actif' ? (
                                            <Button variant="outline" onClick={() => askAction('suspend')} disabled={submitting} className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
                                                <PauseCircle className="w-4 h-4 mr-2" /> Suspendre
                                            </Button>
                                        ) : (
                                            <Button variant="outline" onClick={() => askAction('resume')} disabled={submitting} className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
                                                <PlayCircle className="w-4 h-4 mr-2" /> Reprendre
                                            </Button>
                                        )}
                                        <Button variant="destructive" onClick={() => askAction('block')} disabled={submitting} className="bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/50">
                                            <Ban className="w-4 h-4 mr-2" /> Bloquer (0%)
                                        </Button>
                                    </>
                                ) : (
                                    <Button onClick={() => askAction('resume')} disabled={submitting} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white">
                                        <ShieldCheck className="w-4 h-4 mr-2" /> Réactiver Plan
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* History (serveur, append-only) */}
                        <div className="bg-slate-900/30 rounded-lg border border-slate-700 flex flex-col h-[360px]">
                            <div className="p-3 border-b border-slate-700 flex items-center gap-2">
                                <History className="w-4 h-4 text-slate-400" />
                                <span className="font-semibold text-sm">Journal d'audit (serveur)</span>
                            </div>
                            <div className="flex-1 overflow-auto p-0 scrollbar-thin scrollbar-thumb-slate-600">
                                {history.length === 0 ? (
                                    <Empty title="Aucun changement enregistré" hint="Les modifications de taux apparaîtront ici." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-slate-800 hover:bg-transparent">
                                                <TableHead className="h-8 text-xs w-24">Date</TableHead>
                                                <TableHead className="h-8 text-xs">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {history.map((h) => {
                                                const described = describeRateChange(h);
                                                return (
                                                    <TableRow key={h.id} className="border-slate-800/50 text-xs">
                                                        <TableCell className="text-slate-400 py-2">{new Date(h.date).toLocaleDateString('fr-FR')}</TableCell>
                                                        <TableCell className="py-2">
                                                            <div className="font-medium text-white">{described.actionLabel}</div>
                                                            <div className="text-[10px] text-slate-500" title={described.detail}>{described.detail}</div>
                                                            {h.actor && <div className="text-[10px] text-slate-600">par {h.actor}</div>}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {pendingAction && (
                    <Alert className="mt-2 border-amber-500/50 bg-amber-900/10 text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Confirmation requise</AlertTitle>
                        <AlertDescription className="flex flex-col gap-3 mt-2">
                            <p>
                                Confirmer l'action : <strong>{rateActionLabel(pendingAction)}</strong>
                                {pendingAction === 'rate_update' && <> — taux annuel {formatPct(Number(String(annualInput).replace(',', '.')))}</>}
                                {' '}? Le serveur re-vérifie et journalise l'opération.
                            </p>
                            {serverErrors.length > 0 && <ErrorPanel errors={serverErrors} title="Opération refusée par le serveur" />}
                            <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="ghost" disabled={submitting} onClick={() => { setPendingAction(null); setServerErrors([]); }}>Annuler</Button>
                                <Button size="sm" disabled={submitting} onClick={executePending} className="bg-amber-600 hover:bg-amber-700 text-white">
                                    {submitting ? 'Envoi…' : 'Confirmer'}
                                </Button>
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default SavingsRateModal;
