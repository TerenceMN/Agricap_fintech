import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, FileCheck, RefreshCw, Download } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useExport } from '@/lib/agricapHooks';

const STATUS_LABELS = {
  PENDING: 'En attente', ACTIVE: 'Actif', REPAYMENT: 'Remboursement',
  COMPLETED: 'Terminé', DEFAULTED: 'Défaut', CANCELLED: 'Annulé',
};
const STATUS_COLORS = {
  PENDING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ACTIVE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REPAYMENT: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  COMPLETED: 'bg-green-600/20 text-green-400 border-green-600/30',
  DEFAULTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};
const PAYMENT_LABELS = { PAID: 'Payé', UNPAID: 'Impayé', OVERDUE: 'En retard' };

const SubscriptionsManagement = ({ subscriptions, offers, projects, investors }) => {
  const { toast } = useToast();
  const { exportToCSV } = useExport();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const investorFor = (id) => investors.find(i => i.id === id);
  const offerFor = (id) => offers.find(o => o.id === id);
  const projectFor = (offerId) => {
    const offer = offerFor(offerId);
    return offer ? projects.find(p => p.id === offer.projectId) : null;
  };

  const filtered = subscriptions.filter(s => {
    const investor = investorFor(s.investorId);
    const matchesSearch = !query ||
      String(s.id).includes(query) ||
      (investor?.userSub || '').toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Aucun endpoint serveur n'existe pour valider un paiement ou "traiter" une souscription
  // manuellement (pas de subscription_action côté backend) — trou produit assumé, pas
  // de simulation côté client.
  const notAvailable = (label) => toast({
    title: label,
    description: 'Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex gap-2 flex-1">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Rechercher ID ou investisseur..."
              className="pl-10 bg-slate-900 border-slate-700"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] bg-slate-900 border-slate-700">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {Object.entries(STATUS_LABELS).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="border-slate-700" onClick={() => exportToCSV(filtered, 'souscriptions')}>
          <Download className="w-4 h-4 mr-2"/> Exporter
        </Button>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-300">ID</TableHead>
                <TableHead className="text-slate-300">Investisseur</TableHead>
                <TableHead className="text-slate-300">Offre / Projet</TableHead>
                <TableHead className="text-slate-300">Montant</TableHead>
                <TableHead className="text-slate-300">Obligations</TableHead>
                <TableHead className="text-slate-300">Coupon</TableHead>
                <TableHead className="text-slate-300">Statut Paiement</TableHead>
                <TableHead className="text-slate-300">Statut</TableHead>
                <TableHead className="text-slate-300">Date</TableHead>
                <TableHead className="text-right text-slate-300">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(sub => {
                const investor = investorFor(sub.investorId);
                const offer = offerFor(sub.offerId);
                const project = projectFor(sub.offerId);
                return (
                  <TableRow key={sub.id} className="border-slate-800 hover:bg-slate-800/30">
                    <TableCell className="font-mono text-xs text-slate-400">SUB-{sub.id}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-300">{investor?.userSub || `#${sub.investorId}`}</TableCell>
                    <TableCell className="text-sm text-white">
                      {offer?.code || `#${sub.offerId}`}
                      {project && <div className="text-xs text-slate-500">{project.title}</div>}
                    </TableCell>
                    <TableCell className="font-bold text-white">{sub.amount.toLocaleString()} $</TableCell>
                    <TableCell className="text-slate-300">{sub.bonds}</TableCell>
                    <TableCell className="text-blue-400 font-bold">{sub.couponRate}%</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={sub.paymentStatus === 'PAID' ? 'text-green-400 border-green-500/30' : sub.paymentStatus === 'OVERDUE' ? 'text-red-400 border-red-500/30' : 'text-yellow-400 border-yellow-500/30'}>
                        {PAYMENT_LABELS[sub.paymentStatus] || sub.paymentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell><Badge className={STATUS_COLORS[sub.status] || 'bg-slate-500/20 text-slate-400'}>{STATUS_LABELS[sub.status] || sub.status}</Badge></TableCell>
                    <TableCell className="text-xs text-slate-500">{new Date(sub.subscriptionDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {sub.paymentStatus !== 'PAID' && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-400" title="Valider Paiement" onClick={() => notAvailable('Valider le paiement')}><FileCheck className="w-4 h-4"/></Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" title="Traiter" onClick={() => notAvailable('Traiter la souscription')}><RefreshCw className="w-4 h-4"/></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-slate-500">Aucune souscription trouvée.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default SubscriptionsManagement;
