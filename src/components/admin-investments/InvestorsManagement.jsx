import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Search, UserCheck, Ban, Play, Plus, Download, Eye, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useExport } from '@/lib/agricapHooks';
import { api } from '@/services/api';
import { ManagerAssignmentBadge } from '@/components/admin-console/AgricapComponents';

const TYPE_LABELS = { INDIVIDUAL: 'Individuel', INSTITUTIONAL: 'Institutionnel', CORPORATE: 'Corporate' };
const RISK_LABELS = { CONSERVATIVE: 'Conservateur', MODERATE: 'Modéré', AGGRESSIVE: 'Agressif' };
const KYC_COLORS = {
  VALIDE: 'bg-green-500/20 text-green-500 border-green-500/30',
  EN_ATTENTE: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
  REJETE: 'bg-red-500/20 text-red-500 border-red-500/30',
  EXPIRE: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};
const KYC_LABELS = { VALIDE: 'Validé', EN_ATTENTE: 'En attente', REJETE: 'Rejeté', EXPIRE: 'Expiré' };

const emptyForm = { userSub: '', investorType: 'INDIVIDUAL', assignedManagerSub: '' };

const InvestorsManagement = ({ investors, subscriptions, offers, projects, managers, refreshData }) => {
  const { toast } = useToast();
  const { exportToCSV } = useExport();
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedInvestor, setSelectedInvestor] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const filtered = investors.filter(i => i.userSub.toLowerCase().includes(query.toLowerCase()));

  const investorSubs = (investorId) => subscriptions.filter(s => s.investorId === investorId);
  const totalInvested = (investorId) => investorSubs(investorId)
    .filter(s => s.status !== 'CANCELLED')
    .reduce((sum, s) => sum + s.amount, 0);

  const offerFor = (offerId) => offers.find(o => o.id === offerId);
  const projectFor = (offerId) => {
    const offer = offerFor(offerId);
    return offer ? projects.find(p => p.id === offer.projectId) : null;
  };

  const openCreate = () => { setFormData(emptyForm); setModalMode('create'); setIsModalOpen(true); };
  const openEdit = (inv) => {
    setFormData({ userSub: inv.userSub, investorType: inv.investorType, assignedManagerSub: inv.assignedManagerSub || '' });
    setSelectedInvestor(inv);
    setModalMode('edit');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.userSub) {
      toast({ title: 'Erreur', description: "L'identifiant utilisateur (sub) est requis.", variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api.investments.investors.create({
        userSub: formData.userSub, investorType: formData.investorType,
        assignedManagerSub: formData.assignedManagerSub,
      });
      toast({ title: 'Succès', description: modalMode === 'create' ? 'Investisseur créé.' : 'Investisseur mis à jour.' });
      setIsModalOpen(false);
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Enregistrement impossible.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleValidateKyc = async (inv) => {
    setBusyId(inv.id);
    try {
      await api.compliance.validateKyc(inv.userSub);
      toast({ title: 'Succès', description: 'KYC validé.' });
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Validation impossible.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = async (inv) => {
    setBusyId(inv.id);
    const action = inv.status === 'ACTIVE' ? 'suspend' : 'activate';
    try {
      await api.investments.investors.action(inv.id, action);
      toast({ title: 'Succès', description: action === 'suspend' ? 'Investisseur suspendu.' : 'Investisseur réactivé.' });
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Action impossible.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
         <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Rechercher investisseur (identifiant)..."
              className="pl-10 bg-slate-900 border-slate-700"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
         </div>
         <div className="flex gap-2">
           <Button variant="outline" className="border-slate-700" onClick={() => exportToCSV(filtered, 'investisseurs')}>
             <Download className="w-4 h-4 mr-2" /> Exporter
           </Button>
           <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700">
             <Plus className="w-4 h-4 mr-2" /> Nouvel Investisseur
           </Button>
         </div>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-300">Identifiant (sub)</TableHead>
                <TableHead className="text-slate-300">Type</TableHead>
                <TableHead className="text-slate-300">KYC</TableHead>
                <TableHead className="text-slate-300">Profil Risque</TableHead>
                <TableHead className="text-slate-300">Gestionnaire</TableHead>
                <TableHead className="text-slate-300">Total investi</TableHead>
                <TableHead className="text-slate-300">Statut</TableHead>
                <TableHead className="text-right text-slate-300">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(inv => (
                <TableRow key={inv.id} className="border-slate-800 hover:bg-slate-800/30">
                  <TableCell className="font-medium text-white font-mono text-xs">{inv.userSub}</TableCell>
                  <TableCell className="text-slate-300">{TYPE_LABELS[inv.investorType] || inv.investorType}</TableCell>
                  <TableCell><Badge className={KYC_COLORS[inv.kycStatus]}>{KYC_LABELS[inv.kycStatus] || inv.kycStatus}</Badge></TableCell>
                  <TableCell className="text-slate-300">{RISK_LABELS[inv.riskProfile] || inv.riskProfile}</TableCell>
                  <TableCell><ManagerAssignmentBadge managerSub={inv.assignedManagerSub} managers={managers} /></TableCell>
                  <TableCell className="font-mono text-emerald-400">{totalInvested(inv.id).toLocaleString()} $</TableCell>
                  <TableCell>
                    <span className={`w-2 h-2 rounded-full inline-block mr-2 ${inv.status === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className="text-slate-300">{inv.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" title="Profil" onClick={() => { setSelectedInvestor(inv); setIsDetailsOpen(true); }}><Eye className="w-4 h-4"/></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" title="Modifier" onClick={() => openEdit(inv)}><Pencil className="w-4 h-4"/></Button>
                      {inv.kycStatus !== 'VALIDE' && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-400" title="Valider KYC" disabled={busyId === inv.id} onClick={() => handleValidateKyc(inv)}><UserCheck className="w-4 h-4"/></Button>
                      )}
                      <Button
                        size="icon" variant="ghost"
                        className={`h-8 w-8 ${inv.status === 'ACTIVE' ? 'text-red-400' : 'text-emerald-400'}`}
                        title={inv.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
                        disabled={busyId === inv.id}
                        onClick={() => handleToggleStatus(inv)}
                      >
                        {inv.status === 'ACTIVE' ? <Ban className="w-4 h-4"/> : <Play className="w-4 h-4"/>}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-500">Aucun investisseur trouvé.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>{modalMode === 'create' ? 'Créer un investisseur' : "Modifier l'investisseur"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Identifiant utilisateur IdP (sub)</Label>
              <Input
                className="bg-slate-800 border-slate-700"
                value={formData.userSub}
                disabled={modalMode === 'edit'}
                onChange={e => setFormData({ ...formData, userSub: e.target.value })}
              />
              <p className="text-xs text-slate-500">L'utilisateur doit s'être déjà connecté au moins une fois via l'IdP AGRICAP.</p>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={formData.investorType} onValueChange={v => setFormData({ ...formData, investorType: v })}>
                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INDIVIDUAL">Individuel</SelectItem>
                  <SelectItem value="INSTITUTIONAL">Institutionnel</SelectItem>
                  <SelectItem value="CORPORATE">Corporate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Gestionnaire assigné</Label>
              <Input
                className="bg-slate-800 border-slate-700"
                placeholder="sub du gestionnaire (optionnel)"
                value={formData.assignedManagerSub}
                onChange={e => setFormData({ ...formData, assignedManagerSub: e.target.value })}
                list="investor-managers-list"
              />
              <datalist id="investor-managers-list">
                {managers.map(m => <option key={m.sub} value={m.sub}>{m.name}</option>)}
              </datalist>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Annuler</Button>
            <Button className="bg-emerald-600" onClick={handleSave} disabled={saving}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{selectedInvestor?.userSub}</DialogTitle>
            <DialogDescription>
              {TYPE_LABELS[selectedInvestor?.investorType] || selectedInvestor?.investorType} • KYC {KYC_LABELS[selectedInvestor?.kycStatus] || selectedInvestor?.kycStatus}
            </DialogDescription>
          </DialogHeader>
          {selectedInvestor && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><Label className="text-slate-500">Profil de risque</Label><p>{RISK_LABELS[selectedInvestor.riskProfile] || selectedInvestor.riskProfile}</p></div>
                <div><Label className="text-slate-500">Gestionnaire</Label><p><ManagerAssignmentBadge managerSub={selectedInvestor.assignedManagerSub} managers={managers} /></p></div>
                <div><Label className="text-slate-500">Total investi</Label><p className="font-mono text-emerald-400">{totalInvested(selectedInvestor.id).toLocaleString()} $</p></div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300 mb-2">Souscriptions</p>
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-400">Projet</TableHead>
                      <TableHead className="text-slate-400">Montant</TableHead>
                      <TableHead className="text-slate-400">Date</TableHead>
                      <TableHead className="text-slate-400">Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {investorSubs(selectedInvestor.id).map(s => {
                      const project = projectFor(s.offerId);
                      return (
                        <TableRow key={s.id} className="border-slate-800">
                          <TableCell className="text-sm">{project ? `${project.code} — ${project.title}` : `Offre #${s.offerId}`}</TableCell>
                          <TableCell className="font-mono text-sm">{s.amount.toLocaleString()} $</TableCell>
                          <TableCell className="text-sm text-slate-400">{new Date(s.subscriptionDate).toLocaleDateString()}</TableCell>
                          <TableCell className="text-sm">{s.status}</TableCell>
                        </TableRow>
                      );
                    })}
                    {investorSubs(selectedInvestor.id).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-slate-500 text-sm">Aucune souscription.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InvestorsManagement;
