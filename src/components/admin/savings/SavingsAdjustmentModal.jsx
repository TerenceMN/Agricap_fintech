import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { SlidersHorizontal, CalendarDays, Wallet, Save } from 'lucide-react';
import { Loading, ErrorPanel } from '@/components/backoffice/States';
import {
    savingsAdminApi, DEPOSIT_MODES, depositModeLabel, frequencyLabel, formatAmount,
    depositsNeededLabel, savingsOperationErrors,
} from '@/services/savingsApi';

const FREQUENCIES = ['hebdomadaire', 'bimensuel', 'mensuel', 'trimestriel', 'annuel'];

/**
 * Ajustement des MODALITÉS d'un plan d'épargne + simulation de croissance.
 *
 * Avant, cette modale écrivait les modalités dans `localStorage` et calculait en
 * JavaScript la projection, le reste à épargner et le nombre de dépôts (§5
 * interdit tout chiffre métier côté client). Désormais :
 *   - les modalités courantes, les métriques (reste à épargner, dépôts
 *     nécessaires, maturité) ET la projection sont TOUTES servies par le serveur
 *     (`GET /savings/plans/{id}/adjustment`) ;
 *   - l'enregistrement part au serveur (`POST …/adjustment`), qui persiste et
 *     RENVOIE les métriques recalculées ;
 *   - le solde n'est pas éditable ici : il ne bouge que par un mouvement d'argent
 *     tracé (le serveur le refuserait) — on l'affiche en lecture seule ;
 *   - le mode de dépôt utilise les codes canoniques (`agent`/`mobile_money`/…),
 *     pas l'ancien `virement`/`especes` que le serveur refuse (principe 6).
 */
