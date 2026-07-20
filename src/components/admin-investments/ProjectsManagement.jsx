import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Search, Plus, Eye, Edit, Download } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useExport } from '@/lib/agricapHooks';
import { api } from '@/services/api';
import { PROJECT_STATUS_LABELS, ProjectStatusBadge, RiskIndicator, ManagerAssignmentBadge } from '@/components/admin-console/AgricapComponents';

// Transitions autorisées côté serveur (investments/services.py::ALLOWED_TRANSITIONS) —
// reproduites ici uniquement pour peupler le menu déroulant ; le serveur reste seul juge
// (une transition non autorisée est de toute façon rejetée en 400 avec un toast d'erreur).
const ALLOWED_TRANSITIONS = {
  P01: ['P02', 'P13'], P02: ['P03', 'P13'], P03: ['P04', 'P13'], P04: ['P05', 'P13'],
  P05: ['P06', 'P13'], P06: ['P07', 'P13'], P07: ['P08', 'P13'], P08: ['P09', 'P12'],
  P09: ['P10', 'P12'], P10: ['P11', 'P12'], P11: [], P12: [], P13: [],
};

const riskBucket = (score) => (score <= 3 ? 'Low' : score <= 7 ? 'Medium' : 'High');
const emptyCreateForm = { code: '', title: '', sector: '', location: '', fundingTarget: '', promoter: '' };

