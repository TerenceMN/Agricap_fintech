import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import { 
    Percent, History, Ban, PauseCircle, PlayCircle, Save, AlertTriangle, ShieldCheck
} from 'lucide-react';

const SavingsRateModal = ({ isOpen, onOpenChange, savings }) => {
    const { toast } = useToast();
    const [config, setConfig] = useState({
        annualRate: 0,
        monthlyRate: 0,
        effectiveDate: new Date().toISOString().split('T')[0],
        status: 'Actif'
    });
    const [history, setHistory] = useState([]);
    const [confirmAction, setConfirmAction] = useState(null);

    // Load Data
    useEffect(() => {
        if (savings) {
            const savedData = localStorage.getItem(`savings_rate_config_${savings.id}`);
            if (savedData) {
                const parsed = JSON.parse(savedData);
                setConfig(parsed.currentConfig);
                setHistory(parsed.history || []);
            } else {
                // Default from savings prop or safe defaults
                const rate = savings.rate || 0;
                setConfig({
                    annualRate: rate,
                    monthlyRate: (rate / 12).toFixed(4),
                    effectiveDate: new Date().toISOString().split('T')[0],
                    status: savings.status || 'Actif'
                });
                setHistory([]);
            }
        }
    }, [savings, isOpen]);

    const handleRateChange = (val) => {
        // Validation: Max 6%
        if (val > 6) {
            toast({ variant: "destructive", title: "Limite dépassée", description: "Le taux ne peut excéder 6%." });
            return;
        }
        setConfig(prev => ({
            ...prev,
            annualRate: val,
            monthlyRate: (val / 12).toFixed(4)
        }));
    };

    const saveChanges = (actionType = "Modification Taux") => {
        if (config.annualRate < 0) {
            toast({ variant: "destructive", title: "Erreur", description: "Le taux ne peut pas être négatif." });
            return;
        }

        const newEntry = {
            date: new Date().toISOString(),
            action: actionType,
            user: 'Admin',
            details: `Taux Annuel: ${config.annualRate}%, Statut: ${config.status}`
        };

        const updatedHistory = [newEntry, ...history];
        const payload = {
            currentConfig: config,
            history: updatedHistory
        };

        localStorage.setItem(`savings_rate_config_${savings.id}`, JSON.stringify(payload));
        setHistory(updatedHistory);
        toast({ title: "Configuration enregistrée", description: "Les paramètres d'intérêts ont été mis à jour." });
        setConfirmAction(null);
    };

    const executeAction = () => {
        let newStatus = config.status;
        let newRate = config.annualRate;
        let actionLabel = "";

        switch (confirmAction) {
            case 'block':
                newStatus = 'Bloqué';
                newRate = 0;
                actionLabel = "Blocage (Taux 0%)";
                break;
            case 'suspend':
                newStatus = 'Suspendu';
                actionLabel = "Suspension Temporaire";
                break;
            case 'resume':
                newStatus = 'Actif';
                actionLabel = "Réactivation";
                break;
            default:
                actionLabel = "Modification";
        }

        const nextConfig = { 
            ...config, 
            status: newStatus, 
            annualRate: newRate,
            monthlyRate: (newRate / 12).toFixed(4)
        };
        
        const newEntry = {
            date: new Date().toISOString(),
            action: actionLabel,
            user: 'Admin',
            details: `Statut changé à ${newStatus}. Taux: ${newRate}%`
        };
        
        const updatedHistory = [newEntry, ...history];
        localStorage.setItem(`savings_rate_config_${savings.id}`, JSON.stringify({ currentConfig: nextConfig, history: updatedHistory }));
        
        setConfig(nextConfig);
        setHistory(updatedHistory);
        setConfirmAction(null);
        toast({ title: "Action effectuée", description: `Le plan est maintenant: ${newStatus}` });
    };

    if (!savings) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-2xl border-slate-700 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <Percent className="w-6 h-6 text-emerald-400" />
                        Configuration Taux & Intérêts
                        <Badge variant="outline" className={`ml-2 ${
                            config.status === 'Actif' ? 'text-emerald-400 border-emerald-500/30' : 
                            config.status === 'Bloqué' ? 'text-red-400 border-red-500/30' : 
                            'text-amber-400 border-amber-500/30'
                        }`}>
                            {config.status}
                        </Badge>
                    </DialogTitle>
                    <DialogDescription>
                        Épargne: <span className="text-white font-medium">{savings.id}</span> - {savings.holder}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    {/* Settings */}
                    <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-4">
                            <h4 className="font-semibold text-emerald-400 flex items-center gap-2">Paramètres Actuels</h4>
                            <div>
                                <Label className="text-xs text-slate-400">Taux Annuel (%) - Max 6%</Label>
                                <div className="flex items-center gap-2 mt-1">
                                    <Input 
                                        type="number" 
                                        step="0.01" 
                                        max="6"
                                        value={config.annualRate} 
                                        onChange={(e) => handleRateChange(e.target.value)}
                                        className="bg-slate-900 border-slate-700 font-mono text-lg"
                                        disabled={config.status === 'Bloqué'}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-xs text-slate-400">Taux Mensuel (Eq)</Label>
                                    <div className="font-mono text-sm text-slate-300 mt-1">{config.monthlyRate}%</div>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-400">Date d'effet</Label>
                                    <Input 
                                        type="date" 
                                        value={config.effectiveDate} 
                                        onChange={(e) => setConfig(p => ({...p, effectiveDate: e.target.value}))}
                                        className="bg-slate-900 border-slate-700 mt-1 h-8 text-xs"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="grid grid-cols-2 gap-2">
                             <Button onClick={() => saveChanges()} className="col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                                <Save className="w-4 h-4 mr-2" /> Enregistrer Taux
                            </Button>
                            {config.status === 'Actif' || config.status === 'Suspendu' ? (
                                <>
                                    {config.status === 'Actif' ? (
                                        <Button variant="outline" onClick={() => setConfirmAction('suspend')} className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
                                            <PauseCircle className="w-4 h-4 mr-2" /> Suspendre
                                        </Button>
                                    ) : (
                                        <Button variant="outline" onClick={() => setConfirmAction('resume')} className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
                                            <PlayCircle className="w-4 h-4 mr-2" /> Reprendre
                                        </Button>
                                    )}
                                    <Button variant="destructive" onClick={() => setConfirmAction('block')} className="bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/50">
                                        <Ban className="w-4 h-4 mr-2" /> Bloquer (0%)
                                    </Button>
                                </>
                            ) : (
                                <Button onClick={() => setConfirmAction('resume')} className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white">
                                    <ShieldCheck className="w-4 h-4 mr-2" /> Réactiver Plan
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* History */}
                    <div className="bg-slate-900/30 rounded-lg border border-slate-700 flex flex-col h-[320px]">
                        <div className="p-3 border-b border-slate-700 flex items-center gap-2">
                            <History className="w-4 h-4 text-slate-400" />
                            <span className="font-semibold text-sm">Audit Trail</span>
                        </div>
                        <div className="flex-1 overflow-auto p-0 scrollbar-thin scrollbar-thumb-slate-600">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-slate-800 hover:bg-transparent">
                                        <TableHead className="h-8 text-xs w-24">Date</TableHead>
                                        <TableHead className="h-8 text-xs">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map((h, i) => (
                                        <TableRow key={i} className="border-slate-800/50 text-xs">
                                            <TableCell className="text-slate-400 py-2">{new Date(h.date).toLocaleDateString()}</TableCell>
                                            <TableCell className="py-2">
                                                <div className="font-medium text-white">{h.action}</div>
                                                <div className="text-[10px] text-slate-500 truncate w-32" title={h.details}>{h.details}</div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {history.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-slate-500 py-4">Aucun historique</TableCell></TableRow>}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>

                {confirmAction && (
                    <Alert className="mt-2 border-amber-500/50 bg-amber-900/10 text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Confirmation requise</AlertTitle>
                        <AlertDescription className="flex flex-col gap-2 mt-2">
                            <p>Confirmer l'action : <strong>{confirmAction.toUpperCase()}</strong> ?</p>
                            <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)}>Annuler</Button>
                                <Button size="sm" onClick={executeAction} className="bg-amber-600 hover:bg-amber-700 text-white">Confirmer</Button>
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default SavingsRateModal;