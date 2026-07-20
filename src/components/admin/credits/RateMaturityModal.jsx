import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { api } from '@/services/api';
import SimulateurMoteur from '@/components/analyse/simulateur/SimulateurMoteur';
import { formatMontant } from '@/components/guarantees/format';
import {
    Calculator, CalendarClock, Ban, PauseCircle, PlayCircle, Save, AlertTriangle,
    TrendingUp, Percent, FlaskConical
} from 'lucide-react';

// Statuts considérés « actifs » (affiche Suspendre/Bloquer plutôt que Réactiver).
const ACTIVE_STATES = ['Active', 'En cours', 'Approuvé', 'En traitement'];

/**
 * Code de la demande de crédit sur laquelle le moteur d'analyse s'exécute.
 *
 * `portfolio/serializers.py::loan_row` sert `applicationCode` : il vaut le code de
 * la demande pour un prêt issu du pipeline, et la chaîne vide pour un prêt saisi
 * manuellement (aucune demande, donc aucun dossier à analyser). Quand le champ est
 * absent — source de données qui ne le porte pas — on retombe sur la référence du
 * prêt, qui lui est égale pour les prêts issus d'une demande
 * (`portfolio/services.py`, `reference=app.code`). On ne devine rien de plus.
 */
const codeDemande = (credit) => {
    if (!credit) return null;
    if (credit.applicationCode !== undefined) return credit.applicationCode || null;
    return credit.id || null;
};