const ProjectsManagement = ({ projects, managers, refreshData }) => {
  const { toast } = useToast();
  const { exportToCSV } = useExport();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState({});
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);

  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleTransition = async (project, toStatus) => {
    try {
      await api.investments.projects.transition(project.code, toStatus);
      toast({ title: 'Succès', description: `Statut mis à jour : ${PROJECT_STATUS_LABELS[toStatus] || toStatus}.` });
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Transition impossible.', variant: 'destructive' });
    }
  };

  const openCreate = () => { setCreateForm(emptyCreateForm); setIsCreateOpen(true); };

  const handleCreate = async () => {
    if (!createForm.code || !createForm.title) {
      toast({ title: 'Erreur', description: 'Code et titre sont requis.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api.investments.projects.create({
        code: createForm.code, title: createForm.title, sector: createForm.sector,
        location: createForm.location, fundingTarget: Number(createForm.fundingTarget) || 0,
        promoter: createForm.promoter,
      });
      toast({ title: 'Succès', description: 'Projet créé.' });
      setIsCreateOpen(false);
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Création impossible.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (project) => {
    setSelectedProject(project);
    setEditForm({
      title: project.title, description: '', objectives: '', riskAnalysis: '', impactEsg: '',
      riskScore: project.riskScore, globalScore: project.globalScore,
    });
    setIsEditOpen(true);
    // Précharge les champs narratifs depuis la vue détail (absents de la liste).
    api.investments.projects.detail(project.code).then(d => {
      setEditForm(f => ({
        ...f, description: d.description || '', objectives: d.objectives || '',
        riskAnalysis: d.riskAnalysis || '', impactEsg: d.impactEsg || '',
      }));
    }).catch(() => {});
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      await api.investments.projects.update(selectedProject.code, {
        title: editForm.title, description: editForm.description, objectives: editForm.objectives,
        riskAnalysis: editForm.riskAnalysis, impactEsg: editForm.impactEsg,
        riskScore: Number(editForm.riskScore) || 0, globalScore: Number(editForm.globalScore) || 0,
      });
      toast({ title: 'Succès', description: 'Projet mis à jour.' });
      setIsEditOpen(false);
      refreshData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Mise à jour impossible.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openDetails = (project) => {
    setSelectedProject(project);
    setDetail(null);
    setIsDetailsOpen(true);
    api.investments.projects.detail(project.code).then(setDetail).catch(() => setDetail(project));
  };

  return (
    <div className="space-y-6">
      {/* Filters & Actions */}
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Rechercher par code ou titre..."
              className="pl-10 bg-slate-900 border-slate-700"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[220px] bg-slate-900 border-slate-700">
              <SelectValue placeholder="Filtrer par statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(PROJECT_STATUS_LABELS).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
           <Button variant="outline" className="border-slate-700" onClick={() => exportToCSV(filteredProjects, 'projets')}>
            <Download className="w-4 h-4 mr-2" /> Exporter
          </Button>
          <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2" /> Nouveau Projet
          </Button>
        </div>
      </div>

      {/* Projects Table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-slate-800/50">
                <TableHead className="text-slate-300">Code</TableHead>
                <TableHead className="text-slate-300">Projet</TableHead>
                <TableHead className="text-slate-300">Risque</TableHead>
                <TableHead className="text-slate-300">Cible ($)</TableHead>
                <TableHead className="text-slate-300">Collecté ($)</TableHead>
                <TableHead className="text-slate-300">Progression</TableHead>
                <TableHead className="text-slate-300">Gestionnaire</TableHead>
                <TableHead className="text-slate-300">Statut</TableHead>
                <TableHead className="text-right text-slate-300">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project) => (
                <TableRow key={project.id} className="border-slate-800 hover:bg-slate-800/30">
                  <TableCell className="font-mono text-xs text-slate-400">{project.code}</TableCell>
                  <TableCell className="font-medium text-white">
                    <div>{project.title}</div>
                    <div className="text-xs text-slate-500">{project.sector} • {project.location}</div>
                  </TableCell>
                  <TableCell><RiskIndicator level={riskBucket(project.riskScore)} /></TableCell>
                  <TableCell className="text-slate-300 font-mono">{project.fundingTarget?.toLocaleString()}</TableCell>
                  <TableCell className="text-emerald-400 font-mono">{project.fundedAmount?.toLocaleString()}</TableCell>
                  <TableCell className="w-[150px]">
                    <div className="flex items-center gap-2">
                      <Progress value={project.progressPercent} className="h-2" />
                      <span className="text-xs text-slate-400">{project.progressPercent}%</span>
                    </div>
                  </TableCell>
                  <TableCell><ManagerAssignmentBadge managerSub={project.managerSub} managers={managers} /></TableCell>
                  <TableCell><ProjectStatusBadge status={project.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-white" onClick={() => openDetails(project)}><Eye className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-white" onClick={() => openEdit(project)}><Edit className="w-4 h-4" /></Button>
                      {(ALLOWED_TRANSITIONS[project.status] || []).length > 0 && (
                        <Select onValueChange={(val) => handleTransition(project, val)}>
                          <SelectTrigger className="w-[140px] h-8 text-xs bg-transparent border-slate-700 text-slate-400">
                            <SelectValue placeholder="Changer statut" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            {ALLOWED_TRANSITIONS[project.status].map(code => (
                              <SelectItem key={code} value={code}>{PROJECT_STATUS_LABELS[code]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredProjects.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-500">Aucun projet trouvé.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Créer un nouveau projet</DialogTitle>
            <DialogDescription>Ajoute une nouvelle opportunité d'investissement au pipeline (statut initial : Prospection).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
             <div className="space-y-2">
                <Label>Code (unique)</Label>
                <Input className="bg-slate-800 border-slate-700" value={createForm.code} onChange={e => setCreateForm({...createForm, code: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Titre</Label>
                <Input className="bg-slate-800 border-slate-700" value={createForm.title} onChange={e => setCreateForm({...createForm, title: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Secteur</Label>
                <Input className="bg-slate-800 border-slate-700" value={createForm.sector} onChange={e => setCreateForm({...createForm, sector: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Localisation</Label>
                <Input className="bg-slate-800 border-slate-700" value={createForm.location} onChange={e => setCreateForm({...createForm, location: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Cible de financement ($)</Label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={createForm.fundingTarget} onChange={e => setCreateForm({...createForm, fundingTarget: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Promoteur</Label>
                <Input className="bg-slate-800 border-slate-700" value={createForm.promoter} onChange={e => setCreateForm({...createForm, promoter: e.target.value})} />
             </div>
          </div>
          <p className="text-xs text-slate-500">Les conditions de financement (coupon, échéance, ticket minimum) se définissent ensuite via une offre, dans l'onglet Offres.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Annuler</Button>
            <Button className="bg-emerald-600" onClick={handleCreate} disabled={saving}>Créer le projet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modifier le projet {selectedProject?.code}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
             <div className="col-span-2 space-y-2">
                <Label>Titre</Label>
                <Input className="bg-slate-800 border-slate-700" value={editForm.title || ''} onChange={e => setEditForm({...editForm, title: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Score de risque (1-10)</Label>
                <Input type="number" min={1} max={10} className="bg-slate-800 border-slate-700" value={editForm.riskScore ?? ''} onChange={e => setEditForm({...editForm, riskScore: e.target.value})} />
             </div>
             <div className="space-y-2">
                <Label>Score global</Label>
                <Input type="number" className="bg-slate-800 border-slate-700" value={editForm.globalScore ?? ''} onChange={e => setEditForm({...editForm, globalScore: e.target.value})} />
             </div>
             <div className="col-span-2 space-y-2">
                <Label>Description</Label>
                <Textarea className="bg-slate-800 border-slate-700" value={editForm.description || ''} onChange={e => setEditForm({...editForm, description: e.target.value})} />
             </div>
             <div className="col-span-2 space-y-2">
                <Label>Objectifs</Label>
                <Textarea className="bg-slate-800 border-slate-700" value={editForm.objectives || ''} onChange={e => setEditForm({...editForm, objectives: e.target.value})} />
             </div>
             <div className="col-span-2 space-y-2">
                <Label>Analyse de risque</Label>
                <Textarea className="bg-slate-800 border-slate-700" value={editForm.riskAnalysis || ''} onChange={e => setEditForm({...editForm, riskAnalysis: e.target.value})} />
             </div>
             <div className="col-span-2 space-y-2">
                <Label>Impact & ESG</Label>
                <Textarea className="bg-slate-800 border-slate-700" value={editForm.impactEsg || ''} onChange={e => setEditForm({...editForm, impactEsg: e.target.value})} />
             </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Annuler</Button>
            <Button className="bg-emerald-600" onClick={handleUpdate} disabled={saving}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl">{selectedProject?.title}</DialogTitle>
              {selectedProject && <ProjectStatusBadge status={selectedProject.status} />}
            </div>
            <DialogDescription>{selectedProject?.code} • {selectedProject?.promoter}</DialogDescription>
          </DialogHeader>
          {!detail ? (
            <div className="py-8 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500"></div></div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><Label className="text-slate-500">Secteur</Label><p>{detail.sector || '-'}</p></div>
                <div><Label className="text-slate-500">Localisation</Label><p>{detail.location || '-'}</p></div>
                <div><Label className="text-slate-500">Score global</Label><p className="font-bold">{detail.globalScore}</p></div>
                <div><Label className="text-slate-500">Score de risque</Label><p><RiskIndicator level={riskBucket(detail.riskScore)} /></p></div>
              </div>
              <div><Label className="text-slate-500">Objectifs</Label><p className="text-slate-300">{detail.objectives || '-'}</p></div>
              <div><Label className="text-slate-500">Description</Label><p className="text-slate-300">{detail.description || '-'}</p></div>
              <div><Label className="text-slate-500">Analyse de risque</Label><p className="text-slate-300">{detail.riskAnalysis || '-'}</p></div>
              <div><Label className="text-slate-500">Impact & ESG</Label><p className="text-slate-300">{detail.impactEsg || '-'}</p></div>
              {detail.typeOfTitle ? (
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-800/50 rounded border border-slate-700">
                  <div><Label className="text-slate-500">Type de titre</Label><p>{detail.typeOfTitle}</p></div>
                  <div><Label className="text-slate-500">Taux de coupon</Label><p>{detail.couponRate}%</p></div>
                  <div><Label className="text-slate-500">Fréquence de paiement</Label><p>{detail.paymentFrequency}</p></div>
                  <div><Label className="text-slate-500">Échéance</Label><p>{detail.maturityMonths} mois</p></div>
                  <div><Label className="text-slate-500">Ticket minimum</Label><p>{detail.minTicket?.toLocaleString()} $</p></div>
                </div>
              ) : (
                <p className="text-slate-500">Aucune offre créée pour ce projet pour le moment.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectsManagement;
