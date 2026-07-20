import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  FileText, Download, AlertCircle, Eye, TrendingUp, Search, Filter
} from 'lucide-react';
import { api } from '@/services/api';
import { buildCommitments, formatCurrency, formatDate, getCommitmentStatusColor, calculateMonthsRemaining } from '@/lib/investorSpaceUtils';
import PerformanceReports from './PerformanceReports';

const MyInvestments = ({ onUpdate }) => {
  const { toast } = useToast();
  const [commitments, setCommitments] = useState([]);
  const [filteredCommitments, setFilteredCommitments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [selectedCommitment, setSelectedCommitment] = useState(null);
  const [showReportsModal, setShowReportsModal] = useState(false);

  useEffect(() => {
    loadCommitments();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [commitments, statusFilter, searchQuery, sortBy]);

  const loadCommitments = async () => {
    try {
      const [subscriptions, offers, projects] = await Promise.all([
        api.investments.subscriptions.mine(),
        api.investments.offers.list(),
        api.investments.projects.list(),
      ]);
      setCommitments(buildCommitments(subscriptions, offers, projects));
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
    }
  };

  const applyFilters = () => {
    let filtered = [...commitments];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(c => c.status === statusFilter);
    }

    if (searchQuery) {
      filtered = filtered.filter(c =>
        c.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'amount':
          return b.amount - a.amount;
        case 'return':
          return b.couponRate - a.couponRate;
        case 'date':
        default:
          return new Date(b.subscriptionDate) - new Date(a.subscriptionDate);
      }
    });

    setFilteredCommitments(filtered);
  };

  const handleDownloadDocs = () => {
    toast({
      title: 'Télécharger documents',
      description: "Non disponible : aucun document n'est encore rattaché aux souscriptions côté serveur.",
    });
  };

  const handleViewReports = (commitment) => {
    setSelectedCommitment(commitment);
    setShowReportsModal(true);
  };

  const handleWithdrawal = () => {
    toast({
      title: "Fonctionnalité en développement",
      description: "La demande de retrait anticipé sera disponible prochainement.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Mes Investissements</h2>
          <p className="text-slate-400">Gérez et suivez tous vos engagements</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Rechercher..."
              className="pl-10 bg-slate-800 border-slate-700 w-[200px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="Active">Actifs</SelectItem>
              <SelectItem value="Repayment">Remboursement</SelectItem>
              <SelectItem value="Completed">Complétés</SelectItem>
              <SelectItem value="Defaulted">Défaut</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Trier par Date</SelectItem>
              <SelectItem value="amount">Trier par Montant</SelectItem>
              <SelectItem value="return">Trier par Rendement</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Total Investi</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(commitments.reduce((sum, c) => sum + c.amount, 0))}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Revenus Perçus</p>
            <p className="text-2xl font-bold text-emerald-400">
              {formatCurrency(commitments.reduce((sum, c) => sum + c.totalReceived, 0))}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Investissements Actifs</p>
            <p className="text-2xl font-bold text-blue-400">
              {commitments.filter(c => c.status === 'Active' || c.status === 'Repayment').length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Taux Moyen</p>
            <p className="text-2xl font-bold text-purple-400">
              {commitments.length > 0
                ? (commitments.reduce((sum, c) => sum + c.couponRate, 0) / commitments.length).toFixed(1)
                : 0}%
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Investments Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Liste des Engagements ({filteredCommitments.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-slate-800/50">
                    <TableHead className="text-slate-300">ID</TableHead>
                    <TableHead className="text-slate-300">Projet</TableHead>
                    <TableHead className="text-slate-300">Montant</TableHead>
                    <TableHead className="text-slate-300">Coupons</TableHead>
                    <TableHead className="text-slate-300">Souscription</TableHead>
                    <TableHead className="text-slate-300">Maturité</TableHead>
                    <TableHead className="text-slate-300">Rendement</TableHead>
                    <TableHead className="text-slate-300">Reçu</TableHead>
                    <TableHead className="text-slate-300">Statut</TableHead>
                    <TableHead className="text-right text-slate-300">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCommitments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-400">
                        Aucun investissement trouvé
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCommitments.map((commitment) => (
                      <TableRow key={commitment.id} className="border-slate-800 hover:bg-slate-800/30">
                        <TableCell className="font-mono text-xs text-slate-400">{commitment.id}</TableCell>
                        <TableCell className="font-medium text-white max-w-[200px]">
                          <div className="truncate">{commitment.projectName}</div>
                        </TableCell>
                        <TableCell className="font-mono text-emerald-400">{formatCurrency(commitment.amount)}</TableCell>
                        <TableCell className="text-white">{commitment.bonds}</TableCell>
                        <TableCell className="text-slate-300">{formatDate(commitment.subscriptionDate)}</TableCell>
                        <TableCell className="text-slate-300">
                          <div>{formatDate(commitment.expectedMaturity)}</div>
                          <div className="text-xs text-slate-500">
                            {commitment.expectedMaturity && (commitment.status === 'Active' || commitment.status === 'Repayment')
                              ? `(${calculateMonthsRemaining(commitment.expectedMaturity)} mois)`
                              : ''}
                          </div>
                        </TableCell>
                        <TableCell className="font-bold text-purple-400">{commitment.couponRate}%</TableCell>
                        <TableCell className="font-mono text-blue-400">{formatCurrency(commitment.totalReceived)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getCommitmentStatusColor(commitment.status)}>
                            {commitment.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => handleViewReports(commitment)}
                              title="Rapports de performance"
                            >
                              <TrendingUp className="w-4 h-4 text-blue-400" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={handleDownloadDocs}
                              title="Télécharger documents"
                            >
                              <Download className="w-4 h-4 text-emerald-400" />
                            </Button>
                            {(commitment.status === 'Active' || commitment.status === 'Repayment') && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={handleWithdrawal}
                                title="Demander retrait"
                              >
                                <AlertCircle className="w-4 h-4 text-amber-400" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Performance Reports Modal */}
      <Dialog open={showReportsModal} onOpenChange={setShowReportsModal}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rapports de Performance</DialogTitle>
          </DialogHeader>
          {selectedCommitment && (
            <PerformanceReports projectCode={selectedCommitment.projectCode} projectName={selectedCommitment.projectName} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyInvestments;
