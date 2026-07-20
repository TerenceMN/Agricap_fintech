import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout, { menuKeyFor } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PiggyBank, Plus, ShieldCheck, Banknote, Smartphone, Wallet, User, Landmark, Calculator, TrendingUp, ArrowUpRight, ArrowDownLeft, Users, Building, Hourglass, CheckCircle2, Factory, Truck, Sprout, Briefcase, Home } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext.jsx';
import AdminSavingsDashboard from '@/components/admin/savings/AdminSavingsDashboard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/services/api';

// --- Types ---
const AGRO_OBJECTIVES = [
    { id: 'investissement', label: 'Investissement', icon: TrendingUp },
    { id: 'production', label: 'Production', icon: Sprout },
    { id: 'transformation', label: 'Transformation', icon: Factory },
    { id: 'commercialisation', label: 'Commercialisation', icon: Truck },
    { id: 'reserves', label: 'Réserves', icon: PiggyBank },
    { id: 'actions', label: "Acquisition d'actions", icon: Briefcase },
    { id: 'immobilier', label: "Acquisition d'immobiliers", icon: Home },
    { id: 'autre', label: 'Autres', icon: User },
];

// --- Utils ---
const calculateCompoundInterest = (principal, rate, years, frequency = 1) => {
  // A = P(1 + r/n)^(nt)
  const r = rate / 100;
  const n = frequency; // times per year
  const t = years;
  const amount = principal * Math.pow((1 + r/n), (n * t));
  return amount - principal;
};

