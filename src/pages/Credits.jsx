import React, { useState, useMemo, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext.jsx';
import AdminCreditsDashboard from '@/components/admin/credits/CreditsDashboard.jsx';
import { api, ApiError } from '@/services/api';

import { 
    BarChart, Check, ChevronsRight, FileText, Leaf, Send, Shield, Sparkles, TrendingUp, Users, ArrowLeft, RefreshCw, Info, FileUp, Banknote, History, Shuffle, Plus, Building, Car, PiggyBank, HeartHandshake as Handshake, FileSignature, User, Landmark, Repeat, CalendarDays, AlertTriangle, Package, ShieldCheck
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Badge } from '@/components/ui/badge';

// =================================================================
// ===== CLIENT VIEW COMPONENTS (EXISTING & UPDATED) ===============
// =================================================================

const STEPS = [
  { id: 1, name: 'Demande Initiale' },
  { id: 2, name: 'Simulation & Scoring' },
  { id: 3, name: 'Garanties' },
  { id: 4, name: 'Synthèse & Soumission' },
];

const MODULES_CONFIG = {
  semences: { label: 'Semences & Intrants', icon: Leaf, color: '#34d399' },
  mecanisation: { label: 'Opérations mécanisées', icon: Sparkles, color: '#60a5fa' },
  mainDoeuvre: { label: 'Main-d\'œuvre', icon: Users, color: '#f87171' },
  equipements: { label: 'Équipements & Machines', icon: TrendingUp, color: '#fbbf24' },
  postRecolte: { label: 'Récolte & Post-récolte', icon: ChevronsRight, color: '#c084fc' },
  logistique: { label: 'Logistique', icon: Car, color: '#fdba74' },
  commercialisation: { label: 'Commercialisation', icon: BarChart, color: '#a78bfa' },
  reserve: { label: 'Réserve d\'exploitation', icon: Shield, color: '#9ca3af' },
};

const DemandeInitiale = ({ formData, setFormData, nextStep, prefill }) => {
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  const handleCurrencyChange = (value) => setFormData(prev => ({ ...prev, currency: value }));
  const handleVcChange = (value) => setFormData(prev => ({ ...prev, vcCode: value }));

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormData(prev => ({ ...prev, nsFile: file, nsResult: null }));
    // Parse immédiatement si un fichier est sélectionné
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (formData.vcCode) fd.append('value_chain_code', formData.vcCode);
      if (formData.superficie) fd.append('area_ha', formData.superficie);
      if (formData.currency) fd.append('currency', formData.currency);
      const result = await api.credits.parseNeedsSheet(fd);
      setFormData(prev => ({
        ...prev,
        nsFile: file,
        nsResult: result,
        // La feuille de besoins est la source de vérité pour le montant
        montant: String(Math.round(result.grandTotal)),
        superficie: prev.superficie || (result.area_ha ? String(result.area_ha) : prev.superficie),
      }));
    } catch (_) { /* silencieux */ }
  };

  const isValid = formData.montant && parseFloat(formData.montant) > 0;

  return (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">

       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><Label htmlFor="demandeur">Nom du demandeur / Coopérative</Label><Input id="demandeur" name="demandeur" value={formData.demandeur} onChange={handleChange} className="bg-white/5" /></div>
        <div><Label htmlFor="localisation">Localisation</Label><Input id="localisation" name="localisation" value={formData.localisation} onChange={handleChange} className="bg-white/5" /></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="vcCode">Filière agricole</Label>
          {prefill?.valueChains?.length > 0 ? (
            <Select onValueChange={handleVcChange} value={formData.vcCode}>
              <SelectTrigger id="vcCode" className="bg-white/5"><SelectValue placeholder="Choisir une filière..." /></SelectTrigger>
              <SelectContent>
                {prefill.valueChains.map(vc => <SelectItem key={vc.code} value={vc.code}>{vc.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input id="culture" name="culture" value={formData.culture} onChange={handleChange} placeholder="Ex: Café, Maïs..." className="bg-white/5" />
          )}
        </div>
        <div><Label htmlFor="superficie">Superficie (ha)</Label><Input type="number" id="superficie" name="superficie" value={formData.superficie} onChange={handleChange} className="bg-white/5" /></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2"><Label htmlFor="montant">Montant total souhaité *</Label><Input type="number" id="montant" name="montant" value={formData.montant} onChange={handleChange} className="bg-white/5" /></div>
        <div><Label htmlFor="currency">Devise</Label>
          <Select onValueChange={handleCurrencyChange} value={formData.currency}>
            <SelectTrigger id="currency" className="bg-white/5"><SelectValue placeholder="Devise..." /></SelectTrigger>
            <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="financialPlan">Feuille de besoins (Excel, optionnel)</Label>
        <div className="relative">
          <Input id="financialPlan" type="file" onChange={handleFileChange}
            className="bg-white/5 file:bg-emerald-500/20 file:text-emerald-300 file:border-none file:px-4 file:py-2 file:rounded-lg file:mr-4 hover:file:bg-emerald-500/30 cursor-pointer" accept=".xls,.xlsx" />
          <FileUp className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        </div>
        {formData.vcCode && (
          <a href={api.credits.templateUrl(formData.vcCode)} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
            ↓ Télécharger le gabarit {formData.vcCode}
          </a>
        )}
        {formData.nsResult && (
          <p className="text-xs text-emerald-300">✓ Feuille parsée — Total : {formData.nsResult.grandTotal?.toLocaleString('fr-FR')} {formData.nsResult.currency}</p>
        )}
      </div>

      <Button onClick={nextStep} disabled={!isValid} className="w-full bg-gradient-to-r from-emerald-500 to-blue-600 py-6 text-lg disabled:opacity-50">
        Simuler mon crédit <ArrowLeft className="w-5 h-5 ml-2 transform rotate-180" />
      </Button>
    </motion.div>
  );
};

const DonutChartScore = ({ score }) => {
    const radius = 60; const circumference = 2 * Math.PI * radius; const offset = circumference - (score / 100) * circumference;
    const scoreColor = score > 85 ? '#34d399' : score > 70 ? '#60a5fa' : score > 50 ? '#fbbf24' : '#f87171';
    const scoreLetter = score > 85 ? 'A' : score > 70 ? 'B' : score > 50 ? 'C' : 'D';
    return (<div className="relative flex items-center justify-center w-48 h-48"><svg className="w-full h-full" viewBox="0 0 150 150"><circle cx="75" cy="75" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="15"/><motion.circle cx="75" cy="75" r={radius} fill="none" stroke={scoreColor} strokeWidth="15" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 75 75)" initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={{ duration: 1.5, ease: "easeOut" }}/></svg><div className="absolute flex flex-col items-center justify-center"><span className="text-sm text-gray-400">Score</span><span className="text-5xl font-black" style={{ color: scoreColor }}>{scoreLetter}</span><span className="font-bold">{score.toFixed(0)}/100</span></div></div>);
};

const SimulateurIntelligent = ({ formData, setFormData, nextStep, prevStep, runSimulation }) => {
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState(formData.simResult || null);
  const [modules, setModules] = useState(() => {
    const init = {};
    Object.keys(MODULES_CONFIG).forEach(key => {
      init[key] = { cost: 0, financing: 100, active: false };
    });
    // Peupler depuis la feuille de besoins parsée (données réelles)
    if (formData.nsResult?.totalByModule) {
      Object.entries(formData.nsResult.totalByModule).forEach(([mod, cost]) => {
        if (MODULES_CONFIG[mod]) init[mod] = { cost: Math.round(cost), financing: 100, active: cost > 0 };
      });
    }
    return init;
  });

  const handleModuleChange = (key, field, value) => setModules(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const { totalFinanced, scoreLocal, pieData } = useMemo(() => {
    const totalFinanced = Object.values(modules).reduce((s, m) => s + (m.active ? m.cost * m.financing / 100 : 0), 0);
    const scoreLocal = simResult
      ? simResult.score
      : Math.min(100, 30 + (parseFloat(formData.montant) > 0 ? (totalFinanced / parseFloat(formData.montant)) * 40 : 0) + (parseFloat(formData.superficie) > 0 ? 15 : 0) + 15);
    const pieData = Object.entries(modules)
      .filter(([, m]) => m.active)
      .map(([k, v]) => ({ name: MODULES_CONFIG[k].label, value: v.cost * v.financing / 100, color: MODULES_CONFIG[k].color }));
    return { totalFinanced, scoreLocal, pieData };
  }, [modules, formData, simResult]);

  const handleSimulate = async () => {
    setSimLoading(true);
    const result = await runSimulation(formData);
    if (result) setSimResult(result);
    setSimLoading(false);
  };

  const handleSubmit = () => {
    setFormData(prev => ({ ...prev, modules, totalFinanced, score: scoreLocal, simResult }));
    nextStep();
  };

  return (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
      <div className="flex flex-col lg:flex-row items-center justify-around gap-8 glass-effect p-6 rounded-2xl">
        <DonutChartScore score={scoreLocal} />
        <div className="text-center lg:text-left">
          <h3 className="text-2xl font-bold text-white">Simulation de crédit</h3>
          {simResult ? (
            <div className="mt-2 space-y-1">
              <p className={`font-semibold ${simResult.eligible ? 'text-emerald-400' : 'text-red-400'}`}>
                {simResult.eligible ? '✓ Éligible' : '✗ Non éligible'}
              </p>
              <p className="text-sm text-gray-400">{simResult.valuationNote}</p>
              {simResult.proposedRate && (
                <p className="text-sm">Taux indicatif : <b className="text-blue-300">{simResult.proposedRate}%/an</b></p>
              )}
            </div>
          ) : (
            <p className="text-gray-400 mt-1">Cliquez sur « Simuler via l'API » pour obtenir une simulation réelle.</p>
          )}
          <div className="mt-4 glass-effect p-4 rounded-lg inline-block">
            <p className="text-sm text-gray-400">Montant total financé</p>
            <p className="text-3xl font-bold text-emerald-400">{totalFinanced.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {formData.currency}</p>
          </div>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={handleSimulate} disabled={simLoading} className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10">
              {simLoading ? 'Simulation en cours…' : '↻ Simuler via l\'API'}
            </Button>
          </div>
        </div>
        <div className="glass-effect p-4 rounded-2xl w-full lg:w-72">
          <h4 className="font-bold text-white text-center mb-2">Répartition</h4>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50} fill="#8884d8" paddingAngle={5}>
              {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
            </Pie><RechartsTooltip contentStyle={{ backgroundColor: 'rgba(30,41,59,0.8)', border: 'none', borderRadius: '0.5rem' }}/></PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(modules).map(([key, mod]) => {
          const Icon = MODULES_CONFIG[key].icon;
          return (
            <div key={key} className={`glass-effect p-4 rounded-lg transition-all duration-300 ${!mod.active && 'opacity-50'}`}>
              <div className="flex justify-between items-center mb-2">
                <Label className="flex items-center gap-2 text-white"><Icon className="w-4 h-4" style={{color: MODULES_CONFIG[key].color}}/>{MODULES_CONFIG[key].label}</Label>
                <Switch checked={mod.active} onCheckedChange={(val) => handleModuleChange(key, 'active', val)} />
              </div>
              <div className={`space-y-3 mt-2 transition-all duration-300 ${!mod.active ? 'max-h-0 overflow-hidden opacity-0' : 'max-h-40 opacity-100'}`}>
                <div className="flex justify-between items-center">
                  <Label htmlFor={`cost-${key}`} className="text-sm">Coût estimé</Label>
                  <Input id={`cost-${key}`} type="number" value={mod.cost} onChange={(e) => handleModuleChange(key, 'cost', parseInt(e.target.value) || 0)} className="w-32 bg-white/5 h-8 text-right" disabled={!mod.active} />
                </div>
                <div>
                  <Label className="text-sm">Financement : <span className="font-bold text-emerald-400">{mod.financing}%</span></Label>
                  <Slider value={[mod.financing]} onValueChange={(val) => handleModuleChange(key, 'financing', val[0])} max={100} step={1} disabled={!mod.active} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Détail du scoring par critère */}
      {simResult?.breakdown?.length > 0 && (
        <div className="glass-effect p-5 rounded-2xl space-y-3">
          <h4 className="font-bold text-white mb-1">Analyse par critère</h4>
          {simResult.breakdown.map(c => (
            <div key={c.code}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-300">{c.label}</span>
                <span className="font-semibold text-white">{c.points}/100 <span className="text-gray-500 font-normal">× {Math.round(c.weight * 100)}% = {c.weightedScore.toFixed(1)} pts</span></span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5">
                <div className="h-1.5 rounded-full" style={{ width: `${c.points}%`, background: c.points >= 70 ? '#10b981' : c.points >= 50 ? '#f59e0b' : '#ef4444' }} />
              </div>
              {c.detail && <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>}
            </div>
          ))}
          {simResult.refData && (
            <div className="mt-2 pt-2 border-t border-white/10 text-xs text-gray-500 space-y-0.5">
              <p>Référentiel : <span className="text-gray-400">{simResult.refData.source}</span></p>
              {simResult.refData.dscr && <p>DSCR calculé : <span className="text-blue-300">{simResult.refData.dscr}</span></p>}
              <p>Durée : {simResult.refData.durationMonths} mois · Différé : {simResult.refData.deferredMonths} mois · Taux : {(simResult.refData.rateAnnual * 100).toFixed(1)}%/an</p>
            </div>
          )}
        </div>
      )}

      {/* Tableau d'amortissement (5 premières échéances) */}
      {simResult?.scheduleDraft?.length > 0 && (
        <div className="glass-effect p-5 rounded-2xl overflow-x-auto">
          <h4 className="font-bold text-white mb-3">Échéancier prévisionnel</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-left pb-2">Mois</th>
                <th className="text-right pb-2">Principal</th>
                <th className="text-right pb-2">Intérêts</th>
                <th className="text-right pb-2">Mensualité</th>
                <th className="text-right pb-2">Solde</th>
              </tr>
            </thead>
            <tbody>
              {simResult.scheduleDraft.slice(0, 6).map(row => (
                <tr key={row.month} className="border-b border-white/5 text-gray-300">
                  <td className="py-1">{row.month}</td>
                  <td className="py-1 text-right">{row.principal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
                  <td className="py-1 text-right text-amber-400">{row.interest.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
                  <td className="py-1 text-right font-semibold text-emerald-400">{row.payment.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
                  <td className="py-1 text-right text-gray-400">{row.balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
              {simResult.scheduleDraft.length > 6 && (
                <tr className="text-gray-500 text-xs">
                  <td colSpan={5} className="pt-2">… {simResult.scheduleDraft.length - 6} échéances supplémentaires</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between">
        <Button onClick={prevStep} variant="ghost"><ArrowLeft className="w-5 h-5 mr-2"/> Retour</Button>
        <Button onClick={handleSubmit} className="bg-gradient-to-r from-emerald-500 to-blue-600 py-6 text-lg">
          Choisir mes garanties <ArrowLeft className="w-5 h-5 ml-2 transform rotate-180" />
        </Button>
      </div>
    </motion.div>
  );
};

const ConfigurationGaranties = ({ formData, setFormData, nextStep, prevStep }) => {
  const [selectedGuarantees, setSelectedGuarantees] = useState(formData.guarantees || []);
  const [availableAssets, setAvailableAssets] = useState([]);
  
  useEffect(() => {
    api.assets.mine().then(setAvailableAssets).catch(() => setAvailableAssets([]));
  }, []);

  const toggleGuarantee = (type, id = null, details = {}) => {
    setSelectedGuarantees(prev => {
      const exists = prev.find(g => g.type === type && g.id === id);
      if (exists) {
        return prev.filter(g => !(g.type === type && g.id === id));
      } else {
        return [...prev, { type, id, ...details }];
      }
    });
  };

  const handleNext = () => {
    setFormData(prev => ({ ...prev, guarantees: selectedGuarantees }));
    nextStep();
  };

  return (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
       <div className="glass-effect p-6 rounded-2xl mb-6">
         <h3 className="text-xl font-bold text-white mb-2">Sélection des Garanties</h3>
         <p className="text-gray-400">Pour sécuriser votre crédit, veuillez sélectionner une ou plusieurs garanties. Le montant total du crédit influence les garanties requises.</p>
       </div>

       <div className="space-y-4">
          {/* Moral / Solidarity */}
          <div className={`p-4 rounded-xl border transition-all ${selectedGuarantees.find(g => g.type === 'morale') ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-white/5 border-white/10'}`}>
            <div className="flex items-start gap-3">
              <Checkbox id="moral" checked={!!selectedGuarantees.find(g => g.type === 'morale')} onCheckedChange={() => toggleGuarantee('morale', 'gm1', { label: 'Garantie Solidaire (Coopérative)' })} />
              <div className="flex-1">
                 <Label htmlFor="moral" className="text-base font-semibold text-white">Garantie Morale / Solidaire</Label>
                 <p className="text-sm text-gray-400 mt-1">Caution solidaire fournie par votre coopérative ou groupe d'appartenance.</p>
              </div>
              <Handshake className="text-emerald-400 w-6 h-6" />
            </div>
          </div>

           {/* Savings Pledge */}
           <div className={`p-4 rounded-xl border transition-all ${selectedGuarantees.find(g => g.type === 'epargne') ? 'bg-purple-500/10 border-purple-500/50' : 'bg-white/5 border-white/10'}`}>
            <div className="flex items-start gap-3">
              <Checkbox id="savings" checked={!!selectedGuarantees.find(g => g.type === 'epargne')} onCheckedChange={() => toggleGuarantee('epargne', 'ep1', { label: 'Nantissement Épargne (20%)', value: formData.totalFinanced * 0.2 })} />
              <div className="flex-1">
                 <Label htmlFor="savings" className="text-base font-semibold text-white">Nantissement Épargne</Label>
                 <p className="text-sm text-gray-400 mt-1">Blocage temporaire de 20% du montant du crédit sur votre compte épargne.</p>
              </div>
              <PiggyBank className="text-purple-400 w-6 h-6" />
            </div>
          </div>

          {/* Registered Assets */}
          <h4 className="font-semibold text-white mt-6 mb-2 flex items-center gap-2"><Package className="w-4 h-4"/> Mes Actifs Enregistrés</h4>
          {availableAssets.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableAssets.map(asset => {
                const isSelected = !!selectedGuarantees.find(g => g.id === asset.id);
                return (
                  <div key={asset.id} className={`p-4 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-blue-500/10 border-blue-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                       onClick={() => toggleGuarantee('actif', asset.id, { label: asset.name, value: asset.value })}>
                     <div className="flex justify-between items-start">
                       <div>
                         <p className="font-semibold text-white">{asset.name}</p>
                         <p className="text-xs text-gray-400">{asset.type} • {asset.value} {asset.currency}</p>
                       </div>
                       {isSelected && <Check className="w-5 h-5 text-blue-400" />}
                     </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center p-6 border border-dashed border-gray-600 rounded-xl">
              <p className="text-gray-500">Aucun actif enregistré. Ajoutez-en dans la section "Mes Actifs".</p>
            </div>
          )}
       </div>

       <div className="flex justify-between mt-8">
          <Button onClick={prevStep} variant="ghost"><ArrowLeft className="w-5 h-5 mr-2"/> Retour</Button>
          <Button onClick={handleNext} disabled={selectedGuarantees.length === 0} className="bg-gradient-to-r from-emerald-500 to-blue-600 py-6 text-lg">Voir la synthèse <ArrowLeft className="w-5 h-5 ml-2 transform rotate-180" /></Button>
       </div>
    </motion.div>
  );
};


const FicheSynthese = ({ formData, prevStep, submitApplication }) => (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
      <div className="glass-effect p-8 rounded-2xl">
        <h3 className="text-2xl font-bold text-white mb-6">Fiche de Synthèse Finale</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div className="bg-white/5 p-4 rounded-lg"><p className="text-sm text-gray-400">Demandeur</p><p className="font-bold">{formData.demandeur}</p></div>
          <div className="bg-white/5 p-4 rounded-lg"><p className="text-sm text-gray-400">Superficie</p><p className="font-bold">{formData.superficie} ha</p></div>
          <div className="bg-white/5 p-4 rounded-lg"><p className="text-sm text-gray-400">Culture</p><p className="font-bold">{formData.culture}</p></div>
          <div className="bg-white/5 p-4 rounded-lg col-span-2 md:col-span-1"><p className="text-sm text-gray-400">Montant total financé</p><p className="font-bold text-2xl text-emerald-400">{formData.totalFinanced?.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {formData.currency}</p></div>
          <div className="bg-white/5 p-4 rounded-lg text-center"><p className="text-sm text-gray-400">Score</p><p className="font-black text-4xl gradient-text">{formData.scoreLetter}</p></div>
          <div className="bg-white/5 p-4 rounded-lg text-center"><p className="text-sm text-gray-400">Taux indicatif</p><p className="font-bold text-2xl">{((100 - (formData.score || 0)) / 10 + 8).toFixed(1)}%</p></div>
        </div>
        
        <div className="mt-6">
           <h4 className="font-bold text-white mb-2">Garanties Sélectionnées</h4>
           <div className="flex flex-wrap gap-2">
             {formData.guarantees && formData.guarantees.map((g, idx) => (
                <Badge key={idx} variant="outline" className="text-blue-300 border-blue-500/30 bg-blue-500/10 py-1 px-3">
                  <ShieldCheck className="w-3 h-3 mr-1"/> {g.label}
                </Badge>
             ))}
           </div>
        </div>

        <div className="mt-6"><h4 className="font-bold text-white mb-2">Répartition du financement</h4><div className="space-y-2">{formData.modules && Object.entries(formData.modules).filter(([,mod]) => mod.active).map(([key, mod]) => {const Icon = MODULES_CONFIG[key].icon;return (<div key={key} className="flex justify-between items-center bg-white/5 p-2 rounded"><span className="flex items-center gap-2 text-sm"><Icon className="w-4 h-4" style={{color: MODULES_CONFIG[key].color}}/> {MODULES_CONFIG[key].label}</span><span className="font-semibold">{(mod.cost * mod.financing / 100).toLocaleString('fr-FR', {maximumFractionDigits: 0})} {formData.currency}</span></div>)})}</div></div>
      </div>
       <div className="flex justify-between"><Button onClick={() => prevStep(3)} variant="ghost"><ArrowLeft className="w-5 h-5 mr-2"/> Ajuster</Button><Button onClick={submitApplication} className="bg-purple-600 hover:bg-purple-700 py-6 text-lg"><Send className="w-5 h-5 mr-2" /> Soumettre ma demande</Button></div>
    </motion.div>
);
const SuccessMessage = ({ loan, reset }) => ( <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center glass-effect p-12 rounded-2xl"><Check className="w-16 h-16 mx-auto bg-emerald-500 text-white rounded-full p-2 mb-4" /><h2 className="text-3xl font-bold text-white">Demande Soumise !</h2><p className="text-gray-300 mt-2 mb-6">Bonjour {loan.operator}, votre demande de {loan.amountApproved?.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {loan.currency} a été envoyée. <br/> Nous vous notifierons dans 3 à 5 jours ouvrables.</p><Button onClick={reset}><RefreshCw className="w-4 h-4 mr-2"/> Nouvelle Demande</Button></motion.div>);

const GUARANTEE_CONFIG = {
  actif: { label: 'Actif', icon: Package, color: '#3b82f6' },
  immobilier: { label: 'Immobilier', icon: Building, color: '#8b5cf6' },
  epargne: { label: 'Épargne', icon: PiggyBank, color: '#ec4899' },
  morale: { label: 'Garantie Morale', icon: Handshake, color: '#10b981' },
  'Gage matériel': { label: 'Gage matériel', icon: Shield, color: '#f59e0b' },
  'Hypothèque': { label: 'Hypothèque', icon: Building, color: '#8b5cf6' }
};


const TransferDialog = ({ open, onOpenChange, subwallet, onTransfer, currency, suppliers }) => {
  const [amount, setAmount] = useState(''); const [supplier, setSupplier] = useState(''); const [description, setDescription] = useState('');
  const { toast } = useToast();
  const handleTransfer = () => {
    if (!amount || !supplier || !description) { toast({ variant: 'destructive', title: 'Erreur', description: 'Veuillez remplir tous les champs.' }); return; }
    const transferAmount = parseFloat(amount);
    if (transferAmount <= 0 || transferAmount > subwallet.balance) { toast({ variant: 'destructive', title: 'Erreur', description: 'Montant invalide ou solde insuffisant.' }); return; }
    onTransfer(subwallet.id, transferAmount, supplier, description);
    onOpenChange(false); setAmount(''); setSupplier(''); setDescription('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white"><DialogHeader><DialogTitle className="gradient-text">Transférer / Payer</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Depuis le portefeuille</Label><Input value={subwallet?.label} disabled className="bg-white/10" /></div>
          <div><Label>Solde disponible</Label><Input value={`${subwallet?.balance.toLocaleString()} ${currency}`} disabled className="bg-white/10" /></div>
          <div><Label>Vers le fournisseur</Label><Select onValueChange={setSupplier} value={supplier}><SelectTrigger className="bg-white/5"><SelectValue placeholder="Sélectionner un fournisseur..." /></SelectTrigger><SelectContent className="glass-effect">{suppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Montant ({currency})</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="bg-white/5" /></div>
          <div><Label>Motif / Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Achat semences de maïs" className="bg-white/5" /></div>
        </div>
        <DialogFooter><Button onClick={handleTransfer} className="bg-emerald-600 hover:bg-emerald-700">Exécuter le paiement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ContractDialog = ({ open, onOpenChange, contract }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="glass-effect text-white max-w-2xl"><DialogHeader><DialogTitle className="gradient-text flex items-center gap-2"><FileSignature/>Détails du Contrat</DialogTitle><DialogDescription>Contrat N° {contract.id}</DialogDescription></DialogHeader>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto p-1">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 p-3 rounded-lg"><p className="text-xs text-gray-400">Parties</p><p className="font-semibold">{contract.parties}</p></div>
          <div className="bg-white/5 p-3 rounded-lg"><p className="text-xs text-gray-400">Date d'effet</p><p className="font-semibold">{contract.date}</p></div>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">Ce contrat lie les parties susmentionnées pour un crédit de <span className="font-bold text-emerald-400">{contract.amount.toLocaleString()} {contract.currency}</span>. Les fonds sont débloqués selon les sous-portefeuilles définis. Le remboursement est attendu selon les termes convenus. Les garanties listées sont engagées pour la durée du contrat.</p>
      </div>
      <DialogFooter><Button onClick={() => onOpenChange(false)} variant="outline">Fermer</Button></DialogFooter>
    </DialogContent>
  </Dialog>
);

const RepaymentSchedule = ({ schedule, currency }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-400 uppercase bg-white/5">
                <tr>
                    <th className="px-6 py-3">Échéance</th>
                    <th className="px-6 py-3">Principal</th>
                    <th className="px-6 py-3">Intérêts</th>
                    <th className="px-6 py-3 text-right">Total</th>
                    <th className="px-6 py-3 text-right">Solde restant</th>
                </tr>
            </thead>
            <tbody>
                {schedule.map((row) => (
                    <tr key={row.number} className="border-b border-white/10 hover:bg-white/5">
                        <td className="px-6 py-4">{row.date}</td>
                        <td className="px-6 py-4">{row.principal.toLocaleString()} {currency}</td>
                        <td className="px-6 py-4">{row.interest.toLocaleString()} {currency}</td>
                        <td className="px-6 py-4 text-right font-bold text-white">{row.total.toLocaleString()} {currency}</td>
                        <td className="px-6 py-4 text-right text-gray-400">{row.balance.toLocaleString()} {currency}</td>
                    </tr>
                ))}
                {schedule.length === 0 && (
                    <tr><td colSpan="5" className="text-center py-8 text-gray-500">Échéancier non disponible.</td></tr>
                )}
            </tbody>
        </table>
    </div>
);

const RebalanceDialog = ({ open, onOpenChange, subwallet, subwallets, onRebalance, currency }) => {
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const { toast } = useToast();

  const others = subwallets.filter(sw => sw.id !== subwallet?.id);

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!toId || !amt || amt <= 0 || amt > subwallet.balance) {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Montant invalide ou solde insuffisant.' });
      return;
    }
    onRebalance(subwallet.id, Number(toId), amt);
    onOpenChange(false); setToId(''); setAmount('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white">
        <DialogHeader><DialogTitle className="gradient-text">Réajuster entre modules</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Depuis</Label><Input value={subwallet?.label} disabled className="bg-white/10" /></div>
          <div><Label>Solde disponible</Label><Input value={`${subwallet?.balance.toLocaleString()} ${currency}`} disabled className="bg-white/10" /></div>
          <div><Label>Vers le module</Label><Select onValueChange={setToId} value={toId}><SelectTrigger className="bg-white/5"><SelectValue placeholder="Sélectionner un module..." /></SelectTrigger><SelectContent className="glass-effect">{others.map(sw => <SelectItem key={sw.id} value={String(sw.id)}>{sw.label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Montant ({currency})</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="bg-white/5" /></div>
        </div>
        <DialogFooter><Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">Réajuster</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const GestionCreditsClient = ({ approvedCredit, refreshCredit }) => {
  const [activeSubwallet, setActiveSubwallet] = useState(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [rebalanceDialogOpen, setRebalanceDialogOpen] = useState(false);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const { toast } = useToast();

  useEffect(() => { api.suppliers.list().then(setSuppliers).catch(() => {}); }, []);

  if (!approvedCredit) {
    return (
      <div className="text-center glass-effect p-12 rounded-2xl">
        <Info className="w-16 h-16 mx-auto text-blue-400 mb-4" />
        <h2 className="text-2xl font-bold text-white">Aucun crédit approuvé</h2>
        <p className="text-gray-400 mt-2">Soumettez une demande de crédit pour commencer.</p>
      </div>
    );
  }

  const handleTransfer = async (subwalletId, amount, supplier, description) => {
    try {
      await api.portfolio.mine.pay(approvedCredit.id, subwalletId, amount, supplier, description);
      await refreshCredit();
      toast({ title: 'Succès', description: `Paiement de ${amount} ${approvedCredit.currency} à ${supplier} exécuté.` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleRebalance = async (fromId, toId, amount) => {
    try {
      await api.portfolio.mine.rebalance(approvedCredit.id, fromId, toId, amount);
      await refreshCredit();
      toast({ title: 'Réajustement effectué' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleOpenTransferDialog = (subwallet) => {
    setActiveSubwallet(subwallet);
    setTransferDialogOpen(true);
  };

  const handleOpenRebalanceDialog = (subwallet) => {
    setActiveSubwallet(subwallet);
    setRebalanceDialogOpen(true);
  };

  const subwalletLabel = (id) => approvedCredit.subwallets.find(sw => sw.id === id)?.label || '—';

  const InfoCard = ({ icon: Icon, label, value, iconBg, onClick, isButton = false }) => (
    <div className={`bg-slate-800/50 p-3 rounded-lg flex items-center gap-3 ${isButton ? 'cursor-pointer hover:bg-slate-700/80 transition-colors' : ''}`} onClick={onClick}>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className="w-4 h-4 text-white" />
        </div>
        <div>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="font-semibold text-white">{value}</p>
        </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="glass-effect p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">Crédit: {approvedCredit.type}</h3>
                <p className="text-gray-400 mb-4">Total Approuvé: <span className="font-bold text-emerald-400">{approvedCredit.amountApproved.toLocaleString()} {approvedCredit.currency}</span></p>
              </div>
              <Button size="sm" variant="outline" className="border-white/20 hover:bg-white/10" onClick={() => setContractDialogOpen(true)}>
                  <FileSignature className="w-4 h-4 mr-2" /> Voir Contrat
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <InfoCard icon={User} label="Gestionnaire" value={approvedCredit.manager || 'Non assigné'} iconBg="bg-blue-500" />
                <InfoCard icon={Landmark} label="Investisseur" value={approvedCredit.investor || 'Non assigné'} iconBg="bg-purple-500" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {approvedCredit.subwallets.map((sub) => {
                const Icon = MODULES_CONFIG[sub.moduleKey]?.icon || FileText;
                return (
                  <div key={sub.id} className="bg-white/5 p-4 rounded-lg space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2"><Icon className="w-5 h-5" style={{ color: MODULES_CONFIG[sub.moduleKey]?.color }} /><h4 className="font-semibold text-white">{sub.label}</h4></div>
                      <p className="text-2xl font-bold">{sub.balance.toLocaleString()} {approvedCredit.currency}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-emerald-600/80 hover:bg-emerald-600 text-xs flex-1" onClick={() => handleOpenTransferDialog(sub)}><Banknote className="w-3 h-3 mr-1"/>Payer</Button>
                      <Button size="sm" variant="outline" className="text-xs border-white/20 hover:bg-white/10 flex-1" onClick={() => handleOpenRebalanceDialog(sub)}><Shuffle className="w-3 h-3 mr-1"/>Réajuster</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Repayment Schedule Section */}
          <div className="glass-effect p-6 rounded-2xl">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-purple-400"/> Échéancier de Remboursement</h3>
            <RepaymentSchedule schedule={approvedCredit.schedule || []} currency={approvedCredit.currency} />
          </div>

        </div>
        <div className="space-y-8">
          <div className="glass-effect p-6 rounded-2xl">
            <h3 className="text-xl font-bold text-white mb-4">Garanties Enregistrées</h3>
            <div className="space-y-3">
              {approvedCredit.guarantees.map(g => {
                const Icon = GUARANTEE_CONFIG[g.type]?.icon || Shield;
                return (<div key={g.id} className="bg-white/5 p-3 rounded-lg flex items-center gap-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{backgroundColor: `${GUARANTEE_CONFIG[g.type]?.color}20`}}><Icon className="w-4 h-4" style={{color: GUARANTEE_CONFIG[g.type]?.color}}/></div><div><p className="font-semibold text-sm">{GUARANTEE_CONFIG[g.type]?.label || g.label || g.type}</p><p className="text-xs text-gray-400">{g.description || g.label}</p></div></div>)
              })}
              {approvedCredit.guarantees.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Aucune garantie enregistrée.</p>}
            </div>
          </div>
        </div>
      </div>
      <div className="glass-effect p-6 rounded-2xl">
        <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2"><History/> Historique des Transactions</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-xs text-gray-400 uppercase bg-white/5"><tr><th scope="col" className="px-6 py-3">Date</th><th scope="col" className="px-6 py-3">Module</th><th scope="col" className="px-6 py-3">Bénéficiaire</th><th scope="col" className="px-6 py-3 text-right">Montant</th><th scope="col" className="px-6 py-3 text-center">Statut</th></tr></thead><tbody>{approvedCredit.transactions.map(t => (<tr key={t.id} className="border-b border-white/10 hover:bg-white/5"><td className="px-6 py-4">{new Date(t.date).toLocaleDateString()}</td><td className="px-6 py-4">{t.subwalletId ? subwalletLabel(t.subwalletId) : t.type}</td><td className="px-6 py-4">{t.ref || '—'}</td><td className="px-6 py-4 text-right font-mono">{(t.amount ?? 0).toLocaleString()} {approvedCredit.currency}</td><td className="px-6 py-4 text-center"><span className="bg-emerald-500/20 text-emerald-300 text-xs font-medium px-2.5 py-0.5 rounded-full">{t.status}</span></td></tr>))}{approvedCredit.transactions.length === 0 && (<tr><td colSpan="5" className="text-center py-8 text-gray-500">Aucune transaction pour le moment.</td></tr>)}</tbody></table></div>
      </div>
      {activeSubwallet && <TransferDialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen} subwallet={activeSubwallet} onTransfer={handleTransfer} currency={approvedCredit.currency} suppliers={suppliers} />}
      {activeSubwallet && <RebalanceDialog open={rebalanceDialogOpen} onOpenChange={setRebalanceDialogOpen} subwallet={activeSubwallet} subwallets={approvedCredit.subwallets} onRebalance={handleRebalance} currency={approvedCredit.currency} />}
      <ContractDialog open={contractDialogOpen} onOpenChange={setContractDialogOpen} contract={{
        id: approvedCredit.id, parties: `${approvedCredit.operator} - AGRICAP`,
        date: approvedCredit.startDate || approvedCredit.date, amount: approvedCredit.amountApproved,
        currency: approvedCredit.currency,
      }} />
    </motion.div>
  );
};


// =================================================================
// ===== MAIN PAGE COMPONENT =======================================
// =================================================================
const Credits = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [approvedCredit, setApprovedCredit] = useState(null);
  const [submittedAppCode, setSubmittedAppCode] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [formData, setFormData] = useState({
    demandeur: '', localisation: '', superficie: '', culture: '',
    montant: '', currency: 'USD', guarantees: [],
    vcCode: '', nsFile: null, nsResult: null, simResult: null,
  });

  useEffect(() => {
    if (user?.role === 'client') {
      // Charger le crédit actif via le nouveau module credits
      api.credits.list({ status: 'active' })
        .then(apps => setApprovedCredit(apps.length ? _appToLoan(apps[0]) : null))
        .catch(() => {
          // Fallback sur portfolio/mine
          api.portfolio.mine.list()
            .then(loans => setApprovedCredit(loans.length ? loans[0] : null))
            .catch(() => {});
        });
      // Charger les données de préremplissage
      api.credits.prefill()
        .then(data => {
          setPrefill(data);
          setFormData(prev => ({
            ...prev,
            demandeur: data.client?.displayName || prev.demandeur,
            vcCode: data.defaults?.value_chain_code || '',
            superficie: data.defaults?.area_ha ? String(data.defaults.area_ha) : '',
            currency: data.defaults?.currency || 'USD',
          }));
        })
        .catch(() => {});
    }
  }, [user]);

  // Convertit un CreditApplication en forme affichable dans GestionCreditsClient
  const _appToLoan = (app) => ({
    id: app.code,
    type: app.value_chain?.label || 'Crédit Agricole',
    amountApproved: app.amount_approved || app.amount_requested,
    currency: app.currency,
    manager: app.reviewedBySub || 'AGRICAP',
    investor: '—',
    subwallets: (app.moduleAllocations || []).map((m, i) => ({
      id: i + 1,
      moduleKey: m.module,
      label: m.module.replace(/_/g, ' '),
      allocatedAmount: m.amountFinanced,
      balance: m.amountFinanced,
    })),
    guarantees: app.guarantees?.items?.map(g => ({
      id: g.id,
      type: g.type,
      label: g.type === 'epargne' ? 'Nantissement Épargne' : 'Caution Morale',
      description: g.type === 'epargne'
        ? `${g.holdAmount?.toLocaleString() || 0} ${g.holdCurrency || app.currency} bloqués`
        : `${g.guarantorName || '—'} — ${g.status}`,
    })) || [],
    transactions: [],
    schedule: app.score_result?.scheduleDraft?.map((s, i) => ({
      number: i + 1, date: `Mois ${s.month}`,
      principal: s.principal, interest: s.interest,
      total: s.payment, balance: s.balance,
    })) || [],
    startDate: app.disbursedAt || app.createdAt,
  });

  const refreshCredit = async () => {
    if (!approvedCredit) return;
    try {
      if (approvedCredit.id?.startsWith?.('CRED-')) {
        const app = await api.credits.get(approvedCredit.id);
        setApprovedCredit(_appToLoan(app));
      } else {
        setApprovedCredit(await api.portfolio.mine.detail(approvedCredit.id));
      }
    } catch (e) { /* silencieux */ }
  };

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, 4));
  const prevStep = (step) => setCurrentStep(prev => step || Math.max(prev - 1, 1));

  const submitApplication = async (finalFormData) => {
    try {
      // 1. Créer le dossier en DRAFT
      const app = await api.credits.create({
        value_chain_code: finalFormData.vcCode || undefined,
        area_ha: finalFormData.superficie ? parseFloat(finalFormData.superficie) : undefined,
        currency: finalFormData.currency,
        amount_requested: parseFloat(finalFormData.montant) || finalFormData.totalFinanced || 0,
        needs_sheet_id: finalFormData.nsResult?.id,
        guarantee_type: finalFormData.guarantees?.[0]?.type || undefined,
        prefill_snapshot: { demandeur: finalFormData.demandeur, localisation: finalFormData.localisation },
      });
      // 2. Soumettre
      await api.credits.submit(app.code);
      setSubmittedAppCode(app.code);
      setIsSubmitted(true);
      // Créer un objet "loan-like" pour SuccessMessage
      setApprovedCredit({
        id: app.code,
        operator: finalFormData.demandeur,
        amountApproved: parseFloat(finalFormData.montant) || finalFormData.totalFinanced,
        currency: finalFormData.currency,
      });
      toast({ title: '✅ Demande soumise !', description: `Dossier ${app.code} en cours d'analyse.` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const resetProcess = () => {
    setCurrentStep(1);
    setIsSubmitted(false);
    setSubmittedAppCode(null);
    setFormData({
      demandeur: prefill?.client?.displayName || '',
      localisation: '', superficie: '', culture: '', montant: '',
      currency: prefill?.defaults?.currency || 'USD', guarantees: [],
      vcCode: prefill?.defaults?.value_chain_code || '',
      nsFile: null, nsResult: null, simResult: null,
    });
  };

  // Simuler le scoring via l'API réelle
  const runSimulation = async (fd) => {
    try {
      const result = await api.credits.simulate({
        value_chain_code: fd.vcCode || undefined,
        needs_sheet_id: fd.nsResult?.id,
        area_ha: fd.superficie ? parseFloat(fd.superficie) : undefined,
        amount_requested: parseFloat(fd.montant) || undefined,
        currency: fd.currency,
        // Totaux par module depuis la feuille de besoins parsée
        ns_totals: fd.nsResult?.totalByModule || undefined,
      });
      return result;
    } catch (e) {
      return null;
    }
  };

  const renderClientApplicationFlow = () => {
    if (isSubmitted && approvedCredit) { return <SuccessMessage loan={approvedCredit} reset={resetProcess} />; }
    switch (currentStep) {
      case 1: return <DemandeInitiale formData={formData} setFormData={setFormData} nextStep={nextStep} prefill={prefill} />;
      case 2: return <SimulateurIntelligent formData={formData} setFormData={setFormData} nextStep={nextStep} prevStep={prevStep} runSimulation={runSimulation} />;
      case 3: return <ConfigurationGaranties formData={formData} setFormData={setFormData} nextStep={nextStep} prevStep={prevStep} />;
      case 4: return <FicheSynthese formData={formData} prevStep={prevStep} submitApplication={() => submitApplication(formData)} />;
      default: return null;
    }
  };

  const renderClientView = () => (
    <Tabs defaultValue="gestion" className="w-full">
      <TabsList className="grid w-full grid-cols-2 bg-white/5"><TabsTrigger value="gestion">Gérer mes crédits</TabsTrigger><TabsTrigger value="demande">Demander un crédit</TabsTrigger></TabsList>
      <TabsContent value="gestion" className="pt-6"><GestionCreditsClient approvedCredit={approvedCredit} refreshCredit={refreshCredit} /></TabsContent>
      <TabsContent value="demande" className="pt-6">
          {!(isSubmitted && approvedCredit) && (
              <div className="flex justify-center items-center gap-4 mb-8">
                  {STEPS.map(step => (
                      <React.Fragment key={step.id}>
                      <div className="flex flex-col items-center text-center">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${currentStep >= step.id ? 'bg-emerald-500 border-emerald-400' : 'bg-white/10 border-gray-600'}`}>
                          {currentStep > step.id ? <Check className="w-6 h-6 text-white"/> : <span className="font-bold">{step.id}</span>}
                          </div>
                          <p className={`mt-2 text-xs font-semibold ${currentStep >= step.id ? 'text-white' : 'text-gray-500'}`}>{step.name}</p>
                      </div>
                      {step.id < STEPS.length && <div className={`flex-1 h-1 rounded-full ${currentStep > step.id ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>}
                      </React.Fragment>
                  ))}
              </div>
          )}
          <AnimatePresence mode="wait">{renderClientApplicationFlow()}</AnimatePresence>
      </TabsContent>
    </Tabs>
  );

  const renderAdminView = () => (
    <AdminCreditsDashboard />
  );

  return (
    <Layout>
      <Helmet><title>Crédits - AGRICAP FINTECH</title><meta name="description" content="Demandez et gérez votre crédits agricoles." /></Helmet>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-4xl font-bold gradient-text mb-2">
            {user?.role === 'admin' ? 'Module Crédits Agricoles' : 'Espace Crédits'}
        </h1>
        <p className="text-gray-400">
            {user?.role === 'admin' ? 'Gestion, suivi et pilotage du cycle de vie des crédits.' : 'Suivez vos demandes et gérez les fonds alloués.'}
        </p>
      </motion.div>
      {user?.role === 'admin' ? renderAdminView() : renderClientView()}
    </Layout>
  );
};

export default Credits;