const SavingsAdjustmentModal = ({ isOpen, onOpenChange, savings }) => {
    const { toast } = useToast();
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState([]);
    // Saisie (chaînes) — aucune de ces valeurs n'est utilisée pour un calcul local.
    const [form, setForm] = useState({ targetAmount: '', periodicDeposit: '', frequency: 'mensuel', depositMode: 'agent' });
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [serverErrors, setServerErrors] = useState([]);

    const planId = savings?.id;

    const applyConfig = (cfg) => {
        setConfig(cfg);
        setForm({
            targetAmount: String(cfg.targetAmount),
            periodicDeposit: String(cfg.periodicDeposit),
            frequency: cfg.frequency,
            depositMode: cfg.depositMode,
        });
    };

    const load = useCallback(() => {
        if (planId === undefined || planId === null) return;
        setLoading(true);
        setLoadError([]);
        savingsAdminApi.adjustment.get(planId)
            .then((cfg) => { applyConfig(cfg); setServerErrors([]); })
            .catch((e) => setLoadError(savingsOperationErrors(e)))
            .finally(() => setLoading(false));
    }, [planId]);

    useEffect(() => {
        if (isOpen && planId !== undefined && planId !== null) {
            setReason('');
            load();
        }
    }, [isOpen, planId, load]);

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    // Le refus serveur ne referme pas le dialogue : les causes s'affichent sous
    // le formulaire, la saisie restant intacte.
    const saveAdjustments = async () => {
        if (planId === undefined || planId === null) return;
        setSubmitting(true);
        try {
            const updated = await savingsAdminApi.adjustment.apply(planId, {
                targetAmount: form.targetAmount,
                periodicDeposit: form.periodicDeposit,
                frequency: form.frequency,
                depositMode: form.depositMode,
                reason,
            });
            applyConfig(updated);
            setServerErrors([]);
            setReason('');
            toast({ title: 'Modalités enregistrées', description: 'Le serveur a recalculé la projection.' });
        } catch (e) {
            const causes = savingsOperationErrors(e);
            setServerErrors(causes);
            toast({ variant: 'destructive', title: 'Refusé', description: causes.map(c => c.message).join(' · ') });
        } finally {
            setSubmitting(false);
        }
    };

    if (!savings) return null;

    const currency = config?.currency ?? null;
    const metrics = config?.metrics ?? { remaining: 0, depositsNeeded: null, projectedMaturity: null, projection: [] };
    const projection = metrics.projection ?? [];

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-3xl border-slate-700 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <SlidersHorizontal className="w-6 h-6 text-blue-400" />
                        Ajustement du Plan & Simulation
                    </DialogTitle>
                    <DialogDescription>
                        Configuration pour {savings.id} ({savings.holder})
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <Loading label="Chargement des modalités…" />
                ) : loadError.length > 0 ? (
                    <div className="mt-4 space-y-3">
                        <ErrorPanel errors={loadError} title="Modalités indisponibles" />
                        <div className="flex justify-end">
                            <Button variant="outline" onClick={load}>Réessayer</Button>
                        </div>
                    </div>
                ) : (
                <Tabs defaultValue="adjust" className="mt-4">
                    <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
                        <TabsTrigger value="adjust">Configuration</TabsTrigger>
                        <TabsTrigger value="simulate">Simulateur & Métriques</TabsTrigger>
                    </TabsList>

                    <TabsContent value="adjust" className="space-y-6 mt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Amounts */}
                            <div className="space-y-4 p-4 rounded-lg bg-slate-800/30 border border-slate-700">
                                <h4 className="font-semibold text-emerald-400 flex items-center gap-2"><Wallet className="w-4 h-4"/> Montants</h4>
                                <div>
                                    <Label className="text-xs text-slate-400">Objectif Cible ({currency || 'devise du plan'})</Label>
                                    <Input
                                        type="number"
                                        value={form.targetAmount}
                                        onChange={(e) => handleChange('targetAmount', e.target.value)}
                                        className="bg-slate-900 border-slate-700 mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-400">Solde Actuel (lecture seule)</Label>
                                    <div className="font-mono text-sm text-slate-200 mt-2">{formatAmount(config?.currentBalance, currency)}</div>
                                    <p className="text-[10px] text-slate-500 mt-1">Le solde ne bouge que par un mouvement d'argent tracé, jamais par un ajustement.</p>
                                </div>
                            </div>

                            {/* Terms */}
                            <div className="space-y-4 p-4 rounded-lg bg-slate-800/30 border border-slate-700">
                                <h4 className="font-semibold text-blue-400 flex items-center gap-2"><CalendarDays className="w-4 h-4"/> Modalités</h4>
                                <div>
                                    <Label className="text-xs text-slate-400">Mode de Dépôt</Label>
                                    <Select value={form.depositMode} onValueChange={(v) => handleChange('depositMode', v)}>
                                        <SelectTrigger className="bg-slate-900 border-slate-700 mt-1"><SelectValue/></SelectTrigger>
                                        <SelectContent>
                                            {DEPOSIT_MODES.map(m => (
                                                <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-400">Fréquence</Label>
                                    <Select value={form.frequency} onValueChange={(v) => handleChange('frequency', v)}>
                                        <SelectTrigger className="bg-slate-900 border-slate-700 mt-1"><SelectValue/></SelectTrigger>
                                        <SelectContent>
                                            {FREQUENCIES.map(f => (
                                                <SelectItem key={f} value={f}>{frequencyLabel(f)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="md:col-span-2 space-y-2 p-4 rounded-lg bg-slate-800/30 border border-slate-700">
                                <Label className="text-xs text-slate-400">Montant du Dépôt Périodique ({currency || 'devise du plan'})</Label>
                                <div className="flex gap-4 items-center">
                                    <Input
                                        type="number"
                                        value={form.periodicDeposit}
                                        onChange={(e) => handleChange('periodicDeposit', e.target.value)}
                                        className="bg-slate-900 border-slate-700 flex-1"
                                        placeholder="Montant prévu par versement"
                                    />
                                    <div className="text-xs text-slate-500 max-w-[220px]">Le serveur s'en sert pour projeter la croissance à l'enregistrement.</div>
                                </div>
                            </div>

                            <div className="md:col-span-2">
                                <Label className="text-xs text-slate-400">Motif (optionnel)</Label>
                                <Textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="bg-slate-900 border-slate-700 mt-1 text-sm"
                                    placeholder="Justification consignée dans le journal…"
                                />
                            </div>
                        </div>

                        {serverErrors.length > 0 && <ErrorPanel errors={serverErrors} title="Ajustement refusé par le serveur" />}

                        <div className="flex justify-end pt-4 border-t border-slate-700">
                            <Button onClick={saveAdjustments} disabled={submitting} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                                <Save className="w-4 h-4 mr-2" /> {submitting ? 'Envoi…' : 'Enregistrer Ajustements'}
                            </Button>
                        </div>
                    </TabsContent>

                    <TabsContent value="simulate" className="mt-6 space-y-6">
                        {/* Metrics Cards — TOUTES servies par le serveur */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                <p className="text-xs text-slate-400">Reste à Épargner</p>
                                <p className="text-lg font-bold text-white">{formatAmount(metrics.remaining, currency)}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                <p className="text-xs text-slate-400">Dépôts Nécessaires</p>
                                <p className="text-lg font-bold text-blue-400">{depositsNeededLabel(metrics.depositsNeeded)}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                <p className="text-xs text-slate-400">Maturité Projetée</p>
                                <p className="text-lg font-bold text-emerald-400">{metrics.projectedMaturity ? new Date(metrics.projectedMaturity).toLocaleDateString('fr-FR') : 'N/A'}</p>
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-700 overflow-hidden bg-slate-900/50">
                            <div className="bg-slate-800 p-2 text-xs font-semibold text-slate-300 px-4">
                                Simulation de Croissance (projetée par le serveur)
                            </div>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-slate-800 bg-slate-900/50">
                                            <TableHead className="w-16">#</TableHead>
                                            <TableHead>Date Prévue</TableHead>
                                            <TableHead className="text-right">Dépôt</TableHead>
                                            <TableHead className="text-right">Solde Projeté</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {projection.length > 0 ? (
                                            projection.map((row) => (
                                                <TableRow key={row.num} className="border-slate-800 text-xs">
                                                    <TableCell className="text-slate-500">{row.num}</TableCell>
                                                    <TableCell>{new Date(row.date).toLocaleDateString('fr-FR')}</TableCell>
                                                    <TableCell className="text-right font-mono text-emerald-500">+{formatAmount(row.deposit, currency)}</TableCell>
                                                    <TableCell className="text-right font-mono font-medium text-white">{formatAmount(row.projected, currency)}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow><TableCell colSpan={4} className="text-center py-6 text-slate-500">Définissez un dépôt périodique puis enregistrez : le serveur renverra la projection.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                        <div className="text-xs text-slate-500 italic text-center">
                            * Projection serveur : dépôts réguliers sans intérêt ni retrait. Le mode actuel est « {depositModeLabel(config?.depositMode)} ».
                        </div>
                    </TabsContent>
                </Tabs>
                )}
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Fermer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default SavingsAdjustmentModal;