// --- Modals ---
const ConfirmationModal = ({ open, onOpenChange, plan, onConfirm }) => {
  const [agreed, setAgreed] = useState(false);
  if (!plan) return null;

  const objLabel = AGRO_OBJECTIVES.find(o => o.id === plan.objectiveType)?.label || plan.objectiveType;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white [&>option]:bg-slate-800 [&>option]:text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold gradient-text">Confirmer votre Objectif Agrobusiness</DialogTitle>
          <DialogDescription className="text-gray-400">
            Veuillez vérifier les détails de votre plan avant de le finaliser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 my-4">
          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-sm text-gray-400">Nom / Catégorie</p>
            <p className="font-bold text-lg text-emerald-400">{plan.name} ({objLabel})</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
              <p className="text-sm text-gray-400">Cible</p>
              <p className="font-bold text-lg">{plan.objectif} {plan.currency}</p>
            </div>
            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
              <p className="text-sm text-gray-400">Durée</p>
              <p className="font-bold text-lg">{plan.duree} mois</p>
            </div>
          </div>
          <div className="p-4 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-400 capitalize">Dépôt {plan.frequence}</p>
              <p className="font-bold text-lg">{plan.depotPeriodique} {plan.currency}</p>
            </div>
            <div className="text-right">
               <p className="text-sm text-gray-400">Intérêts Estimés</p>
               <p className="font-bold text-lg text-emerald-400">+{plan.interetsEstimes} {plan.currency}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2 mt-4">
          <Checkbox id="terms" checked={agreed} onCheckedChange={setAgreed} className="border-emerald-400" />
          <label htmlFor="terms" className="text-sm font-medium text-gray-300">
            J'accepte les <a href="#" className="underline text-emerald-400">termes et conditions</a> d'AGRICAP.
          </label>
        </div>
        <DialogFooter className="mt-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={onConfirm} disabled={!agreed} className="bg-gradient-to-r from-emerald-500 to-blue-600 disabled:opacity-50">
            <ShieldCheck className="w-4 h-4 mr-2" />
            Confirmer et Activer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DepositModal = ({ open, onOpenChange, plan, onDeposit, user }) => {
  const [formData, setFormData] = useState({
    amount: '',
    channel: 'mobile_money',
    reference: '',
    note: '',
    agreed: false
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };
  
  const resetAndClose = () => {
    setFormData({ amount: '', channel: 'mobile_money', reference: '', note: '', agreed: false });
    onOpenChange(false);
  };

  const handleConfirmDeposit = (e) => {
    e.preventDefault();
    onDeposit(plan.id, parseFloat(formData.amount), formData.channel);
    resetAndClose();
  };
  
  const channelIcons = {
    agent: User,
    mobile_money: Smartphone,
    bank: Landmark,
    wallet: Wallet,
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="glass-effect text-white [&>option]:bg-slate-800 [&>option]:text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold gradient-text">Effectuer un Dépôt Sécurisé</DialogTitle>
          <DialogDescription className="text-gray-400">
            Alimentez votre plan d'épargne : {plan?.name || plan?.id}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleConfirmDeposit} className="space-y-4 my-4">
          <div>
            <Label htmlFor="amount">Montant du Dépôt ({plan?.currency})</Label>
            <Input id="amount" name="amount" type="number" value={formData.amount} onChange={handleChange} className="bg-white/5 mt-1 border-white/10" required />
          </div>
          <div>
            <Label>Canal de Dépôt</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries({agent: "Agent Agricap", mobile_money: "Mobile Money", bank: "Compte Bancaire"}).map(([key, label]) => {
                const Icon = channelIcons[key];
                return (
                  <Button key={key} type="button" variant={formData.channel === key ? "secondary" : "outline"} onClick={() => setFormData(p => ({...p, channel: key}))} className={`flex-1 ${formData.channel === key ? "bg-emerald-500/20 text-emerald-300 border-emerald-400" : "border-white/10"}`}>
                    <Icon className="w-4 h-4 mr-2" />
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          {(formData.channel === 'mobile_money' || formData.channel === 'bank') && (
            <div>
              <Label htmlFor="reference">Référence Transaction</Label>
              <Input id="reference" name="reference" value={formData.reference} onChange={handleChange} className="bg-white/5 mt-1 border-white/10" required />
            </div>
          )}
          <div className="flex items-start space-x-3 pt-2">
            <Checkbox id="agreed" name="agreed" checked={formData.agreed} onCheckedChange={(checked) => setFormData(p => ({...p, agreed: checked}))} required className="mt-1" />
            <div className="grid gap-1.5 leading-none">
              <label htmlFor="agreed" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Je confirme l'exactitude des informations et le dépôt autorisé.
              </label>
            </div>
          </div>
          <DialogFooter className="!mt-6">
            <Button type="button" variant="ghost" onClick={resetAndClose}>Annuler</Button>
            <Button type="submit" disabled={!formData.agreed || !formData.amount} className="bg-gradient-to-r from-emerald-500 to-blue-600">
              <Banknote className="w-4 h-4 mr-2" /> Valider le Dépôt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// --- Group Join Modal ---
const JoinGroupModal = ({ open, onOpenChange, onJoinRequest, user }) => {
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (open) api.savings.groups.list().then(setGroups).catch(() => {});
    }, [open]);

    const handleSubmit = () => {
        if (selectedGroup && reason) {
            onJoinRequest(selectedGroup, reason);
            onOpenChange(false);
            setReason('');
            setSelectedGroup('');
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white [&>option]:bg-slate-800 [&>option]:text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl"><Users className="text-blue-400"/> Rejoindre un Groupe</DialogTitle>
                    <DialogDescription>Demandez à rejoindre une coopérative, une AVEC ou une mutuelle existante.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Sélectionner un groupe</Label>
                        <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                            <SelectTrigger className="bg-slate-900 border-slate-700"><SelectValue placeholder="Choisir un groupe..." /></SelectTrigger>
                            <SelectContent>
                                {groups.map(g => (
                                    <SelectItem key={g.id} value={String(g.id)}>{g.name} ({g.type}) - Taux: {g.rate}%</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Motif de la demande</Label>
                        <Textarea 
                            value={reason} 
                            onChange={e => setReason(e.target.value)} 
                            placeholder="Pourquoi souhaitez-vous rejoindre ce groupe ?"
                            className="bg-slate-900 border-slate-700"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleSubmit} disabled={!selectedGroup || !reason} className="bg-blue-600 hover:bg-blue-700">Envoyer Demande</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// --- Savings Calculator Component ---
const SavingsCalculator = ({ onPlanCalculated }) => {
  const [form, setForm] = useState({ 
      name: '',
      type: 'campagne', 
      objectiveType: 'investissement',
      objectif: 500, 
      duree: 6, 
      frequence: 'hebdomadaire', 
      currency: 'USD' 
  });
  const [result, setResult] = useState(null);
  const [manualDuree, setManualDuree] = useState(false);

  // Mock rates based on type
  const RATES = {
    'campagne': 4.5,
    'equipement': 3.8,
    'groupee': 5.2
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'duree' && value === 'manual') {
      setManualDuree(true);
      setForm(prev => ({ ...prev, duree: 13 }));
    } else {
      if (name === 'duree') setManualDuree(false);
      setForm(prev => ({ ...prev, [name]: value }));
    }
    setResult(null);
  };
  
  const handleSelectChange = (field, value) => {
      setForm(prev => ({ ...prev, [field]: value }));
      setResult(null);
  };

  const calculatePlan = () => {
    const { type, objectif, duree, frequence } = form;
    let periodes = 0;
    if (frequence === 'journalier') periodes = duree * 30;
    else if (frequence === 'hebdomadaire') periodes = duree * 4;
    else if (frequence === 'mensuel') periodes = duree;
    
    if (periodes === 0 || duree <= 0) return;
    
    const depotPeriodique = objectif / periodes;
    
    // Calculate simple interest estimate
    const rate = RATES[type];
    const interest = calculateCompoundInterest(objectif / 2, rate, duree / 12); // Approximate on avg balance
    
    const newResult = { 
        depotPeriodique: depotPeriodique.toFixed(2),
        interetsEstimes: interest.toFixed(2),
        taux: rate
    };
    setResult(newResult);
  };
  
  const handleCreatePlan = () => {
    onPlanCalculated({ ...form, ...result, name: form.name || `Mon Projet ${form.objectiveType}` });
    setResult(null);
    setForm(prev => ({ ...prev, name: '' }));
  };

  return (
     <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="glass-effect rounded-2xl p-8 space-y-6">
        <h3 className="text-2xl font-bold text-white flex items-center gap-3 [&>option]:bg-slate-800 [&>option]:text-white"><Calculator className="text-emerald-400"/> Calculateur de Plan</h3>
        
        <div className="space-y-4">
             <div>
                <Label htmlFor="name">Nom du Projet Agrobusiness</Label>
                <Input id="name" name="name" value={form.name} onChange={handleChange} className="bg-white/5 border-white/10 mt-1" placeholder="Ex: Achat Tracteur" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="type">Formule Épargne</Label>
                    <select id="type" name="type" value={form.type} onChange={handleChange} className="w-full mt-1 p-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm [&>option]:bg-slate-800 [&>option]:text-white">
                        <option value="campagne">Campagne (4.5%)</option>
                        <option value="equipement">Équipement (3.8%)</option>
                        <option value="groupee">Groupée (5.2%)</option>
                    </select>
                </div>
                <div>
                    <Label>Type d'Objectif</Label>
                    <Select value={form.objectiveType} onValueChange={(v) => handleSelectChange('objectiveType', v)}>
                         <SelectTrigger className="bg-white/5 border-white/10 mt-1"><SelectValue/></SelectTrigger>
                         <SelectContent>
                             {AGRO_OBJECTIVES.map(type => (
                                 <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                             ))}
                         </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
                <Label htmlFor="objectif">Montant Cible</Label>
                <Input type="number" id="objectif" name="objectif" value={form.objectif} onChange={handleChange} className="bg-white/5 border-white/10 mt-1" />
            </div>
            <div>
                <Label htmlFor="currency">Devise</Label>
                <Select onValueChange={(v) => handleSelectChange('currency', v)} value={form.currency}>
                <SelectTrigger id="currency" className="bg-white/5 border-white/10 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
                </Select>
            </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="duree">Durée (mois)</Label>
                    <div className="flex gap-2">
                        <select id="duree-select" name="duree" value={manualDuree ? 'manual' : form.duree} onChange={handleChange} className="w-full mt-1 p-2 bg-white/5 border border-white/10 rounded-lg text-white h-10 text-sm [&>option]:bg-slate-800 [&>option]:text-white">
                        <option value="1">1 mois</option><option value="3">3 mois</option><option value="6">6 mois</option><option value="12">12 mois</option><option value="manual">Autre...</option>
                        </select>
                        {manualDuree && <Input type="number" name="duree" min="13" value={form.duree} onChange={handleChange} className="bg-white/5 border-white/10 w-24 mt-1" placeholder="Mois"/>}
                    </div>
                </div>
                <div>
                    <Label htmlFor="frequence">Fréquence de dépôt</Label>
                    <select id="frequence" name="frequence" value={form.frequence} onChange={handleChange} className="w-full mt-1 p-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm [&>option]:bg-slate-800 [&>option]:text-white">
                        <option value="journalier">Journalier</option><option value="hebdomadaire">Hebdomadaire</option><option value="mensuel">Mensuel</option>
                    </select>
                </div>
            </div>
        </div>
        
        <Button onClick={calculatePlan} className="w-full bg-gradient-to-r from-emerald-500 to-blue-600 font-bold py-6 text-lg"><Calculator className="w-5 h-5 mr-2" />Calculer mon Plan</Button>
      </div>
      <AnimatePresence>
      {result && (
        <motion.div initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0, x:20}} className="glass-effect rounded-2xl p-8 bg-white/10 flex flex-col justify-center border border-emerald-500/30">
          <h3 className="text-2xl font-bold text-white mb-6 [&>option]:bg-slate-800 [&>option]:text-white">Votre Projection</h3>
          <div className="space-y-4 text-center">
              <div className="bg-white/5 p-4 rounded-lg border border-white/5">
                <p className="text-gray-400 text-sm capitalize">Dépôt {form.frequence} suggéré</p>
                <p className="font-bold text-3xl text-white [&>option]:bg-slate-800 [&>option]:text-white">{result.depotPeriodique} {form.currency}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                   <div className="bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/20">
                    <p className="text-emerald-300 text-sm">Taux Annuel</p>
                    <p className="font-bold text-2xl text-emerald-400">{result.taux}%</p>
                  </div>
                  <div className="bg-blue-500/10 p-4 rounded-lg border border-blue-500/20">
                    <p className="text-blue-300 text-sm">Intérêts (Est.)</p>
                    <p className="font-bold text-2xl text-blue-400">+{result.interetsEstimes}</p>
                  </div>
              </div>
          </div>
          <Button onClick={handleCreatePlan} className="w-full mt-8 bg-purple-600 hover:bg-purple-700 font-bold py-6 text-lg shadow-lg shadow-purple-900/20"><Plus className="w-5 h-5 mr-2" />Créer cet Objectif</Button>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
};

// --- Client View ---
const ClientSavingsView = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [savingsPlans, setSavingsPlans] = useState([]);
    const [myRequests, setMyRequests] = useState([]);
    const [activeGroups, setActiveGroups] = useState([]);
    const [planToConfirm, setPlanToConfirm] = useState(null);
    const [planToDeposit, setPlanToDeposit] = useState(null);
    const [isJoinGroupOpen, setIsJoinGroupOpen] = useState(false);

    const loadAll = () => {
        api.savings.myPlans().then(setSavingsPlans).catch(() => {});
        api.savings.myGroupRequests().then(setMyRequests).catch(() => {});
        api.savings.groups.mine().then(setActiveGroups).catch(() => {});
    };
    useEffect(() => { loadAll(); }, [user]);

    const handlePlanCalculated = (calculatedPlan) => {
        setPlanToConfirm(calculatedPlan);
    };

    const handleConfirmPlan = async () => {
        try {
            const plan = await api.savings.createPlan({
                name: planToConfirm.name, objectiveType: planToConfirm.objectiveType,
                type: planToConfirm.type, objectif: planToConfirm.objectif, currency: planToConfirm.currency,
            });
            setSavingsPlans(prev => [...prev, plan]);
            toast({ title: "Objectif créé !", description: "Un nouveau plan d'épargne a été ajouté à votre tableau de bord." });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
        setPlanToConfirm(null);
    };

    const handleDeposit = async (planId, amount, channel) => {
        try {
            const plan = await api.savings.deposit(planId, amount, channel);
            setSavingsPlans(prev => prev.map(p => p.id === planId ? plan : p));
            toast({ title: `Dépôt Réussi`, description: `Votre dépôt de ${amount} ${plan.currency} a été enregistré.` });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleJoinRequest = async (groupId, reason) => {
        try {
            await api.savings.groups.join(Number(groupId), reason);
            api.savings.myGroupRequests().then(setMyRequests).catch(() => {});
            toast({ title: "Demande envoyée", description: "L'administrateur du groupe examinera votre demande." });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const getObjectiveIcon = (type) => {
        const found = AGRO_OBJECTIVES.find(t => t.id === type);
        const Icon = found ? found.icon : PiggyBank;
        return <Icon className="w-8 h-8 text-white [&>option]:bg-slate-800 [&>option]:text-white"/>;
    };
    
    return (
        <div className="space-y-12">
            <ConfirmationModal open={!!planToConfirm} onOpenChange={() => setPlanToConfirm(null)} plan={planToConfirm} onConfirm={handleConfirmPlan} />
            <DepositModal open={!!planToDeposit} onOpenChange={() => setPlanToDeposit(null)} plan={planToDeposit} onDeposit={handleDeposit} user={user} />
            <JoinGroupModal open={isJoinGroupOpen} onOpenChange={setIsJoinGroupOpen} onJoinRequest={handleJoinRequest} user={user} />

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-4xl font-bold gradient-text mb-2">Mon Épargne & Objectifs</h1>
                <p className="text-gray-400">Gérez vos objectifs d'investissement et vos adhésions aux groupes agricoles.</p>
            </motion.div>

            {/* Section 1: Create Goal */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <SavingsCalculator onPlanCalculated={handlePlanCalculated} />
            </motion.div>
        
            {/* Section 2: My Goals */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2 [&>option]:bg-slate-800 [&>option]:text-white">
                    <Sprout className="text-emerald-400"/> Mes Objectifs Agrobusiness
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {savingsPlans.length === 0 ? (
                        <div className="col-span-full glass-effect rounded-2xl p-8 text-center"><p className="text-gray-400">Vous n'avez aucun objectif défini.</p></div>
                    ) : (
                        savingsPlans.map(plan => {
                            const progress = (plan.balance / plan.objectif) * 100;
                            const typeLabel = AGRO_OBJECTIVES.find(t => t.id === plan.objectiveType)?.label || plan.objectiveType;

                            return (
                                <motion.div key={plan.id} className="glass-effect rounded-2xl p-6 border border-white/5 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                        {getObjectiveIcon(plan.objectiveType)}
                                    </div>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-white [&>option]:bg-slate-800 [&>option]:text-white">{plan.name}</h3>
                                            <p className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded inline-block mt-1">{typeLabel} • {plan.interestRate}%</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-bold text-white font-mono [&>option]:bg-slate-800 [&>option]:text-white">{plan.balance.toLocaleString()} {plan.currency}</p>
                                            <p className="text-xs text-gray-500">sur {plan.objectif.toLocaleString()}</p>
                                        </div>
                                    </div>
                                    <div className="w-full bg-slate-800 rounded-full h-2 mb-4">
                                        <div className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full" style={{ width: `${Math.min(progress, 100)}%` }}></div>
                                    </div>
                                    <div className="flex justify-between items-center mt-4">
                                         <span className="text-xs text-gray-500 font-mono">{plan.id}</span>
                                         <Button size="sm" onClick={() => setPlanToDeposit(plan)} className="bg-emerald-600 hover:bg-emerald-700 h-8"><Plus className="w-4 h-4 mr-1"/> Dépôt</Button>
                                    </div>
                                </motion.div>
                            )
                        })
                    )}
                </div>
            </motion.div>

            {/* Section 3: Group Savings */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="pb-10">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
                    <div>
                         <h2 className="text-2xl font-bold text-white flex items-center gap-2 [&>option]:bg-slate-800 [&>option]:text-white">
                            <Users className="text-blue-400"/> Groupes & Coopératives
                        </h2>
                        <p className="text-sm text-slate-400 mt-1">Gérez vos adhésions aux mutuelles et groupes d'épargne.</p>
                    </div>
                   
                    <Button onClick={() => setIsJoinGroupOpen(true)} variant="outline" className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
                        Rejoindre un Groupe
                    </Button>
                </div>
                
                {/* Active Groups Grid */}
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                     {activeGroups.map(group => (
                         <div key={group.id} className="bg-gradient-to-br from-slate-900 to-slate-800 border border-blue-500/20 rounded-xl p-6 relative overflow-hidden">
                             <div className="absolute top-0 right-0 p-3 opacity-10">
                                 <Users className="w-16 h-16 text-blue-500"/>
                             </div>
                             <div className="relative z-10">
                                <h3 className="font-bold text-lg text-white mb-1 [&>option]:bg-slate-800 [&>option]:text-white">{group.name}</h3>
                                <Badge variant="outline" className="text-blue-300 border-blue-500/30 mb-4">{group.type}</Badge>
                                
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between border-b border-white/5 pb-2">
                                        <span className="text-slate-400">Solde Groupe</span>
                                        <span className="text-emerald-400 font-mono">{group.balance.toLocaleString()} $</span>
                                    </div>
                                    <div className="flex justify-between border-b border-white/5 pb-2">
                                        <span className="text-slate-400">Taux Intérêt</span>
                                        <span className="text-white [&>option]:bg-slate-800 [&>option]:text-white">{group.rate}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">Fréquence</span>
                                        <span className="text-white capitalize [&>option]:bg-slate-800 [&>option]:text-white">{group.frequency}</span>
                                    </div>
                                </div>
                                <Button className="w-full mt-6 bg-slate-700 hover:bg-slate-600 text-sm h-8">Voir Détails</Button>
                             </div>
                         </div>
                     ))}
                     
                     {/* Integration Requests */}
                     {myRequests.map(req => (
                        <div key={req.id} className="bg-slate-900/50 border border-slate-700 p-6 rounded-xl flex flex-col justify-between h-full">
                            <div>
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-semibold text-white [&>option]:bg-slate-800 [&>option]:text-white">{req.groupName}</h4>
                                     <Badge variant="outline" className={`
                                        ${req.status === 'pending' ? 'text-amber-400 border-amber-500/30' : 
                                          req.status === 'approved' ? 'text-emerald-400 border-emerald-500/30' : 
                                          'text-red-400 border-red-500/30'}
                                    `}>
                                        {req.status === 'pending' ? 'En Attente' : req.status === 'approved' ? 'Approuvé' : 'Rejeté'}
                                    </Badge>
                                </div>
                                <p className="text-xs text-slate-400 mb-4">Demande envoyée le {new Date(req.date).toLocaleDateString()}</p>
                                <p className="text-sm text-slate-300 bg-slate-800 p-3 rounded-lg italic">"{req.reason}"</p>
                            </div>
                        </div>
                    ))}
                 </div>

                {activeGroups.length === 0 && myRequests.length === 0 && (
                     <div className="glass-effect rounded-2xl p-12 text-center border border-white/5 border-dashed">
                        <Users className="w-16 h-16 text-slate-600 mx-auto mb-4"/>
                        <h3 className="text-xl font-bold text-white mb-2 [&>option]:bg-slate-800 [&>option]:text-white">Aucune adhésion active</h3>
                        <p className="text-gray-400 max-w-lg mx-auto">Rejoignez des mutuelles de solidarité (MUSO) ou des coopératives pour accéder à des taux préférentiels et garantir des crédits de groupe.</p>
                        <Button onClick={() => setIsJoinGroupOpen(true)} className="mt-6 bg-blue-600 hover:bg-blue-700">Explorer les Groupes</Button>
                    </div>
                )}
            </motion.div>
        </div>
    );
};


// --- Main Savings Page ---
const Savings = () => {
  const { user } = useAuth();
  
  return (
    <Layout>
      <Helmet><title>Épargne - AGRICAP FINTECH</title><meta name="description" content="Constituez et gérez votre épargne agricole." /></Helmet>
      
      {menuKeyFor(user) === 'admin' ? (
        <>
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <h1 className="text-4xl font-bold gradient-text mb-2">Gestion de l'Épargne</h1>
                <p className="text-gray-400">Vue d'overview des flux d'épargne et de la liquidité.</p>
            </motion.div>
            <AdminSavingsDashboard />
        </>
      ) : (
        <ClientSavingsView />
      )}
    </Layout>
  );
};

export default Savings;