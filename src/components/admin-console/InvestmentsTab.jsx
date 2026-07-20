import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, ChevronDown, ChevronRight, Download, Plus, Eye, Edit } from 'lucide-react';
import { useExport } from '@/lib/agricapHooks';
import { ManagerAssignmentBadge } from './AgricapComponents';
import { InvestorModal, InvestorDetailsModal } from './AgricapModals';

const investorSubs = (subscriptions, investorId) => subscriptions.filter(s => s.investorId === investorId);
const totalInvested = (subs) => subs.reduce((sum, s) => sum + s.amount, 0);
const totalPortfolioValue = (subs) => subs.reduce((sum, s) => sum + s.amount + s.totalReceived, 0);
const avgWeightedReturn = (subs) => {
  const invested = totalInvested(subs);
  if (!invested) return 0;
  return subs.reduce((sum, s) => sum + s.couponRate * s.amount, 0) / invested;
};

export const InvestmentsTab = ({ investors, subscriptions, projects, managers, refreshData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [selectedInvestor, setSelectedInvestor] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');

  const { exportToCSV } = useExport();

  const filteredInvestors = investors.filter(i =>
    i.userSub.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const toggleRow = (id) => setExpandedRow(expandedRow === id ? null : id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher un investisseur..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportToCSV(filteredInvestors, 'investors')}><Download className="w-4 h-4 mr-2"/> Exporter</Button>
          <Button onClick={() => { setModalMode('create'); setSelectedInvestor(null); setIsModalOpen(true); }}><Plus className="w-4 h-4 mr-2"/> Nouvel Investisseur</Button>
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>Investisseur</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Gestionnaire</TableHead>
              <TableHead className="text-right">Total Investi ($)</TableHead>
              <TableHead className="text-right">Valeur Portefeuille ($)</TableHead>
              <TableHead className="text-right">Rendement Moy.</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvestors.map((inv) => {
              const isExpanded = expandedRow === inv.id;
              const subs = investorSubs(subscriptions, inv.id);
              const invested = totalInvested(subs);
              const portValue = totalPortfolioValue(subs);
              const avgRet = avgWeightedReturn(subs);

              return (
                <React.Fragment key={inv.id}>
                  <TableRow className="hover:bg-muted/30 cursor-pointer" onClick={() => toggleRow(inv.id)}>
                    <TableCell>{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
                    <TableCell className="font-medium">{inv.userSub}</TableCell>
                    <TableCell>{inv.investorType}</TableCell>
                    <TableCell><ManagerAssignmentBadge managerSub={inv.assignedManagerSub} managers={managers} /></TableCell>
                    <TableCell className="text-right font-mono">{invested.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-primary">{portValue.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-bold">{avgRet.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setSelectedInvestor(inv); setIsDetailsOpen(true); }}><Eye className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setSelectedInvestor(inv); setModalMode('edit'); setIsModalOpen(true); }}><Edit className="w-4 h-4" /></Button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/10">
                      <TableCell colSpan={8} className="p-0">
                        <div className="p-4 pl-12">
                          <h4 className="font-semibold text-sm mb-2 text-muted-foreground">Projets financés</h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Offre</TableHead>
                                <TableHead>Montant</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Statut</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {subs.map(s => (
                                <TableRow key={s.id}>
                                  <TableCell className="font-medium text-sm">Offre #{s.offerId}</TableCell>
                                  <TableCell className="font-mono text-sm">${s.amount.toLocaleString()}</TableCell>
                                  <TableCell className="text-sm">{new Date(s.subscriptionDate).toLocaleDateString()}</TableCell>
                                  <TableCell className="text-sm">{s.status}</TableCell>
                                </TableRow>
                              ))}
                              {subs.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm text-center">Aucune souscription active</TableCell></TableRow>}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <InvestorModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} mode={modalMode} investor={selectedInvestor} onSaved={refreshData} />
      <InvestorDetailsModal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} investor={selectedInvestor} subscriptions={subscriptions} projects={projects} />
    </div>
  );
};
