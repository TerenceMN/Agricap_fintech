import React, { useState, useEffect, useMemo } from 'react';
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
import {
    Calculator, CalendarClock, History, Ban, PauseCircle, PlayCircle, Save, AlertTriangle,
    TrendingUp, Percent, CalendarDays, ArrowRight, CheckCircle2
} from 'lucide-react';

// Statuts considérés « actifs » (affiche Suspendre/Bloquer plutôt que Réactiver).
const ACTIVE_STATES = ['Active', 'En cours', 'Approuvé', 'En traitement'];

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

    // Calculation Engine
    const schedule = useMemo(() => {
        if (!credit || !config.duration) return [];

        const principal = credit.amountApproved || credit.amountRequested || 0;
        const rate = parseFloat(config.rate);
        const duration = parseInt(config.duration);
        const freqMap = { 'monthly': 1, 'quarterly': 3, 'annual': 12, 'bullet': duration };
        const freqMonths = freqMap[config.frequency] || 1;
        
        const numberOfPayments = Math.ceil(duration / freqMonths);
        const rows = [];
        let balance = principal;
        let currentDate = new Date(config.startDate);

        for (let i = 1; i <= numberOfPayments; i++) {
            // Advance date
            currentDate.setMonth(currentDate.getMonth() + freqMonths);
            const dateStr = currentDate.toISOString().split('T')[0];

            // Interest calculation (Simple interest on remaining balance for the period)
            // Rate is monthly %
            const interest = balance * (rate / 100) * freqMonths;

            let principalPayment = 0;
            if (config.frequency === 'bullet') {
                principalPayment = i === numberOfPayments ? principal : 0;
            } else {
                // Constant Amortization (Simple assumption for this tool)
                // Real banking apps might use PMT for constant annuity
                principalPayment = principal / numberOfPayments; 
            }

            // Adjust last payment to fix rounding issues
            if (i === numberOfPayments && config.frequency !== 'bullet') {
                principalPayment = balance;
            }

            const totalPayment = principalPayment + interest;
            balance -= principalPayment;

            rows.push({
                number: i,
                date: dateStr,
                principal: principalPayment,
                interest: interest,
                total: totalPayment,
                balance: Math.max(0, balance)
            });
        }
        return rows;
    }, [credit, config]);

    const totals = useMemo(() => {
        const totalPrincipal = schedule.reduce((acc, row) => acc + row.principal, 0);
        const totalInterest = schedule.reduce((acc, row) => acc + row.interest, 0);
        const totalPayments = totalPrincipal + totalInterest;
        const apr = ((totalInterest / totalPrincipal) / (config.duration / 12)) * 100; // Rough APR estimation

        return { totalPrincipal, totalInterest, totalPayments, apr: isNaN(apr) ? 0 : apr };
    }, [schedule, config.duration]);

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

    const executeAction = () => {
        let newStatus = config.status;
        let newRate = config.rate;
        let actionLabel = "";

        switch (confirmAction) {
            case 'block':
                newStatus = 'Blocked';
                newRate = 0;
                actionLabel = "Blocage (Taux 0%)";
                break;
            case 'suspend':
                newStatus = 'Suspended';
                actionLabel = "Suspension Temporaire";
                break;
            case 'resume':
                newStatus = 'Active';
                actionLabel = "Réactivation";
                // Optionally restore rate? For now, user must set rate manually if it was 0
                break;
            default:
                actionLabel = "Modification";
        }

        setConfig(prev => ({ ...prev, status: newStatus, rate: newRate }));
        // We need to wait for state update in a real app, but here we can just construct the object to save
        // Actually saveChanges reads from state 'config', so we need to set state then save. 
        // Better to pass new config to save function or use useEffect. 
        // For simplicity, let's just update the local object passed to save.
        
        // Hack for synchronous save with new values
        const nextConfig = { ...config, status: newStatus, rate: newRate };
        
        // Manual save logic for action
         const newEntry = {
            date: new Date().toISOString(),
            action: actionLabel,
            user: 'Admin',
            details: `Statut changé à ${newStatus}. Taux: ${newRate}%`
        };
        const updatedHistory = [newEntry, ...history];
        localStorage.setItem(`credit_config_${credit.id}`, JSON.stringify({ currentConfig: nextConfig, history: updatedHistory }));
        
        setConfig(nextConfig);
        setHistory(updatedHistory);
        setConfirmAction(null);
        toast({ title: "Action effectuée", description: `Le crédit est maintenant: ${newStatus}` });
    };

    if (!credit) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-4xl border-slate-700 max-h-[90vh] overflow-y-auto">
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
                        Dossier: <span className="text-white font-medium">{credit.id}</span> - {credit.operator} ({credit.amountApproved?.toLocaleString()} {credit.currency})
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="settings" className="w-full mt-4">
                    <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
                        <TabsTrigger value="settings">Paramètres & Simulation</TabsTrigger>
                        <TabsTrigger value="history">Historique & Audit</TabsTrigger>
                    </TabsList>

                    <TabsContent value="settings" className="space-y-6 mt-6">
                        {/* Settings Form */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-4 md:col-span-1">
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

                            {/* Simulation Results */}
                            <div className="md:col-span-2 space-y-4">
                                <div className="grid grid-cols-3 gap-4 mb-4">
                                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                        <p className="text-xs text-slate-400">Total Intérêts</p>
                                        <p className="text-lg font-bold text-emerald-400">{totals.totalInterest.toLocaleString(undefined, { maximumFractionDigits: 2 })} {credit.currency}</p>
                                    </div>
                                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                        <p className="text-xs text-slate-400">Total à Rembourser</p>
                                        <p className="text-lg font-bold text-white">{totals.totalPayments.toLocaleString(undefined, { maximumFractionDigits: 2 })} {credit.currency}</p>
                                    </div>
                                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                        <p className="text-xs text-slate-400">TAEG Estimé</p>
                                        <p className="text-lg font-bold text-blue-400">{totals.apr.toFixed(2)}%</p>
                                    </div>
                                </div>

                                <div className="rounded-lg border border-slate-700 overflow-hidden h-[300px] flex flex-col">
                                    <div className="bg-slate-800 p-2 text-xs font-semibold text-slate-300 flex justify-between items-center px-4">
                                        <span>Tableau d'Amortissement Prévisionnel</span>
                                        <Badge variant="outline" className="text-[10px] h-5">{schedule.length} échéances</Badge>
                                    </div>
                                    <div className="overflow-auto flex-1 bg-slate-900/30">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-slate-800 hover:bg-transparent text-[10px] uppercase">
                                                    <TableHead className="w-10">#</TableHead>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead className="text-right">Principal</TableHead>
                                                    <TableHead className="text-right">Intérêts</TableHead>
                                                    <TableHead className="text-right text-white">Total</TableHead>
                                                    <TableHead className="text-right">Solde</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {schedule.map((row) => (
                                                    <TableRow key={row.number} className="border-slate-800/50 hover:bg-slate-800/30 text-xs">
                                                        <TableCell className="font-mono text-slate-500">{row.number}</TableCell>
                                                        <TableCell>{row.date}</TableCell>
                                                        <TableCell className="text-right font-mono text-slate-300">{row.principal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                        <TableCell className="text-right font-mono text-emerald-500/70">{row.interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                        <TableCell className="text-right font-mono font-medium text-white">{row.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                        <TableCell className="text-right font-mono text-slate-500">{row.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Bar */}
                        <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-700">
                             <Button onClick={() => saveChanges('Modification')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                <Save className="w-4 h-4 mr-2" /> Enregistrer Configuration
                            </Button>
                            <div className="flex-1"></div>
                            {config.status === 'Active' ? (
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
                            <div className="flex gap-2 mt-2">
                                <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)} className="hover:bg-amber-900/20">Annuler</Button>
                                <Button size="sm" onClick={executeAction} className="bg-amber-600 hover:bg-amber-700 text-white">Confirmer</Button>
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