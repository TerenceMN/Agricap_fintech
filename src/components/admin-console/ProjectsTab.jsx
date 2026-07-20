import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProjectStatusBadge, RiskIndicator, SubscriptionProgressBar, ManagerAssignmentBadge, PROJECT_STATUS_LABELS } from './AgricapComponents';
import { ProjectModal, ProjectDetailsModal } from './AgricapModals';
import { useExport } from '@/lib/agricapHooks';
import { Search, Download, Plus, Eye, Edit } from 'lucide-react';

const riskBucket = (score) => (score <= 3 ? 'Low' : score <= 7 ? 'Medium' : 'High');

export const ProjectsTab = ({ projects, managers, refreshData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedProject, setSelectedProject] = useState(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');

  const { exportToCSV } = useExport();

  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(searchTerm.toLowerCase()) || p.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleExport = () => {
    exportToCSV(filteredProjects, 'projects_export');
  };

  const openEdit = (project) => {
    setSelectedProject(project);
    setModalMode('edit');
    setIsProjectModalOpen(true);
  };

  const openView = (project) => {
    setSelectedProject(project);
    setIsDetailsOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex gap-2 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Rechercher un projet..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">Tous les statuts</SelectItem>
              {Object.entries(PROJECT_STATUS_LABELS).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-2"/> Exporter</Button>
          <Button onClick={() => { setModalMode('create'); setSelectedProject(null); setIsProjectModalOpen(true); }}><Plus className="w-4 h-4 mr-2"/> Nouveau Projet</Button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead>Risque</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Cible ($)</TableHead>
              <TableHead className="w-[150px]">% Souscrit</TableHead>
              <TableHead>Gestionnaire</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProjects.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell className="font-medium">{p.title}</TableCell>
                <TableCell><RiskIndicator level={riskBucket(p.riskScore)}/></TableCell>
                <TableCell><ProjectStatusBadge status={p.status} /></TableCell>
                <TableCell>{p.fundingTarget?.toLocaleString()}</TableCell>
                <TableCell><SubscriptionProgressBar percent={p.progressPercent} /></TableCell>
                <TableCell><ManagerAssignmentBadge managerSub={p.managerSub} managers={managers} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openView(p)}><Eye className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Edit className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filteredProjects.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Aucun projet trouvé</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ProjectModal isOpen={isProjectModalOpen} onClose={() => setIsProjectModalOpen(false)} mode={modalMode} project={selectedProject} onSaved={refreshData} />
      <ProjectDetailsModal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} project={selectedProject} />
    </div>
  );
};
