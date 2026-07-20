import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import Layout, { menuKeyFor } from '@/components/Layout';
import StatCard from '@/components/StatCard';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp, DollarSign, Plus, MessageSquare, ArrowRightLeft,
  Wallet, FileText, HelpCircle, Video, Landmark, Settings, Activity, PieChart
} from 'lucide-react';
import { api } from '@/services/api';
import { buildCommitments, formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import PerformanceReports from '@/components/investor-space/PerformanceReports';

const InvestorInvestmentsView = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('dashboard');

    const [holdings, setHoldings] = useState([]);
    const [investor, setInvestor] = useState(null);
    const [wallets, setWallets] = useState([]);
    const [movements, setMovements] = useState([]);
    const [tickets, setTickets] = useState([]);
    const [reportProject, setReportProject] = useState(null);

    const [isDepositOpen, setDepositOpen] = useState(false);
    const [depositAmount, setDepositAmount] = useState('');
    const [depositing, setDepositing] = useState(false);
    const [ticketSubject, setTicketSubject] = useState('');
    const [sendingTicket, setSendingTicket] = useState(false);

    const loadAll = async () => {
        try {
            const [subs, offers, projects, inv, walletsRes, movementsRes, ticketsRes] = await Promise.all([
                api.investments.subscriptions.mine(),
                api.investments.offers.list(),
                api.investments.projects.list(),
                api.investments.investors.me(),
                api.caisses.wallets.mine(),
                api.caisses.wallets.movements(),
                api.support.tickets.list(),
            ]);
            setHoldings(buildCommitments(subs, offers, projects));
            setInvestor(inv);
            setWallets(walletsRes);
            setMovements(movementsRes.slice(0, 10));
            setTickets(ticketsRes);
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
        }
    };

    useEffect(() => { loadAll(); }, []);

    const totalInvested = holdings.reduce((sum, h) => sum + h.amount, 0);
    const activeCount = holdings.filter(h => h.status === 'Active' || h.status === 'Repayment').length;
    const avgReturn = holdings.length > 0 ? holdings.reduce((s, h) => s + h.couponRate, 0) / holdings.length : 0;
    const usdWallet = wallets.find(w => w.currency === 'USD');
    const cdfWallet = wallets.find(w => w.currency === 'CDF');

    const handleDeposit = async () => {
        const amount = Number(depositAmount);
        if (!amount || amount <= 0) return;
        setDepositing(true);
        try {
            await api.caisses.wallets.deposit(amount, 'USD');
            toast({ title: 'Dépôt initié', description: 'Votre dépôt est en cours de traitement.' });
            setDepositOpen(false);
            setDepositAmount('');
            loadAll();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Dépôt impossible.', variant: 'destructive' });
        } finally {
            setDepositing(false);
        }
    };

    const handleSendTicket = async () => {
        if (!ticketSubject.trim()) return;
        setSendingTicket(true);
        try {
            await api.support.tickets.create({ subject: ticketSubject, category: 'investissement', priority: 'normal' });
            toast({ title: 'Ticket envoyé', description: "L'équipe support vous répondra sous peu." });
            setTicketSubject('');
            loadAll();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Envoi impossible.', variant: 'destructive' });
        } finally {
            setSendingTicket(false);
        }
    };

    const handleNotAvailable = (label) => toast({
        title: label,
        description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
    });

    return (
        <div className="space-y-6 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold gradient-text">Espace Investisseur</h1>
                    <p className="text-slate-400">Gérez votre patrimoine et vos souscriptions.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right hidden md:block">
                        <p className="text-xs text-slate-400">Solde Disponible (USD)</p>
                        <p className="text-xl font-bold text-white">{formatCurrency(usdWallet?.balance || 0)}</p>
                    </div>
                    <Button onClick={() => setDepositOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-500/20">
                        <Plus className="w-4 h-4 mr-2"/> Dépôt
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-slate-900 border border-slate-800 w-full justify-start overflow-x-auto h-auto p-1">
                    <TabsTrigger value="dashboard" className="data-[state=active]:bg-slate-800"><Activity className="w-4 h-4 mr-2"/> Vue d'ensemble</TabsTrigger>
                    <TabsTrigger value="portfolio" className="data-[state=active]:bg-slate-800"><PieChart className="w-4 h-4 mr-2"/> Portefeuille</TabsTrigger>
                    <TabsTrigger value="banking" className="data-[state=active]:bg-slate-800"><Landmark className="w-4 h-4 mr-2"/> Banque & Cash</TabsTrigger>
                    <TabsTrigger value="reports" className="data-[state=active]:bg-slate-800"><FileText className="w-4 h-4 mr-2"/> Rapports</TabsTrigger>
                    <TabsTrigger value="communication" className="data-[state=active]:bg-slate-800"><MessageSquare className="w-4 h-4 mr-2"/> Messages</TabsTrigger>
                    <TabsTrigger value="settings" className="data-[state=active]:bg-slate-800"><Settings className="w-4 h-4 mr-2"/> Paramètres</TabsTrigger>
                    <TabsTrigger value="education" className="data-[state=active]:bg-slate-800"><HelpCircle className="w-4 h-4 mr-2"/> Éducation</TabsTrigger>
                </TabsList>

                <div className="mt-6">
                    <TabsContent value="dashboard" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <StatCard title="Total Investi" value={formatCurrency(totalInvested)} icon={Wallet} trend="up" gradient="from-blue-500 to-indigo-600" />
                            <StatCard title="Rendement Moyen" value={`${avgReturn.toFixed(1)}%`} change="Coupon pondéré" icon={TrendingUp} trend="up" gradient="from-emerald-500 to-teal-600" />
                            <StatCard title="Souscriptions Actives" value={activeCount} icon={DollarSign} trend="neutral" gradient="from-purple-500 to-pink-600" />
                            <StatCard title="Statut KYC" value={investor?.kycStatus || 'N/D'} icon={Activity} trend="neutral" gradient="from-amber-500 to-orange-600" />
                        </div>
                        <Card className="bg-slate-900 border-slate-800">
                            <CardContent className="p-6 text-center">
                                <p className="text-slate-400 mb-4">Pour le tableau de bord complet (exposition sectorielle/géographique, santé du portefeuille, indicateurs de gouvernance), consultez l'Espace Investisseur détaillé.</p>
                                <Button onClick={() => navigate('/investor-space')} className="bg-gradient-to-r from-emerald-500 to-blue-600">Ouvrir le tableau de bord complet</Button>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="portfolio" className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold text-white">Mes Souscriptions</h2>
                        </div>
                        <Card className="bg-slate-900 border-slate-800">
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader><TableRow className="border-slate-800 hover:bg-slate-800/50"><TableHead>Projet</TableHead><TableHead>Investi</TableHead><TableHead>Reçu</TableHead><TableHead>Rendement</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {holdings.length === 0 && (
                                            <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Aucune souscription.</TableCell></TableRow>
                                        )}
                                        {holdings.map(h => (
                                            <TableRow key={h.id} className="border-slate-800 hover:bg-slate-800/30">
                                                <TableCell className="font-medium text-white">{h.projectName}</TableCell>
                                                <TableCell className="text-slate-300">{formatCurrency(h.amount)}</TableCell>
                                                <TableCell className="font-bold text-white">{formatCurrency(h.totalReceived)}</TableCell>
                                                <TableCell className="text-emerald-400">{h.couponRate}%</TableCell>
                                                <TableCell><Badge className="bg-emerald-500/20 text-emerald-400 border-0">{h.status}</Badge></TableCell>
                                                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => { setReportProject(h); setActiveTab('reports'); }}>Rapports</Button></TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="banking" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <Card className="bg-slate-900 border-slate-800"><CardContent className="p-4"><p className="text-xs text-slate-400 mb-1">Solde USD</p><p className="text-2xl font-bold text-white">{formatCurrency(usdWallet?.balance || 0)}</p></CardContent></Card>
                                <Card className="bg-slate-900 border-slate-800"><CardContent className="p-4"><p className="text-xs text-slate-400 mb-1">Solde CDF</p><p className="text-2xl font-bold text-white">{(cdfWallet?.balance || 0).toLocaleString()} FC</p></CardContent></Card>
                            </div>
                            <Card className="bg-slate-900 border-slate-800">
                                <CardHeader><CardTitle className="text-white">Mouvements Récents</CardTitle></CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader><TableRow className="border-slate-800"><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Montant</TableHead><TableHead className="text-right">Statut</TableHead></TableRow></TableHeader>
                                        <TableBody>
                                            {movements.length === 0 && (
                                                <TableRow><TableCell colSpan={4} className="text-center text-slate-500 py-6">Aucun mouvement.</TableCell></TableRow>
                                            )}
                                            {movements.map(m => (
                                                <TableRow key={m.id} className="border-slate-800">
                                                    <TableCell>{new Date(m.createdAt || m.date).toLocaleDateString()}</TableCell>
                                                    <TableCell>{m.kind || m.type}</TableCell>
                                                    <TableCell className="text-right text-white">{formatCurrency(m.amount)}</TableCell>
                                                    <TableCell className="text-right"><Badge variant="outline" className="text-emerald-400 border-emerald-500/30">{m.status}</Badge></TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="space-y-6">
                             <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
                                <CardHeader><CardTitle className="text-white">Actions Rapides</CardTitle></CardHeader>
                                <CardContent className="space-y-3">
                                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => setDepositOpen(true)}>Faire un dépôt</Button>
                                    <Button variant="outline" className="w-full border-slate-700" onClick={() => navigate('/opportunities')}><ArrowRightLeft className="w-4 h-4 mr-2"/> Investir mes fonds</Button>
                                </CardContent>
                             </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="reports" className="space-y-6">
                        <h2 className="text-2xl font-bold text-white">Rapports de Performance</h2>
                        {!reportProject ? (
                            <Card className="bg-slate-900 border-slate-800">
                                <CardContent className="p-8 text-center text-slate-400">
                                    Sélectionnez une souscription depuis l'onglet "Portefeuille" pour consulter ses rapports de performance.
                                </CardContent>
                            </Card>
                        ) : (
                            <PerformanceReports projectCode={reportProject.projectCode} projectName={reportProject.projectName} />
                        )}
                    </TabsContent>

                    <TabsContent value="communication">
                        <Card className="bg-slate-900 border-slate-800 min-h-[300px]">
                            <CardHeader><CardTitle className="text-white">Support & Messagerie</CardTitle></CardHeader>
                            <CardContent>
                                <div className="space-y-3 mb-6">
                                    {tickets.length === 0 && <p className="text-sm text-slate-500">Aucun ticket envoyé.</p>}
                                    {tickets.map(t => (
                                        <div key={t.id} className="p-4 rounded-lg border bg-slate-900 border-slate-800">
                                            <div className="flex justify-between mb-1">
                                                <span className="font-bold text-white">{t.subject}</span>
                                                <span className="text-xs text-slate-400">{formatDate(t.createdAt)}</span>
                                            </div>
                                            <Badge variant="outline" className="text-xs">{t.status}</Badge>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <Input value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} placeholder="Sujet de votre demande..." className="bg-slate-800 border-slate-700" />
                                    <Button onClick={handleSendTicket} disabled={sendingTicket || !ticketSubject.trim()} className="bg-slate-800 hover:bg-slate-700 shrink-0"><MessageSquare className="w-4 h-4 mr-2"/> Contacter le Support</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="settings">
                        <Card className="bg-slate-900 border-slate-800">
                            <CardHeader><CardTitle className="text-white">Profil Investisseur</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div><span className="text-slate-400">Type</span><p className="text-white font-medium">{investor?.investorType || '-'}</p></div>
                                    <div><span className="text-slate-400">Profil de risque</span><p className="text-white font-medium">{investor?.riskProfile || '-'}</p></div>
                                    <div><span className="text-slate-400">Statut KYC</span><p className="text-white font-medium">{investor?.kycStatus || '-'}</p></div>
                                    <div><span className="text-slate-400">Statut compte</span><p className="text-white font-medium">{investor?.status || '-'}</p></div>
                                </div>
                                <Button variant="outline" className="border-slate-700" onClick={() => navigate('/settings')}>Gérer mes préférences complètes</Button>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="education">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card className="bg-slate-900 border-slate-800">
                                <CardContent className="p-6 text-center">
                                    <Video className="w-12 h-12 text-blue-400 mx-auto mb-4"/>
                                    <h3 className="text-white font-bold">Webinaires</h3>
                                    <p className="text-sm text-slate-400 mb-4">Comprendre les obligations vertes.</p>
                                    <Button variant="outline" className="w-full" onClick={() => handleNotAvailable('Webinaires')}>Regarder</Button>
                                </CardContent>
                            </Card>
                             <Card className="bg-slate-900 border-slate-800">
                                <CardContent className="p-6 text-center">
                                    <FileText className="w-12 h-12 text-emerald-400 mx-auto mb-4"/>
                                    <h3 className="text-white font-bold">Guide Fiscal</h3>
                                    <p className="text-sm text-slate-400 mb-4">Optimisez vos rendements nets.</p>
                                    <Button variant="outline" className="w-full" onClick={() => handleNotAvailable('Guide Fiscal')}>Lire</Button>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </div>
            </Tabs>

            <Dialog open={isDepositOpen} onOpenChange={setDepositOpen}>
                <DialogContent className="bg-slate-900 border-slate-700 text-white">
                    <DialogHeader><DialogTitle>Nouveau Dépôt</DialogTitle><DialogDescription>Alimentez votre portefeuille AGRICAP (USD).</DialogDescription></DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label>Montant (USD)</Label>
                            <Input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="5000" className="bg-slate-800 border-slate-700 mt-2"/>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDepositOpen(false)}>Annuler</Button>
                        <Button onClick={handleDeposit} disabled={depositing || !depositAmount} className="bg-emerald-600">Valider</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

const AdminInvestmentsView = () => {
    const navigate = useNavigate();
    return (
        <div className="text-center py-20">
            <h1 className="text-3xl font-bold gradient-text">Vue Administrateur</h1>
            <p className="text-gray-400">Cette section est réservée à la gestion globale des investissements.</p>
            <Button className="mt-4" variant="outline" onClick={() => navigate('/admin/console')}>Accéder au Back-Office</Button>
        </div>
    );
};

const Investments = () => {
    const { user } = useAuth();
    return (
        <Layout>
            <Helmet>
                <title>Espace Investisseur - AGRICAP</title>
                <meta name="description" content="Plateforme complète de gestion d'investissements agricoles" />
            </Helmet>
            {menuKeyFor(user) === 'admin' ? <AdminInvestmentsView /> : <InvestorInvestmentsView />}
        </Layout>
    );
};

export default Investments;
