import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { FundAllocationChart, RevenueForecastChart, ProjectStatusBadge, RiskIndicator, PortfolioCompositionChart, PerformanceChart } from './AgricapComponents';
import { api } from '@/services/api';

export const ProjectModal = ({ isOpen, onClose, mode, project, onSaved }) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState(project || { code: '', title: '', sector: '', location: '', fundingTarget: 0, promoter: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'create') {
        await api.investments.projects.create({
          code: formData.code, title: formData.title, sector: formData.sector,
          location: formData.location, fundingTarget: formData.fundingTarget, promoter: formData.promoter,
        });
        toast({ title: 'Succès', description: 'Projet créé.' });
      } else {
        await api.investments.projects.update(project.code, {
          title: formData.title, riskScore: formData.riskScore, globalScore: formData.globalScore,
        });
        toast({ title: 'Succès', description: 'Projet mis à jour.' });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Enregistrement impossible.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Créer un projet' : 'Modifier le projet'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          {mode === 'create' && (
            <div className="space-y-2"><Label>Code (unique)</Label><Input value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} /></div>
          )}
          <div className="space-y-2"><Label>Titre</Label><Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} /></div>
          {mode === 'create' && (
            <>
              <div className="space-y-2"><Label>Secteur</Label><Input value={formData.sector} onChange={e => setFormData({...formData, sector: e.target.value})} /></div>
              <div className="space-y-2"><Label>Localisation</Label><Input value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} /></div>
              <div className="space-y-2"><Label>Cible de financement ($)</Label><Input type="number" value={formData.fundingTarget} onChange={e => setFormData({...formData, fundingTarget: Number(e.target.value)})} /></div>
              <div className="space-y-2"><Label>Promoteur</Label><Input value={formData.promoter} onChange={e => setFormData({...formData, promoter: e.target.value})} /></div>
            </>
          )}
          {mode === 'edit' && (
            <>
              <div className="space-y-2"><Label>Score de risque (1-10)</Label><Input type="number" min={1} max={10} value={formData.riskScore} onChange={e => setFormData({...formData, riskScore: Number(e.target.value)})} /></div>
              <div className="space-y-2"><Label>Score global</Label><Input type="number" value={formData.globalScore} onChange={e => setFormData({...formData, globalScore: Number(e.target.value)})} /></div>
            </>
          )}
        </div>
        {mode === 'create' && (
          <p className="text-xs text-muted-foreground">Les conditions de financement (coupon, échéance, ticket minimum) se définissent ensuite via une offre, dans Investissements &gt; Offres.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const ProjectDetailsModal = ({ isOpen, onClose, project }) => {
  const [detail, setDetail] = useState(null);

  React.useEffect(() => {
    if (isOpen && project?.code) {
      api.investments.projects.detail(project.code).then(setDetail).catch(() => setDetail(project));
    } else if (!isOpen) {
      setDetail(null);
    }
  }, [isOpen, project?.code]);

  const p = detail || project;
  if (!p) return null;
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl bg-card text-card-foreground h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl">{p.title}</DialogTitle>
            <ProjectStatusBadge status={p.status} />
          </div>
          <DialogDescription>{p.code} | {p.promoter}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList>
            <TabsTrigger value="details">Détails</TabsTrigger>
            <TabsTrigger value="finances">Finances</TabsTrigger>
            <TabsTrigger value="terms">Conditions</TabsTrigger>
            <TabsTrigger value="esg">Impact & ESG</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground">Secteur</Label><p>{p.sector}</p></div>
              <div><Label className="text-muted-foreground">Localisation</Label><p>{p.location}</p></div>
              <div><Label className="text-muted-foreground">Score global</Label><p className="font-bold">{p.globalScore}</p></div>
              <div><Label className="text-muted-foreground">Catégorie de risque</Label><p><RiskIndicator level={p.riskScore <= 3 ? 'Low' : p.riskScore <= 7 ? 'Medium' : 'High'}/></p></div>
            </div>
            <div><Label className="text-muted-foreground">Objectifs</Label><p className="text-sm">{p.objectives || '-'}</p></div>
            <div><Label className="text-muted-foreground">Description</Label><p className="text-sm">{p.description || '-'}</p></div>
            <div><Label className="text-muted-foreground">Analyse de risque</Label><p className="text-sm">{p.riskAnalysis || '-'}</p></div>
          </TabsContent>

          <TabsContent value="finances" className="space-y-6 pt-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <Label className="text-muted-foreground mb-2 block">Allocation des fonds</Label>
                <div className="bg-muted/30 p-2 rounded-lg"><FundAllocationChart data={p.fundAllocation} /></div>
              </div>
              <div>
                <Label className="text-muted-foreground mb-2 block">Prévision de revenus</Label>
                {p.revenueForecast ? (
                  <div className="bg-muted/30 p-2 rounded-lg"><RevenueForecastChart data={p.revenueForecast} /></div>
                ) : (
                  <p className="text-xs text-muted-foreground p-4">Analyse financière non encore renseignée pour ce projet.</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="terms" className="space-y-4 pt-4">
            {p.typeOfTitle ? (
              <div className="grid grid-cols-2 gap-4">
                <div><Label className="text-muted-foreground">Type de titre</Label><p>{p.typeOfTitle}</p></div>
                <div><Label className="text-muted-foreground">Taux de coupon</Label><p>{p.couponRate}%</p></div>
                <div><Label className="text-muted-foreground">Fréquence de paiement</Label><p>{p.paymentFrequency}</p></div>
                <div><Label className="text-muted-foreground">Échéance</Label><p>{p.maturityMonths} mois</p></div>
                <div><Label className="text-muted-foreground">Ticket minimum</Label><p>${p.minTicket?.toLocaleString()}</p></div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune offre créée pour ce projet pour le moment.</p>
            )}
          </TabsContent>

          <TabsContent value="esg" className="pt-4">
            <Label className="text-muted-foreground">Profil Impact & ESG</Label>
            <div className="bg-primary/10 p-4 rounded-lg mt-2 text-primary">
              <p>{p.impactEsg || 'Non renseigné.'}</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export const InvestorDetailsModal = ({ isOpen, onClose, investor, subscriptions, projects }) => {
  if (!investor) return null;
  const investorSubs = subscriptions.filter(s => s.investorId === investor.id);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl bg-card text-card-foreground h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{investor.userSub}</DialogTitle>
          <DialogDescription>{investor.investorType} | KYC {investor.kycStatus}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Composition du portefeuille</Label>
            <div className="bg-muted/30 p-2 rounded-lg">
              <PortfolioCompositionChart subscriptions={investorSubs} projects={projects} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Performance (12 mois)</Label>
            <div className="bg-muted/30 p-2 rounded-lg">
              <PerformanceChart />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const InvestorModal = ({ isOpen, onClose, mode, investor, onSaved }) => {
    const { toast } = useToast();
    const [formData, setFormData] = useState(
      investor ? { userSub: investor.userSub, investorType: investor.investorType } : { userSub: '', investorType: 'INDIVIDUAL' },
    );
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
      setSaving(true);
      try {
        await api.investments.investors.create({ userSub: formData.userSub, investorType: formData.investorType });
        toast({ title: 'Succès', description: mode === 'create' ? 'Investisseur créé.' : 'Investisseur mis à jour.' });
        onSaved();
        onClose();
      } catch (err) {
        toast({ title: 'Erreur', description: err.message || 'Enregistrement impossible.', variant: 'destructive' });
      } finally {
        setSaving(false);
      }
    };

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Créer un investisseur' : "Modifier l'investisseur"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Identifiant utilisateur IdP (sub)</Label>
              <Input value={formData.userSub} disabled={mode === 'edit'} onChange={e => setFormData({...formData, userSub: e.target.value})} />
              <p className="text-xs text-muted-foreground">L'utilisateur doit s'être déjà connecté au moins une fois via l'IdP AGRICAP.</p>
            </div>
            <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.investorType} onValueChange={v => setFormData({...formData, investorType: v})}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="INDIVIDUAL">Individuel</SelectItem>
                        <SelectItem value="INSTITUTIONAL">Institutionnel</SelectItem>
                        <SelectItem value="CORPORATE">Corporate</SelectItem>
                    </SelectContent>
                </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
};