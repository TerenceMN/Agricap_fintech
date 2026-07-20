import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from '@/components/ui/use-toast';
import {
    TrendingUp, Clock, FileText, MapPin, Leaf
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency, getRiskLabel } from '@/lib/investorSpaceUtils';
import ProjectDetailsModal from '@/components/investor-space/ProjectDetailsModal';

const ComparisonDialog = ({ open, onOpenChange, projects }) => {
    if (!projects || projects.length === 0) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-6xl w-full h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold gradient-text">Comparateur de Projets</DialogTitle>
                    <DialogDescription>Analyse comparative détaillée pour votre prise de décision.</DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-auto p-4">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead className="w-[200px] text-gray-400 bg-slate-900/50 sticky left-0 z-10">Critères</TableHead>
                                {projects.map(p => (
                                    <TableHead key={p.id} className="min-w-[250px] text-center bg-slate-900/20 font-bold text-white border-l border-white/5">
                                        {p.name}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Secteur</TableCell>
                                {projects.map(p => <TableCell key={p.id} className="text-center border-l border-white/5">{p.sector}</TableCell>)}
                            </TableRow>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Localisation</TableCell>
                                {projects.map(p => <TableCell key={p.id} className="text-center border-l border-white/5">{p.location}</TableCell>)}
                            </TableRow>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Rendement (coupon)</TableCell>
                                {projects.map(p => <TableCell key={p.id} className="text-center font-bold text-emerald-400 border-l border-white/5 text-lg">{p.expectedReturn}%</TableCell>)}
                            </TableRow>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Niveau de Risque</TableCell>
                                {projects.map(p => {
                                    const risk = getRiskLabel(p.riskScore);
                                    return (
                                        <TableCell key={p.id} className="text-center border-l border-white/5">
                                            <Badge className={`${risk.bg} ${risk.color} border-0`}>{risk.label}</Badge>
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Ticket Minimum</TableCell>
                                {projects.map(p => <TableCell key={p.id} className="text-center font-mono border-l border-white/5">{formatCurrency(p.minimumTicket)}</TableCell>)}
                            </TableRow>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Score Global</TableCell>
                                {projects.map(p => <TableCell key={p.id} className="text-center border-l border-white/5">{p.globalScore}</TableCell>)}
                            </TableRow>
                            <TableRow className="border-white/5 hover:bg-white/5">
                                <TableCell className="font-medium bg-slate-900/50 sticky left-0 text-gray-300">Financement</TableCell>
                                {projects.map(p => (
                                    <TableCell key={p.id} className="text-center border-l border-white/5">
                                        {p.targetAmount > 0 ? Math.round((p.raisedAmount / p.targetAmount) * 100) : 0}%
                                    </TableCell>
                                ))}
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const Opportunities = () => {
    const { toast } = useToast();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState(null);
    const [showDetails, setShowDetails] = useState(false);
    const [compareList, setCompareList] = useState([]);
    const [isCompareOpen, setIsCompareOpen] = useState(false);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        setLoading(true);
        try {
            const [openOffers, allProjects] = await Promise.all([
                api.investments.offers.open(),
                api.investments.projects.list(),
            ]);
            const merged = openOffers.map((offer) => {
                const project = allProjects.find((p) => p.id === offer.projectId);
                if (!project) return null;
                return {
                    id: project.id, code: project.code, name: project.title,
                    sector: project.sector, location: project.location, status: project.status,
                    riskScore: project.riskScore, globalScore: project.globalScore,
                    offerId: offer.id, offerCode: offer.code,
                    raisedAmount: offer.fundedAmount, targetAmount: offer.fundingGoal,
                    minimumTicket: offer.minTicket, expectedReturn: offer.couponRate,
                    minBonds: offer.minBonds, maxBonds: offer.maxBonds,
                    availableBonds: offer.availableBonds, bondUnitValue: offer.bondUnitValue,
                };
            }).filter(Boolean);
            setProjects(merged);
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const toggleCompare = (project) => {
        setCompareList(prev => {
            if (prev.find(p => p.id === project.id)) {
                return prev.filter(p => p.id !== project.id);
            }
            if (prev.length >= 3) {
                toast({ description: "Maximum 3 projets pour la comparaison." });
                return prev;
            }
            return [...prev, project];
        });
    };

    return (
        <Layout>
            <Helmet><title>Opportunités - AGRICAP</title></Helmet>
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <h1 className="text-3xl font-bold gradient-text">Marché Primaire</h1>
                <p className="text-gray-400">Découvrez et financez les projets agricoles à fort impact validés par nos comités.</p>
            </motion.div>

            <AnimatePresence>
                {compareList.length > 0 && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="fixed bottom-8 right-8 z-50 bg-slate-900 border border-emerald-500/50 shadow-2xl shadow-emerald-900/20 p-4 rounded-xl flex items-center gap-4"
                    >
                        <div className="flex -space-x-3">
                            {compareList.map(p => (
                                <div key={p.id} className="w-10 h-10 rounded-full bg-emerald-600 border-2 border-slate-900 flex items-center justify-center text-xs font-bold text-white">
                                    {p.name.substring(0, 2)}
                                </div>
                            ))}
                        </div>
                        <div className="text-sm">
                            <span className="font-bold text-white">{compareList.length}</span> <span className="text-gray-400">sélectionnés</span>
                        </div>
                        <div className="h-8 w-px bg-white/10 mx-2"></div>
                        <Button size="sm" onClick={() => setIsCompareOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
                            Comparer
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setCompareList([])} className="h-8 w-8 text-gray-400 hover:text-white">
                            <span className="sr-only">Effacer</span>
                            ×
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                {!loading && projects.length === 0 && (
                    <p className="col-span-full text-center text-gray-500 py-16">Aucune opportunité de financement ouverte pour le moment.</p>
                )}
                {projects.map((opp) => {
                    const fundingProgress = opp.targetAmount > 0 ? (opp.raisedAmount / opp.targetAmount) * 100 : 0;
                    return (
                    <motion.div key={opp.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                        <Card className="glass-effect h-full flex flex-col hover:border-emerald-500/50 transition-all group relative">
                             <div className="absolute top-4 right-4 z-10">
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-2 cursor-pointer bg-black/40 backdrop-blur px-2 py-1 rounded-full border border-white/10 hover:border-emerald-500/50 transition-colors">
                                        <Checkbox
                                            className="w-4 h-4 rounded-full border-white/50 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                            checked={!!compareList.find(p => p.id === opp.id)}
                                            onCheckedChange={() => toggleCompare(opp)}
                                        />
                                        <span className="text-xs text-white">Comparer</span>
                                    </label>
                                </div>
                            </div>

                            <CardHeader>
                                <div className="flex justify-between items-start mb-2">
                                    <Badge variant="outline" className="border-blue-500 text-blue-400"><Leaf className="w-3 h-3 mr-1"/>{opp.sector}</Badge>
                                </div>
                                <CardTitle className="text-white text-xl">{opp.name}</CardTitle>
                                <CardDescription className="text-gray-400 flex items-center gap-1">
                                    <MapPin className="w-3 h-3"/> {opp.location}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 flex-1">
                                <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                                        style={{ width: `${fundingProgress}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>{formatCurrency(opp.raisedAmount)} levés</span>
                                    <span>Objectif: {formatCurrency(opp.targetAmount)}</span>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                                    <div className="bg-white/5 p-2 rounded">
                                        <p className="text-gray-500 flex items-center gap-1"><TrendingUp className="w-3 h-3"/> Taux</p>
                                        <p className="font-bold text-emerald-400 text-lg">{opp.expectedReturn}%</p>
                                    </div>
                                    <div className="bg-white/5 p-2 rounded">
                                        <p className="text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3"/> Ticket Min.</p>
                                        <p className="font-bold text-white text-lg">{formatCurrency(opp.minimumTicket)}</p>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="gap-2">
                                <Button className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500" onClick={() => { setSelectedProject(opp); setShowDetails(true); }}>
                                    <FileText className="w-4 h-4 mr-2"/> Prospectus & Souscription
                                </Button>
                            </CardFooter>
                        </Card>
                    </motion.div>
                );})}
            </div>

            <ProjectDetailsModal
                project={selectedProject}
                isOpen={showDetails}
                onClose={() => { setShowDetails(false); setSelectedProject(null); }}
                onInvest={loadProjects}
            />

            <ComparisonDialog
                open={isCompareOpen}
                onOpenChange={setIsCompareOpen}
                projects={compareList}
            />
        </Layout>
    );
};

export default Opportunities;
