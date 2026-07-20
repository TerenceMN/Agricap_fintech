import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Download, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { GeographicZoneBadge } from './AgricapComponents';
import { Button } from '@/components/ui/button';
import { useExport } from '@/lib/agricapHooks';

const TYPE_LABEL = {
  DEPOSIT: 'Dépôt', SUBSCRIPTION: 'Souscription', COUPON_REPAYMENT: 'Remboursement coupon',
  CAPITAL_REPAYMENT: 'Remboursement capital', WITHDRAWAL: 'Retrait', FEES: 'Frais',
};
const INFLOW_TYPES = ['DEPOSIT', 'COUPON_REPAYMENT', 'CAPITAL_REPAYMENT'];
const OUTFLOW_TYPES = ['WITHDRAWAL', 'SUBSCRIPTION', 'FEES'];

export const TransactionsTab = ({ movements }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const { exportToCSV } = useExport();

  const filteredMovements = movements.filter(m => {
    const matchesSearch = String(m.id).includes(searchTerm) || String(m.investorId ?? '').includes(searchTerm);
    const matchesType = typeFilter === 'All' || m.type === typeFilter;
    return matchesSearch && matchesType;
  }).sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

  const inflows = filteredMovements.filter(m => INFLOW_TYPES.includes(m.type)).reduce((acc, m) => acc + m.amount, 0);
  const outflows = filteredMovements.filter(m => OUTFLOW_TYPES.includes(m.type)).reduce((acc, m) => acc + m.amount, 0);

  const getMovementIcon = (type) => {
    if (INFLOW_TYPES.includes(type)) return <ArrowDownRight className="w-4 h-4 text-green-500" />;
    return <ArrowUpRight className="w-4 h-4 text-red-500" />;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-card border rounded-lg">
          <p className="text-sm text-muted-foreground">Total Entrées</p>
          <p className="text-2xl font-bold text-green-500">${inflows.toLocaleString()}</p>
        </div>
        <div className="p-4 bg-card border rounded-lg">
          <p className="text-sm text-muted-foreground">Total Sorties</p>
          <p className="text-2xl font-bold text-red-500">${outflows.toLocaleString()}</p>
        </div>
        <div className="p-4 bg-card border rounded-lg">
          <p className="text-sm text-muted-foreground">Solde Net</p>
          <p className="text-2xl font-bold text-primary">${(inflows - outflows).toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex gap-2 flex-1">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Rechercher ID ou investisseur..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">Tous les types</SelectItem>
              {Object.entries(TYPE_LABEL).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => exportToCSV(filteredMovements, 'transactions')}><Download className="w-4 h-4 mr-2"/> Exporter</Button>
      </div>

      <div className="border rounded-md bg-card h-[600px] overflow-y-auto">
        <Table>
          <TableHeader className="bg-muted/50 sticky top-0 z-10">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Investisseur</TableHead>
              <TableHead>Projet</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead className="text-right">Montant ($)</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMovements.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(m.dateTime).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">MOV-{m.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getMovementIcon(m.type)}
                    <span>{TYPE_LABEL[m.type] || m.type}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{m.investorId ? `INV-${m.investorId}` : '-'}</TableCell>
                <TableCell className="font-mono text-xs">{m.projectId ? `PRJ-${m.projectId}` : '-'}</TableCell>
                <TableCell><GeographicZoneBadge zone={m.geographicZone || 'Non défini'} /></TableCell>
                <TableCell className="text-right font-mono font-medium">${m.amount.toLocaleString()}</TableCell>
                <TableCell><span className="px-2 py-1 bg-primary/20 text-primary rounded-full text-xs font-bold">{m.status}</span></TableCell>
              </TableRow>
            ))}
            {filteredMovements.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Aucune transaction.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
