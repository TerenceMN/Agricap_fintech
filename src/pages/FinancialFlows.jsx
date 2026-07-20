import React from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const FLOWS = [];

const FinancialFlows = () => {
    return (
        <Layout>
            <Helmet><title>Flux Financiers - AGRICAP</title></Helmet>
            <h1 className="text-3xl font-bold gradient-text mb-2">Flux Financiers & Rendements</h1>
            <p className="text-gray-400 mb-8">Historique et prévisions de vos cash-flows.</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card className="glass-effect"><CardHeader><CardTitle className="text-gray-400 text-sm">Total Reçu (YTD)</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold text-emerald-400">12,450 $</p></CardContent></Card>
                <Card className="glass-effect"><CardHeader><CardTitle className="text-gray-400 text-sm">Prochain Paiement</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold text-white">425 $</p><p className="text-xs text-gray-500">15 Déc 2025</p></CardContent></Card>
                <Card className="glass-effect"><CardHeader><CardTitle className="text-gray-400 text-sm">TRI Global</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold text-blue-400">11.8%</p></CardContent></Card>
            </div>

            <div className="glass-effect rounded-xl overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="text-gray-300">Date</TableHead>
                            <TableHead className="text-gray-300">Type</TableHead>
                            <TableHead className="text-gray-300">Projet</TableHead>
                            <TableHead className="text-right text-gray-300">Montant</TableHead>
                            <TableHead className="text-gray-300">Statut</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {FLOWS.map(f => (
                            <TableRow key={f.id} className="border-white/5 hover:bg-white/5">
                                <TableCell className="text-gray-400">{f.date}</TableCell>
                                <TableCell className="text-white">{f.type}</TableCell>
                                <TableCell>{f.project}</TableCell>
                                <TableCell className="text-right font-mono text-emerald-400">+{f.amount.toLocaleString()} $</TableCell>
                                <TableCell><Badge variant={f.status === 'Payé' ? 'success' : 'outline'}>{f.status}</Badge></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </Layout>
    );
};

export default FinancialFlows;