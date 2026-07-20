import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileDown, Scale, Landmark, PiggyBank, TrendingUp, HeartHandshake as Handshake, Truck, Briefcase, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from '@/services/api';
import { exportToExcel } from '@/lib/export.js';

const financialStatements = {
  bilan: { label: "Bilan", icon: Scale }, resultat: { label: "Compte de résultat", icon: Briefcase },
  sig: { label: "Résultat des Activités", icon: TrendingUp },
  cashflow: { label: "Flux de trésorerie", icon: Truck }, balance: { label: "Balance", icon: Landmark }, grandlivre: { label: "Grand livre", icon: BookOpen },
  provisions: { label: "Provisions de crédit", icon: PiggyBank }, creances: { label: "Créances clients", icon: Handshake },
};

const FinancialStatementsViewer = () => {
    const [selectedStatement, setSelectedStatement] = useState('bilan');
    const [chartAccounts, setChartAccounts] = useState([]);
    const [selectedLedgerAccount, setSelectedLedgerAccount] = useState('');
    const [ledgerLines, setLedgerLines] = useState([]);
    const [trialBalance, setTrialBalance] = useState([]);
    const [bilan, setBilan] = useState({ actif: [], passif: [] });
    const [resultat, setResultat] = useState({ charges: [], produits: [] });
    const [sig, setSig] = useState({ rows: [] });
    const [cashflow, setCashflow] = useState({ categories: [], variationTresorerie: 0 });
    const [provisions, setProvisions] = useState({ rows: [] });
    const [creances, setCreances] = useState({ rows: [] });
    const [closingRate, setClosingRate] = useState(null);
    const { toast } = useToast();

    useEffect(() => {
        api.fx.current('CLIENT', 'USD').then(r => setClosingRate(r.sell)).catch(() => {});
        api.ledger.accounts.list().then(rows => {
            setChartAccounts(rows);
            if (rows.length && !selectedLedgerAccount) setSelectedLedgerAccount(rows[0].code);
        }).catch(() => {});
        api.ledger.trialBalance().then(setTrialBalance).catch(() => {});
        api.ledger.statements('bilan').then(setBilan).catch(() => {});
        api.ledger.statements('resultat').then(setResultat).catch(() => {});
        api.ledger.statements('sig').then(setSig).catch(() => {});
        api.ledger.statements('cashflow').then(setCashflow).catch(() => {});
        api.ledger.statements('provisions').then(setProvisions).catch(() => {});
        api.ledger.statements('creances').then(setCreances).catch(() => {});
    }, []);

    useEffect(() => {
        if (selectedLedgerAccount) api.ledger.accountLines(selectedLedgerAccount).then(setLedgerLines).catch(() => {});
    }, [selectedLedgerAccount]);

    const renderBilan = () => {
        const renderSection = (title, rows) => {
            const total = rows.reduce((sum, item) => sum + item.balance, 0);
            return (
                <>
                    <TableRow className="bg-slate-800/50">
                        <TableHead colSpan={4} className="text-white font-bold">{title}</TableHead>
                    </TableRow>
                    {rows.map(item => (
                        <TableRow key={item.code} className="border-slate-800">
                            <TableCell className="font-mono text-slate-500">{item.code}</TableCell>
                            <TableCell>{item.name}</TableCell>
                            <TableCell className="text-right font-mono">{item.debit.toLocaleString()} / {item.credit.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-emerald-400">{item.balance.toLocaleString()}</TableCell>
                        </TableRow>
                    ))}
                    <TableRow className="bg-slate-800/30 font-bold">
                        <TableCell colSpan={3} className="text-right text-white">Total {title}</TableCell>
                        <TableCell className="text-right text-emerald-300">{total.toLocaleString()}</TableCell>
                    </TableRow>
                </>
            );
        };
        return (
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Code</TableHead><TableHead>Intitulé</TableHead>
                        <TableHead className="text-right">Débit / Crédit</TableHead>
                        <TableHead className="text-right">Solde</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {renderSection('Actif', bilan.actif)}
                    {renderSection('Passif', bilan.passif)}
                    {bilan.actif.length === 0 && bilan.passif.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-slate-500 py-8">Aucune écriture comptabilisée pour l'instant.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
        );
    };

    const renderResultat = () => {
        const renderSection = (title, rows) => {
            const total = rows.reduce((sum, item) => sum + item.balance, 0);
            return (
                <>
                    <TableRow className="bg-slate-800/50"><TableHead colSpan={3} className="text-white font-bold">{title}</TableHead></TableRow>
                    {rows.map(item => (
                        <TableRow key={item.code} className="border-slate-800">
                            <TableCell>{item.name}</TableCell>
                            <TableCell className="text-right font-mono">{item.code}</TableCell>
                            <TableCell className="text-right font-mono text-emerald-400">{item.balance.toLocaleString()}</TableCell>
                        </TableRow>
                    ))}
                    <TableRow className="bg-slate-800/30 font-bold">
                        <TableCell colSpan={2} className="text-right text-white">Total {title}</TableCell>
                        <TableCell className="text-right text-emerald-300">{total.toLocaleString()}</TableCell>
                    </TableRow>
                </>
            );
        };
        // `balance` est déjà normal-signé côté backend (positif = sens attendu) : produits
        // et charges sont tous deux positifs, le résultat net est une simple soustraction.
        const totalProduits = resultat.produits.reduce((sum, item) => sum + item.balance, 0);
        const totalCharges = resultat.charges.reduce((sum, item) => sum + item.balance, 0);
        const resultatNet = totalProduits - totalCharges;

        return (
            <Table>
                <TableHeader><TableRow><TableHead>Rubrique</TableHead><TableHead className="text-right">Code</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
                <TableBody>
                    {renderSection('Produits', resultat.produits)}
                    {renderSection('Charges', resultat.charges)}
                    <TableRow className="bg-slate-900 font-extrabold text-lg">
                        <TableCell colSpan={2} className="text-right text-white">RÉSULTAT NET</TableCell>
                        <TableCell className={`text-right ${resultatNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>{resultatNet.toLocaleString()}</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        );
    };

    const renderSIG = () => (
        <Table>
            <TableHeader><TableRow><TableHead>Solde intermédiaire de gestion</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
            <TableBody>
                {sig.rows.map(row => (
                    <TableRow key={row.label} className="border-slate-800">
                        <TableCell>{row.label}</TableCell>
                        <TableCell className={`text-right font-mono ${row.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{row.amount.toLocaleString()}</TableCell>
                    </TableRow>
                ))}
                {sig.rows.length === 0 && (
                    <TableRow><TableCell colSpan={2} className="text-center text-slate-500 py-8">Aucune écriture comptabilisée pour l'instant.</TableCell></TableRow>
                )}
            </TableBody>
        </Table>
    );

    const renderCashflow = () => (
        <Table>
            <TableHeader><TableRow><TableHead>Catégorie de flux</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
            <TableBody>
                {cashflow.categories.map(cat => (
                    <TableRow key={cat.key} className="border-slate-800">
                        <TableCell>{cat.label}</TableCell>
                        <TableCell className={`text-right font-mono ${cat.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{cat.amount.toLocaleString()}</TableCell>
                    </TableRow>
                ))}
                <TableRow className="bg-slate-900 font-extrabold text-lg">
                    <TableCell className="text-white">VARIATION NETTE DE TRÉSORERIE</TableCell>
                    <TableCell className={`text-right ${cashflow.variationTresorerie >= 0 ? 'text-green-400' : 'text-red-400'}`}>{cashflow.variationTresorerie.toLocaleString()}</TableCell>
                </TableRow>
            </TableBody>
        </Table>
    );

    const renderBalance = () => (
        <Table>
            <TableHeader><TableRow><TableHead>Compte</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead></TableRow></TableHeader>
            <TableBody>
                {trialBalance.map(item => (
                    <TableRow key={item.code} className="border-slate-800">
                        <TableCell className="font-mono text-slate-500">{item.code}</TableCell><TableCell>{item.name}</TableCell>
                        <TableCell className="text-right font-mono text-green-400">{item.debit.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-red-400">{item.credit.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-white">{item.balance.toLocaleString()}</TableCell>
                    </TableRow>
                ))}
                {trialBalance.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-8">Aucune écriture comptabilisée pour l'instant.</TableCell></TableRow>
                )}
            </TableBody>
        </Table>
    );

    const renderGrandLivre = () => (
        <div>
             <div className="w-full sm:w-64 mb-4">
                <Select value={selectedLedgerAccount} onValueChange={setSelectedLedgerAccount}>
                    <SelectTrigger><SelectValue placeholder="Sélectionner un compte" /></SelectTrigger>
                    <SelectContent>
                        {chartAccounts.map(acc => <SelectItem key={acc.code} value={acc.code}>Compte: {acc.code} — {acc.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Pièce</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead></TableRow></TableHeader>
                <TableBody>
                    {ledgerLines.map((entry, i) => (
                        <TableRow key={i}><TableCell>{entry.date}</TableCell><TableCell className="font-mono text-slate-500">{entry.piece}</TableCell><TableCell>{entry.label}</TableCell><TableCell className="text-right text-green-400 font-mono">{entry.debit ? entry.debit.toLocaleString() : '-'}</TableCell><TableCell className="text-right text-red-400 font-mono">{entry.credit ? entry.credit.toLocaleString() : '-'}</TableCell><TableCell className="text-right text-white font-mono">{entry.balance.toLocaleString()}</TableCell></TableRow>
                    ))}
                    {ledgerLines.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-8">Aucun mouvement pour ce compte.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );

    const renderProvisions = () => (
        <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Intitulé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead></TableRow></TableHeader>
            <TableBody>
                {provisions.rows.map(row => (
                    <TableRow key={row.code} className="border-slate-800">
                        <TableCell className="font-mono text-slate-500">{row.code}</TableCell><TableCell>{row.name}</TableCell>
                        <TableCell className="text-right font-mono text-green-400">{row.debit.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-red-400">{row.credit.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-white">{row.balance.toLocaleString()}</TableCell>
                    </TableRow>
                ))}
                {provisions.rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-8">Aucun compte de provision/dépréciation dans le plan comptable.</TableCell></TableRow>
                )}
            </TableBody>
        </Table>
    );

    const renderCreances = () => (
        <div>
            <p className="text-xs text-slate-500 mb-3">
                Le marqueur « À risque » identifie les comptes de créances litigieuses/douteuses ou en souffrance
                (ex. 416) — un vrai vieillissement par échéance nécessiterait une date d'échéance par ligne, non
                disponible dans le grand livre actuel.
            </p>
            <Table>
                <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Intitulé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead><TableHead>Risque</TableHead></TableRow></TableHeader>
                <TableBody>
                    {creances.rows.map(row => (
                        <TableRow key={row.code} className="border-slate-800">
                            <TableCell className="font-mono text-slate-500">{row.code}</TableCell><TableCell>{row.name}</TableCell>
                            <TableCell className="text-right font-mono text-green-400">{row.debit.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-red-400">{row.credit.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-white">{row.balance.toLocaleString()}</TableCell>
                            <TableCell>{row.risque ? <Badge variant="destructive">À risque</Badge> : <Badge variant="secondary">Normal</Badge>}</TableCell>
                        </TableRow>
                    ))}
                    {creances.rows.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-8">Aucun compte de créances dans le plan comptable.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );


    const renderContent = () => {
        switch (selectedStatement) {
            case 'bilan': return renderBilan();
            case 'resultat': return renderResultat();
            case 'sig': return renderSIG();
            case 'cashflow': return renderCashflow();
            case 'balance': return renderBalance();
            case 'grandlivre': return renderGrandLivre();
            case 'provisions': return renderProvisions();
            case 'creances': return renderCreances();
            default: return <div className="text-center py-12 text-slate-500">Cet état financier n'est pas encore implémenté.</div>;
        }
    };

    const handleExport = () => {
        const label = financialStatements[selectedStatement]?.label || selectedStatement;
        let rows = null;
        if (selectedStatement === 'bilan') {
            rows = [...bilan.actif, ...bilan.passif].map(r => ({
                Code: r.code, Intitulé: r.name, Débit: r.debit, Crédit: r.credit, Solde: r.balance,
            }));
        } else if (selectedStatement === 'resultat') {
            rows = [...resultat.produits, ...resultat.charges].map(r => ({
                Code: r.code, Rubrique: r.name, Montant: r.balance,
            }));
        } else if (selectedStatement === 'balance') {
            rows = trialBalance.map(r => ({
                Compte: r.code, Libellé: r.name, Débit: r.debit, Crédit: r.credit, Solde: r.balance,
            }));
        } else if (selectedStatement === 'grandlivre') {
            rows = ledgerLines.map(r => ({
                Date: r.date, Pièce: r.piece, Libellé: r.label, Débit: r.debit || 0, Crédit: r.credit || 0, Solde: r.balance,
            }));
        } else if (selectedStatement === 'sig') {
            rows = sig.rows.map(r => ({ Rubrique: r.label, Montant: r.amount }));
        } else if (selectedStatement === 'cashflow') {
            rows = [
                ...cashflow.categories.map(c => ({ Catégorie: c.label, Montant: c.amount })),
                { Catégorie: 'Variation nette de trésorerie', Montant: cashflow.variationTresorerie },
            ];
        } else if (selectedStatement === 'provisions') {
            rows = provisions.rows.map(r => ({
                Code: r.code, Intitulé: r.name, Débit: r.debit, Crédit: r.credit, Solde: r.balance,
            }));
        } else if (selectedStatement === 'creances') {
            rows = creances.rows.map(r => ({
                Code: r.code, Intitulé: r.name, Débit: r.debit, Crédit: r.credit, Solde: r.balance,
                Risque: r.risque ? 'À risque' : 'Normal',
            }));
        }
        if (!rows) {
            toast({
                title: label,
                description: "Non disponible : la méthodologie de cet état n'est pas encore implémentée côté serveur.",
            });
            return;
        }
        if (rows.length === 0) {
            toast({ title: "Rien à exporter", description: "Aucune donnée disponible pour cet état." });
            return;
        }
        exportToExcel(rows, `etat_financier_${selectedStatement}`);
        toast({ title: "Exportation réussie", description: `${label} exporté en Excel.` });
    };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">Générateur d'États Financiers</h2>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleExport}><FileDown className="w-4 h-4 mr-2"/> Exporter</Button>
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 mb-6">
                {Object.entries(financialStatements).map(([key, { label, icon: Icon }]) => (
                    <motion.button
                        key={key}
                        onClick={() => setSelectedStatement(key)}
                        className={`p-4 rounded-lg transition-all duration-300 ${selectedStatement === key ? 'glass-effect-active' : 'glass-effect'}`}
                        whileHover={{ scale: 1.05 }}
                    >
                        <div className="flex flex-col items-center justify-center gap-2">
                            <Icon className={`w-8 h-8 ${selectedStatement === key ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <span className={`font-semibold text-sm text-center ${selectedStatement === key ? 'text-white' : 'text-slate-300'}`}>{label}</span>
                        </div>
                    </motion.button>
                ))}
            </div>
            <Card className="bg-slate-900/50 border-slate-700">
                <CardHeader>
                    <CardTitle className="gradient-text flex justify-between items-center">
                        <span>{financialStatements[selectedStatement]?.label || 'État Financier'}</span>
                        <Badge variant="secondary">Taux de clôture: 1 USD = {closingRate ? `${closingRate} FC` : 'non configuré'}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {renderContent()}
                </CardContent>
            </Card>
        </motion.div>
    );
};

export default FinancialStatementsViewer;