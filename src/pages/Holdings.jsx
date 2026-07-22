import React, { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { motion } from 'framer-motion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Eye, DollarSign, FileText, MessageCircle, Send, Calculator, Building, Calendar, Info } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { api } from '@/services/api';
import { buildCommitments, formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import { formatPercent } from '@/lib/investorSpaceWire';

const TYPE_LABEL = { OBLIGATION: 'Obligation', ACTION: 'Action', PART_SOCIALE: 'Part sociale' };

const DetailsDialog = ({ open, onOpenChange, holding }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass-effect text-white max-w-2xl">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-2xl"><Building className="text-emerald-400"/> {holding?.projectName}</DialogTitle>
                <DialogDescription>Détails complets de l'instrument financier.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-6 py-4">
                <div className="space-y-4">
                    <div className="bg-white/5 p-3 rounded-lg">
                        <Label className="text-gray-400 text-xs uppercase">Promoteur</Label>
                        <p className="font-semibold text-lg">{holding?.promoter || '-'}</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-lg">
                        <Label className="text-gray-400 text-xs uppercase">Montant Investi</Label>
                        <p className="font-semibold text-lg text-emerald-400">{holding?.amount.toLocaleString()} $</p>
                    </div>
                     <div className="bg-white/5 p-3 rounded-lg">
                        <Label className="text-gray-400 text-xs uppercase">Date de souscription</Label>
                        <p className="font-mono">{formatDate(holding?.subscriptionDate)}</p>
                    </div>
                </div>
                <div className="space-y-4">
                    <div className="bg-white/5 p-3 rounded-lg">
                        <Label className="text-gray-400 text-xs uppercase">Type d'instrument</Label>
                        <p className="font-semibold">{TYPE_LABEL[holding?.typeOfTitle] || holding?.typeOfTitle || '-'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/5 p-3 rounded-lg">
                            <Label className="text-gray-400 text-xs uppercase">Taux</Label>
                            <p className="font-bold text-lg">{formatPercent(holding?.couponRatePercent)}</p>
                        </div>
                         <div className="bg-white/5 p-3 rounded-lg">
                            <Label className="text-gray-400 text-xs uppercase">Maturité</Label>
                            <p className="font-bold">{formatDate(holding?.expectedMaturity)}</p>
                        </div>
                    </div>
                     <div className="bg-white/5 p-3 rounded-lg">
                        <Label className="text-gray-400 text-xs uppercase">Prochain Coupon</Label>
                        <p className="font-mono text-blue-300">{formatDate(holding?.nextPaymentDate)}</p>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

const SellSimulatorDialog = ({ open, onOpenChange, holding, onSubmitted }) => {
    const { toast } = useToast();
    const [pricePercent, setPricePercent] = useState(98);
    const [submitting, setSubmitting] = useState(false);

    const faceValue = holding?.amount || 0;
    const salePrice = (faceValue * pricePercent) / 100;
    const fees = salePrice * 0.015;
    const netProceeds = salePrice - fees;

    const handlePlaceOrder = async () => {
        setSubmitting(true);
        try {
            await api.investments.secondaryMarket.create(holding.subscriptionId, salePrice);
            toast({ title: 'Ordre placé', description: 'Votre position est listée sur le marché secondaire.' });
            onSubmitted?.();
            onOpenChange(false);
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Placement impossible.', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Calculator className="text-blue-400"/> Simulateur de Vente</DialogTitle>
                    <DialogDescription>Estimez vos gains en cas de vente anticipée sur le marché secondaire.</DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                        <div className="flex justify-between items-center mb-4">
                            <Label>Prix de vente (% du nominal)</Label>
                            <span className="font-bold text-xl">{pricePercent}%</span>
                        </div>
                        <Input type="range" min="80" max="110" step="0.5" value={pricePercent} onChange={(e) => setPricePercent(Number(e.target.value))} className="w-full accent-blue-500 bg-slate-700 h-2 rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-xs text-gray-400 mt-2">
                            <span>Décote (80%)</span>
                            <span>Par (100%)</span>
                            <span>Prime (110%)</span>
                        </div>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg space-y-3">
                        <h4 className="font-bold text-red-200 flex items-center gap-2"><DollarSign className="w-4 h-4"/> Prix d'Offre</h4>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between"><span>Prix Brut:</span> <span>{salePrice.toLocaleString(undefined, {maximumFractionDigits: 0})} $</span></div>
                            <div className="flex justify-between text-red-300"><span>Frais (1.5%):</span> <span>- {fees.toLocaleString(undefined, {maximumFractionDigits: 0})} $</span></div>
                            <div className="border-t border-red-500/30 pt-2 flex justify-between font-bold text-lg text-white">
                                <span>Net estimé si vendu:</span>
                                <span>{netProceeds.toLocaleString(undefined, {maximumFractionDigits: 0})} $</span>
                            </div>
                        </div>
                    </div>
                    <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-200">
                        <Info className="h-4 w-4" />
                        <AlertTitle>Note d'information</AlertTitle>
                        <AlertDescription className="text-xs">
                            Votre position sera listée au marché secondaire au prix brut ci-dessus ; la vente n'est effective que lorsqu'un autre investisseur l'achète.
                        </AlertDescription>
                    </Alert>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Fermer</Button>
                    <Button className="bg-blue-600 hover:bg-blue-700" onClick={handlePlaceOrder} disabled={submitting}>Placer ordre de vente</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ChatDialog = ({ open, onOpenChange, holding }) => {
    const { toast } = useToast();
    const [conversationId, setConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [msg, setMsg] = useState('');
    const [loading, setLoading] = useState(true);
    const bottomRef = useRef(null);

    useEffect(() => {
        if (!open || !holding?.managerSub) return;
        setLoading(true);
        api.support.conversations.start(holding.managerSub)
            .then((conv) => {
                setConversationId(conv.id);
                return api.support.conversations.messages(conv.id);
            })
            .then(setMessages)
            .catch((err) => toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' }))
            .finally(() => setLoading(false));
    }, [open, holding?.managerSub]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const handleSend = async () => {
        if (!msg.trim() || !conversationId) return;
        const text = msg;
        setMsg('');
        try {
            const sent = await api.support.conversations.send(conversationId, text);
            setMessages((prev) => [...prev, { id: sent.id, senderSub: 'me', text: sent.text, createdAt: sent.createdAt }]);
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || "Envoi impossible.", variant: 'destructive' });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white sm:max-w-[500px] h-[650px] flex flex-col p-0 overflow-hidden border-0">
                <div className="p-4 border-b border-white/10 bg-slate-900/80 backdrop-blur">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border border-emerald-500/50">
                            <AvatarFallback className="bg-emerald-900 text-emerald-200">GP</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <h4 className="font-bold text-sm">Gestionnaire de projet</h4>
                            <p className="text-xs text-gray-400 font-mono">{holding?.managerSub}</p>
                        </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 flex gap-2 overflow-x-auto text-[10px]">
                        <span className="bg-white/5 px-2 py-1 rounded text-gray-300 whitespace-nowrap">Projet: {holding?.projectName}</span>
                        <span className="bg-white/5 px-2 py-1 rounded text-gray-300 whitespace-nowrap">Statut: {holding?.status}</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/20">
                    {loading && <p className="text-center text-sm text-gray-500">Chargement...</p>}
                    {!loading && messages.length === 0 && (
                        <p className="text-center text-sm text-gray-500">Aucun message. Démarrez la conversation.</p>
                    )}
                    {messages.map(m => (
                        <div key={m.id} className={`flex ${m.senderSub === 'me' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] p-3 rounded-2xl text-sm shadow-sm ${m.senderSub === 'me' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-slate-800 text-gray-200 rounded-tl-none border border-white/5'}`}>
                                <p>{m.text}</p>
                                <p className="text-[10px] opacity-50 text-right mt-1">{new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                            </div>
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>

                <div className="p-3 bg-slate-900/50 border-t border-white/10 flex gap-2">
                    <Input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="Écrire un message..." className="bg-white/5 border-0 focus-visible:ring-1 focus-visible:ring-emerald-500" />
                    <Button size="icon" onClick={handleSend} className="bg-emerald-600 hover:bg-emerald-700 rounded-full shrink-0"><Send className="w-4 h-4" /></Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const Holdings = () => {
  const { toast } = useToast();
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [activeModal, setActiveModal] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [subscriptions, offers, projects] = await Promise.all([
        api.investments.subscriptions.mine(),
        api.investments.offers.list(),
        api.investments.projects.list(),
      ]);
      setHoldings(buildCommitments(subscriptions, offers, projects));
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openModal = (type, holding) => {
    setSelectedHolding(holding);
    setActiveModal(type);
  };

  const closeModal = (open) => {
      if (!open) {
          setActiveModal(null);
          setSelectedHolding(null);
      }
  };

  return (
    <Layout>
      <Helmet><title>Mes Obligations - AGRICAP</title></Helmet>

      {selectedHolding && activeModal === 'details' && <DetailsDialog open={true} onOpenChange={closeModal} holding={selectedHolding} />}
      {selectedHolding && activeModal === 'sell' && <SellSimulatorDialog open={true} onOpenChange={closeModal} holding={selectedHolding} onSubmitted={loadData} />}
      {selectedHolding && activeModal === 'chat' && <ChatDialog open={true} onOpenChange={closeModal} holding={selectedHolding} />}

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-bold gradient-text">Mes Obligations & Titres</h1>
        <p className="text-gray-400">Gérez activement votre portefeuille obligataire et actions.</p>
      </motion.div>

      <div className="glass-effect rounded-2xl p-6 overflow-hidden">
        <Table>
            <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-gray-300">Instrument</TableHead>
                    <TableHead className="text-gray-300">Type</TableHead>
                    <TableHead className="text-right text-gray-300">Montant ($)</TableHead>
                    <TableHead className="text-right text-gray-300">Taux</TableHead>
                    <TableHead className="text-gray-300">Maturité</TableHead>
                    <TableHead className="text-gray-300">Statut</TableHead>
                    <TableHead className="text-center text-gray-300 w-[200px]">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {!loading && holdings.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">Aucune détention.</TableCell></TableRow>
                )}
                {holdings.map((h) => (
                    <TableRow key={h.id} className="border-white/5 hover:bg-white/5">
                        <TableCell>
                            <div className="font-medium text-white">{h.projectName}</div>
                            <div className="text-xs text-gray-500 font-mono">{h.id}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="border-white/20 text-gray-300">{TYPE_LABEL[h.typeOfTitle] || h.typeOfTitle || '-'}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-emerald-400 font-bold">{h.amount.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{formatPercent(h.couponRatePercent)}</TableCell>
                        <TableCell>{formatDate(h.expectedMaturity)}</TableCell>
                        <TableCell>
                            <Badge className={h.status === 'Active' || h.status === 'Repayment' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'}>
                                {h.status}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                            <div className="flex justify-center gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10" title="Détails" onClick={() => openModal('details', h)}>
                                    <Eye className="h-4 w-4"/>
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10" title="Simuler Vente" onClick={() => openModal('sell', h)} disabled={h.status !== 'Active'}>
                                    <DollarSign className="h-4 w-4"/>
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10" title="Contacter le gestionnaire" onClick={() => openModal('chat', h)} disabled={!h.managerSub}>
                                    <MessageCircle className="h-4 w-4"/>
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
      </div>
    </Layout>
  );
};

export default Holdings;
