import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { RefreshCw, Save, History, AlertTriangle, TrendingUp, TrendingDown, Calendar as CalendarIcon, Edit, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api, ApiError } from '@/services/api';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'CNY', 'ZAR'];
const TIERS = ['BCC', 'STAFF', 'CLIENT'];

// Marges par défaut au-dessus du taux BCC pour la dérivation automatique — au-delà du
// minimum de 1.5% imposé côté backend (marge de sécurité), afin qu'un arrondi ne fasse
// jamais tomber le taux Client sous le plancher réglementaire.
const DEFAULT_STAFF_MARGIN = 0.02;   // 2%
const DEFAULT_CLIENT_MARGIN = 0.03;  // 3%

// Structure vide (aucun taux configuré) — remplace les DEFAULT_RATES fabriqués : tant
// qu'un admin n'a pas défini de taux réel via /api/fx/rates, l'écran affiche "-" plutôt
// qu'un chiffre inventé.
const EMPTY_RATES = Object.fromEntries(
    CURRENCIES.map(c => [c, { bcc: { buy: 0, sell: 0 }, staff: { buy: 0, sell: 0 }, client: { buy: 0, sell: 0 } }])
);

const RateInputGroup = ({ label, level, rates, onChange }) => (
    <div className="space-y-3 p-4 border rounded-lg bg-slate-800/50">
        <h4 className="font-semibold text-sm text-slate-300 uppercase tracking-wider">{label}</h4>
        <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
                <Label className="text-xs text-slate-400">Achat (Buy)</Label>
                <Input 
                    type="number" 
                    value={rates[level]?.buy || 0} 
                    onChange={(e) => onChange(level, 'buy', parseFloat(e.target.value))}
                    className="bg-slate-900 border-slate-700"
                />
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-slate-400">Vente (Sell)</Label>
                <Input 
                    type="number" 
                    value={rates[level]?.sell || 0} 
                    onChange={(e) => onChange(level, 'sell', parseFloat(e.target.value))}
                    className="bg-slate-900 border-slate-700"
                />
            </div>
        </div>
        {rates[level]?.buy >= rates[level]?.sell && (
            <p className="text-[10px] text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Attention: Marge négative ou nulle
            </p>
        )}
    </div>
);

