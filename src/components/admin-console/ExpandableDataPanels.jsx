import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Download, FileText, FileSpreadsheet, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { exportToExcel, exportToPDF } from '@/lib/export';

const Panel = ({ title, icon: Icon, children, data, exportName }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-4 bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div 
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground text-lg">{title}</h3>
        </div>
        <div className="flex items-center gap-4">
          {data && (
            <div className="hidden sm:flex gap-2" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" onClick={() => exportToExcel(data, exportName)} className="h-8 text-xs text-muted-foreground hover:text-foreground">
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
              </Button>
            </div>
          )}
          {isOpen ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
        </div>
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border"
          >
            <div className="p-4 bg-background/50">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ExpandableDataPanels = ({ data }) => {
  if (!data) return null;

  const topProjects = [...data.projects].sort((a, b) => b.fundingTarget - a.fundingTarget).slice(0, 5);
  const recentTx = [...data.movements].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime)).slice(0, 10);

  // Calc Geo Distribution
  const geoStats = data.movements.reduce((acc, m) => {
    const zone = m.geographicZone || 'Non défini';
    acc[zone] = (acc[zone] || 0) + m.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-2 mb-8">
      <Panel title="Aperçu des Projets (Top 5)" icon={FileText} data={topProjects} exportName="top_projects">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead>Secteur</TableHead>
              <TableHead className="text-right">Cible ($)</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topProjects.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell className="font-medium">{p.title}</TableCell>
                <TableCell>{p.sector}</TableCell>
                <TableCell className="text-right font-mono text-emerald-400">{p.fundingTarget?.toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
              </TableRow>
            ))}
            {topProjects.length === 0 && <TableRow><TableCell colSpan={5} className="text-center">Aucun projet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Dernières Transactions" icon={FileText} data={recentTx} exportName="recent_tx">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Montant ($)</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTx.map(tx => (
              <TableRow key={tx.id}>
                <TableCell className="text-xs">{new Date(tx.dateTime).toLocaleString()}</TableCell>
                <TableCell>{tx.type}</TableCell>
                <TableCell className={`text-right font-mono font-medium ${tx.type === 'DEPOSIT' ? 'text-emerald-400' : 'text-foreground'}`}>
                  {tx.amount.toLocaleString()}
                </TableCell>
                <TableCell>{tx.geographicZone || '-'}</TableCell>
                <TableCell><Badge variant="outline">{tx.status}</Badge></TableCell>
              </TableRow>
            ))}
            {recentTx.length === 0 && <TableRow><TableCell colSpan={5} className="text-center">Aucune transaction.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Distribution Géographique" icon={MapPin} data={Object.entries(geoStats).map(([zone, amount]) => ({zone, amount}))} exportName="geo_distribution">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(geoStats).map(([zone, amount]) => (
            <div key={zone} className="p-4 bg-card rounded-lg border border-border">
              <p className="text-sm text-muted-foreground">{zone || 'Non défini'}</p>
              <p className="text-xl font-bold text-foreground mt-1">${amount.toLocaleString()}</p>
            </div>
          ))}
          {Object.keys(geoStats).length === 0 && <p className="col-span-full text-muted-foreground p-4">Aucune donnée géographique.</p>}
        </div>
      </Panel>
    </div>
  );
};