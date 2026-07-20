import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { 
    SlidersHorizontal, TrendingUp, CalendarDays, Wallet, Banknote, Save, ArrowRight
} from 'lucide-react';

const SavingsAdjustmentModal = ({ isOpen, onOpenChange, savings }) => {
    const { toast } = useToast();
    const [config, setConfig] = useState({
        targetAmount: 0,
        currentBalance: 0,
        depositMode: 'virement',
        frequency: 'mensuel',
        periodicDeposit: 0,
        currency: 'USD'
    });
    const [history, setHistory] = useState([]);

    // Init Data
    useEffect(() => {
        if (savings) {
            const savedData = localStorage.getItem(`savings_adjust_config_${savings.id}`);
            if (savedData) {
                const parsed = JSON.parse(savedData);
                setConfig(parsed.currentConfig);
                setHistory(parsed.history || []);
            } else {
                setConfig({
                    targetAmount: savings.goal || 0,
                    currentBalance: savings.balance || 0,
                    depositMode: 'virement',
                    frequency: savings.frequency?.toLowerCase() || 'mensuel',
                    periodicDeposit: 0, // Should be calculated or fetched
                    currency: savings.currency || 'USD'
                });
                setHistory([]);
            }
        }
    }, [savings, isOpen]);

    const handleConfigChange = (field, value) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    // Simulator Logic
    const simulation = useMemo(() => {
        if (!savings || !config.periodicDeposit) return [];
        
        const rows = [];
        let balance = parseFloat(config.currentBalance);
        let deposit = parseFloat(config.periodicDeposit);
        let currentDate = new Date();
        const freqMap = { 'hebdomadaire': 7, 'bimensuel': 15, 'mensuel': 30, 'trimestriel': 90, 'annuel': 365 };
        const daysToAdd = freqMap[config.frequency] || 30;

        // Simulate next 10 occurrences
        for(let i = 1; i <= 10; i++) {
            currentDate.setDate(currentDate.getDate() + daysToAdd);
            balance += deposit;
            rows.push({
                num: i,
                date: currentDate.toISOString().split('T')[0],
                deposit: deposit,
                projected: balance
            });
            if (config.targetAmount > 0 && balance >= config.targetAmount) break;
        }
        return rows;
    }, [config, savings]);

    const metrics = useMemo(() => {
        const remaining = Math.max(0, config.targetAmount - config.currentBalance);
        const depositsNeeded = config.periodicDeposit > 0 ? Math.ceil(remaining / config.periodicDeposit) : '∞';
        const projectedMaturity = typeof depositsNeeded === 'number' && simulation.length > 0 
            ? simulation[Math.min(depositsNeeded, simulation.length) - 1]?.date 
            : 'N/A';
        
        return { remaining, depositsNeeded, projectedMaturity };
    }, [config, simulation]);

    const saveAdjustments = () => {
        const newEntry = {
            date: new Date().toISOString(),
            action: 'Ajustement',
            details: `Cible: ${config.targetAmount}, Solde: ${config.currentBalance}, Freq: ${config.frequency}`
        };
        const updatedHistory = [newEntry, ...history];
        
        localStorage.setItem(`savings_adjust_config_${savings.id}`, JSON.stringify({
            currentConfig: config,
            history: updatedHistory
        }));
        
        setHistory(updatedHistory);
        toast({ title: "Modifications enregistrées", description: "Le plan d'épargne a été ajusté." });
    };

    if (!savings) return null;

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
                                    <Label className="text-xs text-slate-400">Objectif Cible ({config.currency})</Label>
                                    <Input 
                                        type="number" 
                                        value={config.targetAmount} 
                                        onChange={(e) => handleConfigChange('targetAmount', e.target.value)}
                                        className="bg-slate-900 border-slate-700 mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-400">Solde Actuel (Ajustement Admin)</Label>
                                    <Input 
                                        type="number" 
                                        value={config.currentBalance} 
                                        onChange={(e) => handleConfigChange('currentBalance', e.target.value)}
                                        className="bg-slate-900 border-slate-700 mt-1"
                                    />
                                </div>
                            </div>

                            {/* Terms */}
                            <div className="space-y-4 p-4 rounded-lg bg-slate-800/30 border border-slate-700">
                                <h4 className="font-semibold text-blue-400 flex items-center gap-2"><CalendarDays className="w-4 h-4"/> Modalités</h4>
                                <div>
                                    <Label className="text-xs text-slate-400">Mode de Dépôt</Label>
                                    <Select value={config.depositMode} onValueChange={(v) => handleConfigChange('depositMode', v)}>
                                        <SelectTrigger className="bg-slate-900 border-slate-700 mt-1"><SelectValue/></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="virement">Virement Bancaire</SelectItem>
                                            <SelectItem value="especes">Espèces</SelectItem>
                                            <SelectItem value="cheque">Chèque</SelectItem>
                                            <SelectItem value="prelevement">Prélèvement Auto</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-400">Fréquence</Label>
                                    <Select value={config.frequency} onValueChange={(v) => handleConfigChange('frequency', v)}>
                                        <SelectTrigger className="bg-slate-900 border-slate-700 mt-1"><SelectValue/></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="hebdomadaire">Hebdomadaire</SelectItem>
                                            <SelectItem value="bimensuel">Bimensuel</SelectItem>
                                            <SelectItem value="mensuel">Mensuel</SelectItem>
                                            <SelectItem value="trimestriel">Trimestriel</SelectItem>
                                            <SelectItem value="annuel">Annuel</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="md:col-span-2 space-y-2 p-4 rounded-lg bg-slate-800/30 border border-slate-700">
                                 <Label className="text-xs text-slate-400">Montant du Dépôt Périodique ({config.currency})</Label>
                                 <div className="flex gap-4 items-center">
                                    <Input 
                                        type="number" 
                                        value={config.periodicDeposit} 
                                        onChange={(e) => handleConfigChange('periodicDeposit', e.target.value)}
                                        className="bg-slate-900 border-slate-700 flex-1"
                                        placeholder="Montant prévu par versement"
                                    />
                                    <div className="text-xs text-slate-500 max-w-[200px]">Utilisé pour la simulation de croissance.</div>
                                 </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-slate-700">
                            <Button onClick={saveAdjustments} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                                <Save className="w-4 h-4 mr-2" /> Enregistrer Ajustements
                            </Button>
                        </div>
                    </TabsContent>

                    <TabsContent value="simulate" className="mt-6 space-y-6">
                         {/* Metrics Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                <p className="text-xs text-slate-400">Reste à Épargner</p>
                                <p className="text-lg font-bold text-white">{metrics.remaining.toLocaleString()} {config.currency}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                <p className="text-xs text-slate-400">Dépôts Nécessaires</p>
                                <p className="text-lg font-bold text-blue-400">{metrics.depositsNeeded}</p>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                <p className="text-xs text-slate-400">Maturité Projetée</p>
                                <p className="text-lg font-bold text-emerald-400">{metrics.projectedMaturity ? new Date(metrics.projectedMaturity).toLocaleDateString() : 'N/A'}</p>
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-700 overflow-hidden bg-slate-900/50">
                             <div className="bg-slate-800 p-2 text-xs font-semibold text-slate-300 px-4">
                                Simulation de Croissance (Prochains versements)
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
                                        {simulation.length > 0 ? (
                                            simulation.map((row) => (
                                                <TableRow key={row.num} className="border-slate-800 text-xs">
                                                    <TableCell className="text-slate-500">{row.num}</TableCell>
                                                    <TableCell>{new Date(row.date).toLocaleDateString()}</TableCell>
                                                    <TableCell className="text-right font-mono text-emerald-500">+{row.deposit.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-mono font-medium text-white">{row.projected.toLocaleString()} {config.currency}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow><TableCell colSpan={4} className="text-center py-6 text-slate-500">Veuillez définir un montant de dépôt périodique pour voir la simulation.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                        <div className="text-xs text-slate-500 italic text-center">
                            * Simulation basée sur un taux d'intérêt constant (non inclus ici) et des dépôts réguliers sans retraits.
                        </div>
                    </TabsContent>
                </Tabs>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Fermer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default SavingsAdjustmentModal;