const ExchangeRateManager = () => {
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [currentRates, setCurrentRates] = useState(EMPTY_RATES);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [editingCurrency, setEditingCurrency] = useState(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [tempRates, setTempRates] = useState({});
    const [syncing, setSyncing] = useState(false);
    const [deriving, setDeriving] = useState(false);
    const { toast } = useToast();

    // Charge les taux réels (backend `fx`) effectifs à la date sélectionnée.
    const loadRates = () => {
        api.fx.rates().then(rows => {
            const byCurrency = { ...EMPTY_RATES };
            let latestUpdate = null;
            rows
                .filter(r => r.effectiveDate === selectedDate)
                .forEach(r => {
                    const tierKey = r.tier.toLowerCase();
                    byCurrency[r.currency] = { ...byCurrency[r.currency], [tierKey]: { buy: r.buy, sell: r.sell } };
                    latestUpdate = r.id; // simple indicateur de présence
                });
            setCurrentRates(byCurrency);
            setLastUpdate(latestUpdate ? new Date().toLocaleTimeString() : null);
        }).catch(() => {});
    };
    useEffect(() => { loadRates(); }, [selectedDate]);

    // Dérive Staff/Client à partir d'un taux BCC fraîchement synchronisé (marges par défaut
    // ci-dessus) — automatique, pas d'étape manuelle séparée : la BCC ne publiant qu'un taux
    // de référence, Staff/Client doivent quand même être calculés, mais ça se fait ici tout
    // seul plutôt que d'exiger 6 saisies manuelles par devise après chaque synchronisation.
    const deriveStaffClientFromBccRows = async (bccRows) => {
        let updated = 0;
        for (const row of bccRows) {
            await api.fx.setRate({
                tier: 'STAFF', currency: row.currency,
                buy: row.buy * (1 + DEFAULT_STAFF_MARGIN), sell: row.sell * (1 + DEFAULT_STAFF_MARGIN),
                effectiveDate: row.effectiveDate,
            });
            await api.fx.setRate({
                tier: 'CLIENT', currency: row.currency,
                buy: row.buy * (1 + DEFAULT_CLIENT_MARGIN), sell: row.sell * (1 + DEFAULT_CLIENT_MARGIN),
                effectiveDate: row.effectiveDate,
            });
            updated += 1;
        }
        return updated;
    };

    const syncFromBcc = async () => {
        setSyncing(true);
        try {
            const synced = await api.fx.syncBcc();
            setDeriving(true);
            const derived = await deriveStaffClientFromBccRows(synced);
            loadRates();
            toast({
                title: "Synchronisé depuis la BCC",
                description: `${synced.length} devise(s) mise(s) à jour depuis le cours indicatif BCC, `
                    + `Staff/Client dérivés automatiquement pour ${derived} devise(s) `
                    + `(+${DEFAULT_STAFF_MARGIN * 100}% / +${DEFAULT_CLIENT_MARGIN * 100}%).`,
            });
        } catch (e) {
            toast({
                variant: 'destructive', title: "Échec de la synchronisation BCC",
                description: `${e instanceof ApiError ? e.message : String(e)} — utilisez le formulaire manuel (bouton Modifier) en attendant.`,
            });
        } finally {
            setSyncing(false);
            setDeriving(false);
        }
    };

    const handleEditClick = (currency) => {
        setEditingCurrency(currency);
        setTempRates(JSON.parse(JSON.stringify(currentRates[currency] || EMPTY_RATES.USD))); // Deep copy
        setIsDialogOpen(true);
    };

    const handleRateChange = (level, type, value) => {
        setTempRates(prev => ({
            ...prev,
            [level]: {
                ...prev[level],
                [type]: value
            }
        }));
    };

    const LEVEL_LABELS = { bcc: 'BCC', staff: 'Staff', client: 'Client' };

    const saveRates = async () => {
        const levels = ['bcc', 'staff', 'client'];
        // Un niveau resté à 0/0 (jamais rempli) est ignoré plutôt que soumis tel quel — sans
        // ça, "Enregistrer" après n'avoir rempli qu'un seul niveau (ex. BCC) échouait sur les
        // deux autres (0 ≤ 0 rejeté par le backend) et abandonnait en laissant un état partiel.
        const toSave = levels.filter(level => tempRates[level].buy > 0 || tempRates[level].sell > 0);
        if (toSave.length === 0) {
            toast({ variant: "destructive", title: "Erreur", description: "Renseignez au moins un niveau (BCC, Staff ou Client)." });
            return;
        }
        for (const level of toSave) {
            if (tempRates[level].buy < 0 || tempRates[level].sell < 0) {
                toast({ variant: "destructive", title: "Erreur", description: "Les taux ne peuvent pas être négatifs." });
                return;
            }
            if (tempRates[level].sell <= tempRates[level].buy) {
                toast({ variant: "destructive", title: "Erreur", description: `Niveau ${LEVEL_LABELS[level]} : le taux de vente doit être supérieur au taux d'achat.` });
                return;
            }
        }
        try {
            for (const level of toSave) {
                await api.fx.setRate({
                    tier: level.toUpperCase(), currency: editingCurrency,
                    buy: tempRates[level].buy, sell: tempRates[level].sell, effectiveDate: selectedDate,
                });
            }
            setIsDialogOpen(false);
            loadRates();
            toast({
                title: "Taux mis à jour",
                description: `Les taux pour ${editingCurrency} ont été enregistrés avec succès.`
            });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const isToday = selectedDate === new Date().toISOString().split('T')[0];

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input 
                            type="date" 
                            value={selectedDate} 
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="pl-10 w-48 bg-slate-800 border-slate-700 text-white"
                        />
                    </div>
                    {isToday && (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                            <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse"></span>
                            Session Active
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-400">
                    <div className="flex items-center gap-2">
                        <History className="w-4 h-4" />
                        <span>Dernière MAJ: <span className="text-white font-mono">{lastUpdate || 'Jamais'}</span></span>
                    </div>
                    <Button size="sm" variant="outline" onClick={syncFromBcc} disabled={syncing || deriving} className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10">
                        <RefreshCw className={`w-4 h-4 mr-2 ${(syncing || deriving) ? 'animate-spin' : ''}`} />
                        {syncing ? 'Synchronisation BCC...' : deriving ? 'Calcul Staff/Client...' : 'Synchroniser depuis la BCC'}
                    </Button>
                </div>
            </div>

            {/* Main Rates Table */}
            <Card className="glass-effect border-slate-800">
                <CardHeader>
                    <CardTitle className="flex justify-between items-center">
                        <span>Tableau des Taux de Change</span>
                        <Badge variant="secondary">Base: Congolese Franc (CDF)</Badge>
                    </CardTitle>
                    <CardDescription>
                        Gestion multi-niveaux des taux journaliers. Les taux sont exprimés pour 1 unité de devise étrangère.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-800 hover:bg-transparent">
                                    <TableHead className="w-[100px] text-white font-bold bg-slate-900/50">Devise</TableHead>
                                    <TableHead className="text-center border-l border-slate-800 bg-blue-950/20 text-blue-200" colSpan={2}>BCC (Officiel)</TableHead>
                                    <TableHead className="text-center border-l border-slate-800 bg-purple-950/20 text-purple-200" colSpan={2}>Staff (Interne)</TableHead>
                                    <TableHead className="text-center border-l border-slate-800 bg-emerald-950/20 text-emerald-200" colSpan={2}>Client (Public)</TableHead>
                                    <TableHead className="text-right bg-slate-900/50">Actions</TableHead>
                                </TableRow>
                                <TableRow className="border-slate-800 text-xs uppercase text-slate-500 hover:bg-transparent">
                                    <TableHead className="bg-slate-900/50"></TableHead>
                                    <TableHead className="text-right border-l border-slate-800 bg-blue-950/10">Achat</TableHead>
                                    <TableHead className="text-right bg-blue-950/10">Vente</TableHead>
                                    <TableHead className="text-right border-l border-slate-800 bg-purple-950/10">Achat</TableHead>
                                    <TableHead className="text-right bg-purple-950/10">Vente</TableHead>
                                    <TableHead className="text-right border-l border-slate-800 bg-emerald-950/10">Achat</TableHead>
                                    <TableHead className="text-right bg-emerald-950/10">Vente</TableHead>
                                    <TableHead className="bg-slate-900/50"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {CURRENCIES.map(currency => {
                                    const rates = currentRates[currency] || EMPTY_RATES.USD; // Fallback safe
                                    return (
                                        <TableRow key={currency} className="border-slate-800 hover:bg-white/5">
                                            <TableCell className="font-bold text-white bg-slate-900/30">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">{currency[0]}</span>
                                                    {currency}
                                                </div>
                                            </TableCell>
                                            
                                            {/* BCC */}
                                            <TableCell className="text-right font-mono border-l border-slate-800 text-blue-300">{rates.bcc?.buy}</TableCell>
                                            <TableCell className="text-right font-mono text-blue-300">{rates.bcc?.sell}</TableCell>
                                            
                                            {/* Staff */}
                                            <TableCell className="text-right font-mono border-l border-slate-800 text-purple-300">{rates.staff?.buy}</TableCell>
                                            <TableCell className="text-right font-mono text-purple-300">{rates.staff?.sell}</TableCell>
                                            
                                            {/* Client */}
                                            <TableCell className="text-right font-mono border-l border-slate-800 text-emerald-400 font-bold">{rates.client?.buy}</TableCell>
                                            <TableCell className="text-right font-mono text-emerald-400 font-bold">{rates.client?.sell}</TableCell>
                                            
                                            <TableCell className="text-right bg-slate-900/30">
                                                {isToday ? (
                                                    <Button variant="ghost" size="sm" onClick={() => handleEditClick(currency)} className="hover:bg-slate-700">
                                                        <Edit className="w-4 h-4 text-slate-400" />
                                                    </Button>
                                                ) : (
                                                    <Badge variant="outline" className="text-xs text-slate-600 border-slate-700">Audit</Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[600px] glass-effect text-white border-slate-700">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <RefreshCw className="w-5 h-5 text-emerald-400" />
                            Mise à jour des taux: {editingCurrency}/CDF
                        </DialogTitle>
                        <DialogDescription>
                            Modifiez les taux pour la date du {selectedDate}. Assurez-vous que le taux de vente est supérieur au taux d'achat.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="grid gap-4 py-4">
                        <RateInputGroup 
                            label="Taux Équilibre BCC (Officiel)" 
                            level="bcc" 
                            rates={tempRates} 
                            onChange={handleRateChange}
                        />
                        <RateInputGroup 
                            label="Taux Staff (Interne)" 
                            level="staff" 
                            rates={tempRates} 
                            onChange={handleRateChange}
                        />
                        <RateInputGroup 
                            label="Taux Client (Commercial)" 
                            level="client" 
                            rates={tempRates} 
                            onChange={handleRateChange}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-slate-600 text-slate-300 hover:bg-slate-800">Annuler</Button>
                        <Button onClick={saveRates} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                            <Save className="w-4 h-4 mr-2" /> Enregistrer les taux
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Alert / Warning Area */}
            <Alert className="bg-blue-900/20 border-blue-900/50 text-blue-200">
                <CheckCircle2 className="h-4 w-4 text-blue-400" />
                <AlertTitle>Politique de Taux</AlertTitle>
                <AlertDescription className="text-xs text-blue-300/80">
                    Les taux clients doivent maintenir une marge minimale de 1.5% par rapport au taux d'équilibre BCC.
                    Toute modification est enregistrée dans le journal d'audit avec l'identifiant de l'opérateur.
                    « Synchroniser depuis la BCC » récupère le taux officiel ET calcule automatiquement les taux
                    Staff (+{DEFAULT_STAFF_MARGIN * 100}%) et Client (+{DEFAULT_CLIENT_MARGIN * 100}%) — modifiables
                    ensuite via « Modifier » si besoin d'une marge différente, ou en cas d'échec de la synchronisation.
                </AlertDescription>
            </Alert>
        </div>
    );
};

export default ExchangeRateManager;