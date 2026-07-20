import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Edit2, Car, Home, Tractor, Package, Upload, ShieldCheck, DollarSign } from 'lucide-react';
import { api, ApiError } from '@/services/api';

const ASSET_TYPES = {
  equipment: { label: 'Équipement / Machine', icon: Tractor, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  property: { label: 'Immobilier / Terrain', icon: Home, color: 'text-purple-400', bg: 'bg-purple-400/10' },
  vehicle: { label: 'Véhicule', icon: Car, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  other: { label: 'Autre', icon: Package, color: 'text-gray-400', bg: 'bg-gray-400/10' },
};

const AssetsInventory = () => {
  const { toast } = useToast();
  const [assets, setAssets] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentAsset, setCurrentAsset] = useState(null); // For editing

  // Form State
  const [formData, setFormData] = useState({
    name: '', type: 'equipment', value: '', currency: 'USD', description: ''
  });

  const loadAssets = () => api.assets.mine().then(setAssets).catch(() => {});
  useEffect(() => { loadAssets(); }, []);

  const handleOpenModal = (asset = null) => {
    if (asset) {
      setFormData({ name: asset.name, type: asset.type, value: asset.value, currency: asset.currency, description: asset.description });
      setCurrentAsset(asset);
    } else {
      setFormData({ name: '', type: 'equipment', value: '', currency: 'USD', description: '' });
      setCurrentAsset(null);
    }
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    try {
      await api.assets.remove(id);
      setAssets(assets.filter(a => a.id !== id));
      toast({ title: "Actif supprimé", description: "L'actif a été retiré de votre inventaire." });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { ...formData, value: parseFloat(formData.value) };
    try {
      if (currentAsset) {
        const updated = await api.assets.update(currentAsset.id, payload);
        setAssets(prev => prev.map(a => a.id === currentAsset.id ? updated : a));
        toast({ title: "Actif mis à jour", description: "Les modifications ont été enregistrées." });
      } else {
        const created = await api.assets.create(payload);
        setAssets([created, ...assets]);
        toast({ title: "Actif ajouté", description: "Nouvel actif enregistré dans votre inventaire." });
      }
      setIsModalOpen(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Layout>
      <Helmet><title>Mes Actifs - AGRICAP FINTECH</title></Helmet>
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold gradient-text mb-2">Inventaire des Actifs</h1>
          <p className="text-gray-400">Gérez vos biens (équipements, immobiliers) pour garantir vos futurs crédits.</p>
        </motion.div>
        <Button onClick={() => handleOpenModal()} className="bg-gradient-to-r from-emerald-500 to-blue-600">
          <Plus className="w-4 h-4 mr-2" /> Ajouter un Actif
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {assets.map((asset) => {
            const typeConfig = ASSET_TYPES[asset.type] || ASSET_TYPES.other;
            const Icon = typeConfig.icon;
            
            return (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                layout
              >
                <Card className={`glass-effect border-l-4 ${asset.status === 'pledged' ? 'border-l-orange-500' : 'border-l-emerald-500'} group relative overflow-hidden`}>
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div className={`p-3 rounded-xl ${typeConfig.bg}`}>
                        <Icon className={`w-6 h-6 ${typeConfig.color}`} />
                      </div>
                      <div className="flex gap-2">
                        {asset.status === 'pledged' && (
                          <div className="px-2 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Engagé
                          </div>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white" onClick={() => handleOpenModal(asset)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => handleDelete(asset.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <CardTitle className="mt-4 text-white">{asset.name}</CardTitle>
                    <p className="text-xs font-mono text-gray-500">{asset.id}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="bg-white/5 p-3 rounded-lg flex justify-between items-center">
                        <span className="text-gray-400 text-sm">Valeur Estimée</span>
                        <span className="font-bold text-emerald-400 text-lg">{asset.value.toLocaleString()} {asset.currency}</span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-2 min-h-[40px]">{asset.description}</p>
                      
                      <div className="pt-2 border-t border-white/5 flex justify-between items-center text-xs text-gray-500">
                        <span>{typeConfig.label}</span>
                        <span>Ajouté le {new Date().toLocaleDateString()}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
        
        {assets.length === 0 && (
          <div className="col-span-full text-center py-12 glass-effect rounded-xl border-dashed border-2 border-white/10">
            <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-400">Aucun actif enregistré</h3>
            <p className="text-gray-500 mt-2">Commencez par ajouter vos équipements ou propriétés.</p>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="glass-effect text-white">
          <DialogHeader>
            <DialogTitle>{currentAsset ? 'Modifier l\'Actif' : 'Enregistrer un Nouvel Actif'}</DialogTitle>
            <DialogDescription>Détails du bien à inclure dans votre patrimoine.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nom de l'actif</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ex: Tracteur Kubota..." className="bg-slate-900/50 border-slate-700" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData({...formData, type: v})}>
                  <SelectTrigger className="bg-slate-900/50 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSET_TYPES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Devise</Label>
                <Select value={formData.currency} onValueChange={v => setFormData({...formData, currency: v})}>
                  <SelectTrigger className="bg-slate-900/50 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Valeur Estimée</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input type="number" value={formData.value} onChange={e => setFormData({...formData, value: e.target.value})} className="pl-9 bg-slate-900/50 border-slate-700" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description & État</Label>
              <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Année, numéro de série, état général..." className="bg-slate-900/50 border-slate-700" rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Document de propriété (Optionnel)</Label>
              <div className="flex items-center gap-4 p-4 border border-dashed border-slate-700 rounded-lg bg-slate-900/30 cursor-pointer hover:bg-slate-900/50 transition-colors">
                <Upload className="w-5 h-5 text-emerald-400" />
                <div className="text-xs text-gray-400">
                  <span className="text-emerald-400 font-semibold">Cliquez pour upload</span> ou glissez un fichier
                  <br />Titre foncier, Facture, Carte grise...
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Annuler</Button>
              <Button type="submit" className="bg-gradient-to-r from-emerald-500 to-blue-600">Enregistrer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default AssetsInventory;