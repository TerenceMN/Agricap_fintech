import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Eye, Download, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useExport } from '@/lib/agricapHooks';
import { api } from '@/services/api';

const TYPE_LABELS = { OBLIGATION: 'Obligation', ACTION: 'Action', PART_SOCIALE: 'Part sociale' };
const STATUS_LABELS = { DRAFT: 'Brouillon', PREPARATION: 'Préparation', OUVERT: 'Ouvert', SUSPENDU: 'Suspendu', CLOTURE: 'Clôturé' };
const STATUS_COLORS = {
  DRAFT: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  PREPARATION: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  OUVERT: 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30',
  SUSPENDU: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
  CLOTURE: 'bg-slate-500/20 text-slate-500 border-slate-500/30',
};

const emptyForm = { projectCode: '', code: '', couponRate: '', maturityMonths: 24, minTicket: '', availableBonds: '', fundingGoal: '' };

const OffersManagement = ({ offers, projects, refreshData }) => {
  const { toast } = useToast();
  const { exportToCSV } = useExport();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const projectFor = (offer) => projects.find(p => p.id === offer.projectId);

  const getStatusBadge = (status) => (
    <Badge className={`${STATUS_COLORS[status] || 'bg-slate-500/20 text-slate-400'} border`}>{STATUS_LABELS[status] || status}</Badge>
  );

  const handleCreate = async () => {
    if (!formData.projectCode || !formData.code) {
      toast({ title: 'Erreur', description: 'Projet et code offre sont requis.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api.investments.offers.create({
        projectCode: formData.projectCode,
        code: formData.code,
        couponRate: Number(formData.couponRate) || 0,
        maturityMonths: Number(formData.maturityMonths) || 0,
        minTicket: Number(formData.minTicket) || 0,
        availableBonds: Number(formData.availableBonds) || 0,
        fundingGoal: Number(formData.fundingGoal) || 0,
      });
      toast({ title: 'Succès', description: 'Offre créée.' });
      setIsCreateOpen(false);
      setFormData(emptyForm);
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Création impossible.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Offres d'Investissement</h3>
        <div className="flex gap-2">
          <Button variant="outline" className="border-slate-700" onClick={() => exportToCSV(offers, 'offres')}>
            <Download className="w-4 h-4 mr-2"/> Exporter
          </Button>
          <Button onClick={() => { setFormData(emptyForm); setIsCreateOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2"/> Nouvelle Offre
          </Button>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-slate-800/50">
                <TableHead className="text-slate-300">Code Offre</TableHead>
                <TableHead className="text-slate-300">Projet</TableHead>
                <TableHead className="text-slate-300">Type</TableHead>
                <TableHead className="text-slate-300">Objectif</TableHead>
                <TableHead className="text-slate-300">Collecté</TableHead>
                <TableHead className="text-slate-300">Progression</TableHead>
                <TableHead className="text-slate-300">Coupon</TableHead>
                <TableHead className="text-slate-300">Maturité</TableHead>
                <TableHead className="text-slate-300">Ticket Min</TableHead>
                <TableHead className="text-slate-300">Statut</TableHead>
                <TableHead className="text-right text-slate-300">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.map((offer) => {
                const percent = offer.fundingGoal > 0 ? (offer.fundedAmount / offer.fundingGoal) * 100 : 0;
                const project = projectFor(offer);
                return (
                  <TableRow key={offer.id} className="border-slate-800 hover:bg-slate-800/30">
                    <TableCell className="font-mono text-xs text-slate-400">{offer.code}</TableCell>
                    <TableCell className="text-white text-sm">{project ? `${project.code} — ${project.title}` : `#${offer.projectId}`}</TableCell>
                    <TableCell className="text-slate-300 text-xs">{TYPE_LABELS[offer.typeOfTitle] || offer.typeOfTitle}</TableCell>
                    <TableCell className="font-mono text-white">{offer.fundingGoal.toLocaleString()} $</TableCell>
                    <TableCell className="font-mono text-emerald-400">{offer.fundedAmount.toLocaleString()} $</TableCell>
                    <TableCell className="w-[150px]">
                      <div className="flex items-center gap-2">
                         <Progress value={percent} className="h-2" />
                         <span className="text-xs text-slate-400">{percent.toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-blue-400 font-bold">{offer.couponRate}%</TableCell>
                    <TableCell className="text-slate-300">{offer.maturityMonths} mois</TableCell>
                    <TableCell className="text-slate-300">{offer.minTicket.toLocaleString()} $</TableCell>
                    <TableCell>{getStatusBadge(offer.status)}</TableCell>
                    <TableCell className="text-right">
                       <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" onClick={() => { setSelectedOffer(offer); setIsDetailsOpen(true); }}><Eye className="w-4 h-4"/></Button>
                       </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {offers.length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-slate-500">Aucune offre trouvée.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Créer une nouvelle offre</DialogTitle>
            <DialogDescription>Les conditions de financement (coupon, échéance, ticket minimum) d'un projet.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
             <div className="col-span-2 space-y-2">
                <Label>Projet</Label>
                <Select value={formData.projectCode} onValueChange={val => setFormData({...formData, projectCode: val})}>
                   <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Sélectionner un projet" /></SelectTrigger>
                   <SelectContent>
                      {projects.map(p => (
                        <SelectItem key={p.code} value={p.code}>{p.code} — {p.title}</SelectItem>
                      ))}
                   </SelectContent>
                </Select>
             </div>
             <div className="space-y-2">
                <Label>Code de l'offre (unique)</Label>
                <Input className="bg-slate-800 border-slate-700" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Objectif de financement ($)</Label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={formData.fundingGoal} onChange={e => setFormData({...formData, fundingGoal: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Taux de coupon (%)</Label>
                <Input type="number" step="0.01" className="bg-slate-800 border-slate-700" value={formData.couponRate} onChange={e => setFormData({...formData, couponRate: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Échéance (mois)</Label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={formData.maturityMonths} onChange={e => setFormData({...formData, maturityMonths: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Ticket minimum ($)</Label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={formData.minTicket} onChange={e => setFormData({...formData, minTicket: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Obligations disponibles</Label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={formData.availableBonds} onChange={e => setFormData({...formData, availableBonds: e.target.value})} />
             </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Annuler</Button>
            <Button className="bg-emerald-600" onClick={handleCreate} disabled={saving}>Créer l'offre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedOffer?.code}</DialogTitle>
            <DialogDescription>Détails de l'offre</DialogDescription>
          </DialogHeader>
          {selectedOffer && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <span className="text-slate-500">Projet</span><span>{projectFor(selectedOffer)?.title || `#${selectedOffer.projectId}`}</span>
              <span className="text-slate-500">Type de titre</span><span>{TYPE_LABELS[selectedOffer.typeOfTitle] || selectedOffer.typeOfTitle}</span>
              <span className="text-slate-500">Valeur unitaire</span><span>{selectedOffer.bondUnitValue?.toLocaleString()} $</span>
              <span className="text-slate-500">Obligations min/max</span><span>{selectedOffer.minBonds} / {selectedOffer.maxBonds}</span>
              <span className="text-slate-500">Obligations disponibles</span><span>{selectedOffer.availableBonds}</span>
              <span className="text-slate-500">Objectif</span><span>{selectedOffer.fundingGoal?.toLocaleString()} $</span>
              <span className="text-slate-500">Collecté</span><span>{selectedOffer.fundedAmount?.toLocaleString()} $</span>
              <span className="text-slate-500">Coupon</span><span>{selectedOffer.couponRate}%</span>
              <span className="text-slate-500">Échéance</span><span>{selectedOffer.maturityMonths} mois</span>
              <span className="text-slate-500">Ticket minimum</span><span>{selectedOffer.minTicket?.toLocaleString()} $</span>
              <span className="text-slate-500">Statut</span><span>{STATUS_LABELS[selectedOffer.status] || selectedOffer.status}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OffersManagement;
