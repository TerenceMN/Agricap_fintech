import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Eye, Calendar, ShieldCheck, PenTool, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { api, ApiError } from '@/services/api';

const ContractCard = ({ contract, onPreview, onSign, onDownload }) => {
    const statusConfig = {
        'actif': { label: 'Actif', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
        'en_attente': { label: 'Signature Requise', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
        'cloture': { label: 'Clôturé', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
    };
    const status = statusConfig[contract.status] || statusConfig['cloture'];

    return (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className={`glass-effect border-l-4 ${contract.status === 'actif' ? 'border-l-emerald-500' : 'border-l-transparent'}`}>
                <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                <FileText className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-lg">{contract.title}</h3>
                                <p className="text-xs text-gray-400 font-mono">{contract.id}</p>
                            </div>
                        </div>
                        <Badge className={`${status.color} border`}>{status.label}</Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm mb-6">
                        <div className="space-y-1">
                            <p className="text-gray-500 flex items-center gap-1"><Calendar className="w-3 h-3"/> Date d'effet</p>
                            <p className="text-gray-300 font-medium">{new Date(contract.date).toLocaleDateString()}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-gray-500 flex items-center gap-1"><ShieldCheck className="w-3 h-3"/> Type</p>
                            <p className="text-gray-300 font-medium">{contract.type}</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button className="flex-1 bg-white/5 hover:bg-white/10 text-white border border-white/10" variant="outline" onClick={() => onPreview(contract)}>
                            <Eye className="w-4 h-4 mr-2" /> Aperçu
                        </Button>
                        <Button className="flex-1 bg-white/5 hover:bg-white/10 text-white border border-white/10" variant="outline" onClick={() => onDownload(contract)}>
                            <Download className="w-4 h-4 mr-2" /> PDF
                        </Button>
                        {contract.status === 'en_attente' && (
                             <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onSign(contract)}>
                                <PenTool className="w-4 h-4 mr-2" /> Signer
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
};

const Contracts = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [contracts, setContracts] = useState([]);
    const [previewContract, setPreviewContract] = useState(null);
    const [signContract, setSignContract] = useState(null);
    const [signature, setSignature] = useState('');
    const [agreed, setAgreed] = useState(false);

    useEffect(() => { api.contracts.mine().then(setContracts).catch(() => {}); }, []);

    const handleSign = async () => {
        if (!signContract) return;
        try {
            const updated = await api.contracts.sign(signContract.id, signature, agreed);
            setContracts(prev => prev.map(c => c.id === signContract.id ? updated : c));
            toast({
                title: "Contrat Signé",
                description: `Le contrat ${signContract.id} est maintenant actif.`,
                className: "bg-emerald-500 text-white"
            });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
        setSignContract(null);
        setSignature('');
        setAgreed(false);
    };

    const handleDownload = () => {
        toast({
            title: "Non disponible",
            description: "Non disponible : la génération de document PDF pour les contrats n'est pas encore implémentée côté serveur.",
        });
    };

    return (
        <Layout>
            <Helmet>
                <title>Mes Contrats - AGRICAP FINTECH</title>
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <h1 className="text-3xl font-bold gradient-text">Mes Contrats</h1>
                <p className="text-gray-400">Consultez, téléchargez et signez vos documents contractuels.</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {contracts.map(contract => (
                    <ContractCard key={contract.id} contract={contract} onPreview={setPreviewContract} onSign={setSignContract} onDownload={handleDownload} />
                ))}
            </div>

            {/* Preview Modal */}
            <Dialog open={!!previewContract} onOpenChange={() => setPreviewContract(null)}>
                <DialogContent className="glass-effect text-white max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Aperçu du Contrat: {previewContract?.id}</DialogTitle>
                        <DialogDescription>{previewContract?.title}</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 bg-white/5 p-4 rounded-lg border border-white/10 text-sm text-center">
                        <FileText className="w-8 h-8 text-slate-500" />
                        <p className="text-slate-300 font-medium">{previewContract?.title}</p>
                        <p className="text-slate-500 max-w-md">
                            Non disponible : le contenu détaillé du contrat (clauses, texte intégral) n'est pas encore
                            généré ni stocké côté serveur. Seuls le statut et la date de signature sont suivis pour le
                            moment.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPreviewContract(null)}>Fermer</Button>
                        <Button variant="ghost" onClick={handleDownload}><Download className="w-4 h-4 mr-2"/>Télécharger</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Sign Modal */}
            <Dialog open={!!signContract} onOpenChange={() => setSignContract(null)}>
                <DialogContent className="glass-effect text-white">
                    <DialogHeader>
                        <DialogTitle>Signature Électronique</DialogTitle>
                        <DialogDescription>Vous êtes sur le point de signer le contrat {signContract?.id}.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex gap-3 items-start">
                            <ShieldCheck className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-yellow-200">En signant électroniquement, vous acceptez l'intégralité des termes et conditions du contrat. Cette signature a la même valeur juridique qu'une signature manuscrite.</p>
                        </div>

                        <div className="space-y-2">
                            <Label>Tapez votre nom complet pour signer</Label>
                            <Input value={signature} onChange={e => setSignature(e.target.value)} placeholder={user?.name} className="bg-slate-900/50 border-slate-700 font-script text-lg" />
                        </div>

                        <div className="flex items-center space-x-2">
                            <Checkbox id="terms" checked={agreed} onCheckedChange={setAgreed} className="border-emerald-500" />
                            <label htmlFor="terms" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Je certifie avoir lu et compris le document.
                            </label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setSignContract(null)}>Annuler</Button>
                        <Button onClick={handleSign} disabled={!agreed || signature.length < 3} className="bg-gradient-to-r from-emerald-500 to-blue-600">
                            <PenTool className="w-4 h-4 mr-2" /> Signer le document
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Layout>
    );
};

export default Contracts;