const RateMaturityModal = ({ isOpen, onOpenChange, credit }) => {
    const { toast } = useToast();
    const [config, setConfig] = useState({
        rate: 0,
        duration: 0,
        frequency: 'monthly',
        status: 'Active',
        startDate: new Date().toISOString().split('T')[0]
    });
    const [history, setHistory] = useState([]);
    const [confirmAction, setConfirmAction] = useState(null);

    // Charge la config + l'historique depuis le backend (repli sur les props du crédit).
    useEffect(() => {
        if (!credit || !isOpen) return;
        let alive = true;
        const fallback = () => setConfig({
            rate: credit.rate || 0,
            duration: credit.duration || 12,
            frequency: credit.frequency || 'monthly',
            status: credit.status || 'Active',
            startDate: credit.startDate || new Date().toISOString().split('T')[0],
        });
        api.portfolio.config(credit.id).then((data) => {
            if (!alive) return;
            const c = data.currentConfig || {};
            setConfig({
                rate: c.rate ?? credit.rate ?? 0,
                duration: c.duration ?? credit.duration ?? 12,
                frequency: c.frequency || 'monthly',
                status: c.status || credit.status || 'Active',
                startDate: c.startDate || new Date().toISOString().split('T')[0],
            });
            setHistory(data.history || []);
        }).catch(() => { if (alive) { fallback(); setHistory([]); } });
        return () => { alive = false; };
    }, [credit, isOpen]);

    const handleConfigChange = (field, value) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    // L'échéancier « de simulation » calculé ici (amortissement constant, intérêt
    // simple, TAEG estimé) a été SUPPRIMÉ. Il produisait, dans le même modal que
    // les chiffres serveur, un second tableau d'amortissement et un second coût du
    // crédit — deux réalités pour un même dossier, dont aucune n'était opposable.
    // Le simulateur de l'analyste est désormais l'onglet « Simulateur d'analyse » :
    // il ajuste durée / différé / taux, appelle le moteur, et affiche CE QUE LE
    // SERVEUR RENVOIE (SPEC §8c, annexe A pour les formules du moteur).

    // Actions — persistées côté backend (audit inclus).
    const saveChanges = async (actionType = "Modification") => {
        if (config.rate < 0) {
            toast({ variant: "destructive", title: "Erreur", description: "Le taux ne peut pas être négatif." });
            return;
        }
        if (config.duration <= 0) {
            toast({ variant: "destructive", title: "Erreur", description: "La durée doit être supérieure à 0." });
            return;
        }
        try {
            const data = await api.portfolio.saveConfig(credit.id, {
                rate: config.rate, duration: config.duration, frequency: config.frequency,
                status: config.status, startDate: config.startDate, action: actionType,
            });
            setHistory(data.history || []);
            if (data.currentConfig?.status) setConfig((c) => ({ ...c, status: data.currentConfig.status }));
            toast({ title: "Configuration enregistrée", description: "Les paramètres du crédit ont été mis à jour." });
        } catch (e) {
            toast({ variant: "destructive", title: "Échec", description: e.message });
        }
        setConfirmAction(null);
    };

    const handleActionClick = (action) => {
        setConfirmAction(action);
    };

    // Bloquer / suspendre / réactiver — actions RÉELLEMENT persistées par
    // `POST /api/portfolio/loans/<ref>/action` (`portfolio/services.py::run_action`,
    // branches `block`, `pause|suspend`, `resume`). C'est le serveur qui écrit le
    // statut et, pour `block`, met le taux à 0 : le front n'anticipe plus rien.
    //
    // Historique — ces trois actions écrivaient dans `localStorage` puis
    // affichaient « Action effectuée ». L'utilisateur croyait avoir bloqué un
    // prêt qui restait actif en base, et le mensonge survivait au rechargement
    // de page tant que le cache local n'était pas vidé.
    //
    // Dette croisée assumée et signalée : `/action` écrit `loan.status` sans
    // passer par `credits/workflow.py`, donc sans maker ≠ checker ni contrôle de
    // délégation (CREDIT_MODULE_STATUS.md §8.4). L'action est authentiquement
    // persistée — elle n'est pas pour autant sous le régime de séparation des
    // tâches du module crédit.
    const [actionBusy, setActionBusy] = useState(false);

    const executeAction = async () => {
        if (!confirmAction) return;
        setActionBusy(true);
        try {
            const res = await api.portfolio.action(credit.id, confirmAction);
            // On relit la configuration servie par le backend plutôt que de
            // deviner le nouvel état : le serveur seul sait ce qu'il a écrit.
            try {
                const data = await api.portfolio.config(credit.id);
                const c = data.currentConfig || {};
                setConfig((prev) => ({
                    ...prev,
                    rate: c.rate ?? prev.rate,
                    duration: c.duration ?? prev.duration,
                    frequency: c.frequency || prev.frequency,
                    status: c.status || prev.status,
                    startDate: c.startDate || prev.startDate,
                }));
                setHistory(data.history || []);
            } catch {
                // La relecture a échoué : on ne fabrique pas d'état local optimiste.
                // Le statut affiché reste celui de la dernière lecture serveur réussie.
            }
            setConfirmAction(null);
            toast({ title: 'Action enregistrée', description: res?.detail || 'Le serveur a appliqué la transition.' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Action refusée', description: e.message });
        } finally {
            setActionBusy(false);
        }
    };

    if (!credit) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-6xl border-slate-700 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <Calculator className="w-6 h-6 text-emerald-400" />
                        Configuration Taux & Maturité
                        <Badge variant="outline" className={`ml-2 ${
                            config.status === 'Active' ? 'text-emerald-400 border-emerald-500/30' : 
                            config.status === 'Blocked' ? 'text-red-400 border-red-500/30' : 
                            'text-amber-400 border-amber-500/30'
                        }`}>
                            {config.status}
                        </Badge>
                    </DialogTitle>
                    <DialogDescription>
                        Dossier: <span className="text-white font-medium">{credit.id}</span> - {credit.operator} ({formatMontant(credit.amountApproved, credit.currency, { decimals: 0 })})
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="simulateur" className="w-full mt-4">
                    <TabsList className="grid w-full grid-cols-3 bg-slate-800/50">
                        <TabsTrigger value="simulateur" className="flex items-center gap-2">
                            <FlaskConical className="w-3.5 h-3.5" /> Simulateur d'analyse
                        </TabsTrigger>
                        <TabsTrigger value="settings">Paramètres du prêt</TabsTrigger>
                        <TabsTrigger value="history">Historique & Audit</TabsTrigger>
                    </TabsList>

                    {/* Simulateur de l'analyste (SPEC §8c) — tous les chiffres viennent du moteur. */}
                    <TabsContent value="simulateur" className="mt-6">
                        <SimulateurMoteur code={codeDemande(credit)} credit={credit} actif={isOpen} />
                    </TabsContent>

                    <TabsContent value="settings" className="space-y-6 mt-6">
                        <p className="text-xs text-slate-400">
                            Caractéristiques contractuelles du prêt au portefeuille. Elles ne
                            déclenchent aucune analyse : pour simuler l'effet d'une durée, d'un
                            différé ou d'un taux sur le DSCR, utilisez l'onglet
                            « Simulateur d'analyse ».
                        </p>
                        {/* Settings Form */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* `contents` : les trois cartes deviennent directement les cellules
                                de la grille depuis que la colonne de simulation locale a disparu. */}
                            <div className="contents">
                                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-4">
                                    <h4 className="font-semibold text-emerald-400 flex items-center gap-2"><Percent className="w-4 h-4"/> Taux d'Intérêt</h4>
                                    <div>
                                        <Label className="text-xs text-slate-400">Taux Mensuel (%)</Label>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Input 
                                                type="number" 
                                                step="0.01" 
                                                value={config.rate} 
                                                onChange={(e) => handleConfigChange('rate', e.target.value)}
                                                className="bg-slate-900 border-slate-700 font-mono text-lg"
                                            />
                                        </div>
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        Taux annuel approx: <span className="text-slate-300">{(config.rate * 12).toFixed(2)}%</span>
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-4">
                                    <h4 className="font-semibold text-blue-400 flex items-center gap-2"><CalendarClock className="w-4 h-4"/> Maturité</h4>
                                    <div>
                                        <Label className="text-xs text-slate-400">Durée (Mois)</Label>
                                        <Input 
                                            type="number" 
                                            value={config.duration} 
                                            onChange={(e) => handleConfigChange('duration', e.target.value)}
                                            className="bg-slate-900 border-slate-700 mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs text-slate-400">Date d'effet</Label>
                                        <Input 
                                            type="date" 
                                            value={config.startDate} 
                                            onChange={(e) => handleConfigChange('startDate', e.target.value)}
                                            className="bg-slate-900 border-slate-700 mt-1"
                                        />
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-4">
                                    <h4 className="font-semibold text-purple-400 flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Remboursement</h4>
                                    <div>
                                        <Label className="text-xs text-slate-400">Fréquence</Label>
                                        <Select value={config.frequency} onValueChange={(val) => handleConfigChange('frequency', val)}>
                                            <SelectTrigger className="bg-slate-900 border-slate-700 mt-1">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="monthly">Mensuel</SelectItem>
                                                <SelectItem value="quarterly">Trimestriel</SelectItem>
                                                <SelectItem value="annual">Annuel</SelectItem>
                                                <SelectItem value="bullet">À terme (In Fine)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>

                        </div>

                        <p className="text-[11px] text-slate-500">
                            Plus aucun échéancier n'est calculé dans le navigateur depuis cet écran.
                            L'échéancier prévisionnel du moteur s'affiche dans l'onglet
                            « Simulateur d'analyse » ; l'échéancier de gestion du prêt reste servi par
                            <code className="mx-1">GET /api/portfolio/loans/&lt;ref&gt;/schedule</code>
                            et s'affiche dans l'onglet « Échéancier » du dossier.
                        </p>



                        {/* Action Bar */}
                        <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-700">
                             <Button onClick={() => saveChanges('Modification')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                <Save className="w-4 h-4 mr-2" /> Enregistrer Configuration
                            </Button>
                            <div className="flex-1"></div>
                            {/* Le statut vient du backend et peut être libellé en français
                                (« En cours », « Suspendu »…) : on teste contre ACTIVE_STATES
                                plutôt que contre le seul littéral 'Active', sinon un prêt actif
                                affiche « Réactiver ». */}
                            {ACTIVE_STATES.includes(config.status) ? (
                                <>
                                    <Button variant="outline" onClick={() => handleActionClick('suspend')} className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
                                        <PauseCircle className="w-4 h-4 mr-2" /> Suspendre
                                    </Button>
                                    <Button variant="destructive" onClick={() => handleActionClick('block')} className="bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/50">
                                        <Ban className="w-4 h-4 mr-2" /> Bloquer (Taux 0%)
                                    </Button>
                                </>
                            ) : (
                                <Button onClick={() => handleActionClick('resume')} className="bg-blue-600 hover:bg-blue-700 text-white">
                                    <PlayCircle className="w-4 h-4 mr-2" /> Réactiver / Reprendre
                                </Button>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="history" className="mt-6">
                        <div className="rounded-lg border border-slate-700 overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-slate-800 bg-slate-900/50">
                                        <TableHead>Date</TableHead>
                                        <TableHead>Action</TableHead>
                                        <TableHead>Utilisateur</TableHead>
                                        <TableHead>Détails</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.length > 0 ? (
                                        history.map((item, idx) => (
                                            <TableRow key={idx} className="border-slate-800">
                                                <TableCell className="text-xs text-slate-400">{new Date(item.date).toLocaleString()}</TableCell>
                                                <TableCell className="font-medium text-white">{item.action}</TableCell>
                                                <TableCell className="text-xs">{item.user}</TableCell>
                                                <TableCell className="text-xs text-slate-300">{item.details}</TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center py-8 text-slate-500">Aucun historique disponible.</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>
                </Tabs>
                
                {/* Confirmation Alert/Dialog (Inline for simplicity) */}
                {confirmAction && (
                    <Alert className="mt-4 border-amber-500/50 bg-amber-900/10 text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Confirmation requise</AlertTitle>
                        <AlertDescription className="flex flex-col gap-2 mt-2">
                            <p>
                                Êtes-vous sûr de vouloir <strong>{confirmAction === 'block' ? 'Bloquer' : confirmAction === 'suspend' ? 'Suspendre' : 'Réactiver'}</strong> ce crédit ?
                                {confirmAction === 'block' && " Cela mettra le taux à 0%."}
                            </p>
                            <p className="text-xs text-amber-300/70">
                                La transition est écrite par le serveur (portefeuille). Elle ne passe pas
                                par la machine à états du module crédit : ni maker ≠ checker, ni contrôle
                                de délégation ne s'y appliquent.
                            </p>
                            <div className="flex gap-2 mt-2">
                                <Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => setConfirmAction(null)} className="hover:bg-amber-900/20">Annuler</Button>
                                <Button size="sm" disabled={actionBusy} onClick={executeAction} className="bg-amber-600 hover:bg-amber-700 text-white">
                                    {actionBusy ? 'Enregistrement…' : 'Confirmer'}
                                </Button>
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
                
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Fermer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RateMaturityModal;