import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Filter, Search, TrendingUp } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import {
  subscriptionStatusClass, projectStatusClass, valuationMethodLabel, formatPercent,
} from '@/lib/investorSpaceWire';
import PerformanceReports from './PerformanceReports';

const TYPE_FILTERS = [
  { value: 'all', label: 'Dette et capital' },
  { value: 'OBLIGATION', label: 'Dette uniquement' },
  { value: 'ACTION', label: 'Capital uniquement' },
];

/**
 * Le détail des positions de l'investisseur.
 *
 * Les positions arrivent en PROPS, déjà construites et déjà filtrées sur SON
 * identifiant (`buildPositions`) : ce composant ne parle plus au réseau et ne
 * calcule plus aucun total. Les quatre colonnes de montant — réservé, alloué,
 * encaissé, reçu — restent distinctes : les fondre en un « montant investi »
 * unique présenterait une intention de souscription comme de l'argent placé.
 *
 * La typologie dette / capital vient de l'écran `Investments` supprimé ; elle
 * n'est pas décorative : un coupon obligataire est une obligation contractuelle,
 * un rendement d'action ne l'est pas.
 */
const MyInvestments = ({ positions }) => {
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [selected, setSelected] = useState(null);

  const statuses = useMemo(
    () => Array.from(new Set(positions.map((p) => p.status))).sort(),
    [positions],
  );

  const visible = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return positions
      .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
      .filter((p) => (typeFilter === 'all' ? true : p.titleType === typeFilter))
      .filter((p) => (query
        ? p.projectTitle.toLowerCase().includes(query) || p.key.toLowerCase().includes(query)
        : true))
      .sort((a, b) => {
        if (sortBy === 'amount') return b.settledAmount - a.settledAmount;
        if (sortBy === 'return') return (b.couponRatePercent ?? 0) - (a.couponRatePercent ?? 0);
        return b.subscriptionDate.localeCompare(a.subscriptionDate);
      });
  }, [positions, statusFilter, typeFilter, searchQuery, sortBy]);

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-white">Mes investissements</h2>
          <p className="text-slate-400">
            {positions.length} position{positions.length > 1 ? 's' : ''} · montants servis par le serveur
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Rechercher…"
              className="pl-10 bg-slate-800 border-slate-700 w-[200px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[190px] bg-slate-800 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px] bg-slate-800 border-slate-700">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Trier par date</SelectItem>
              <SelectItem value="amount">Trier par montant encaissé</SelectItem>
              <SelectItem value="return">Trier par coupon</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Positions ({visible.length})</CardTitle>
          <CardDescription>
            « Réservé » est un engagement pris ; « encaissé » est l’argent réellement parti.
            Les deux colonnes restent séparées.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-slate-800/50">
                  <TableHead className="text-slate-300">Référence</TableHead>
                  <TableHead className="text-slate-300">Projet</TableHead>
                  <TableHead className="text-slate-300">Type de titre</TableHead>
                  <TableHead className="text-slate-300 text-right">Réservé</TableHead>
                  <TableHead className="text-slate-300 text-right">Encaissé</TableHead>
                  <TableHead className="text-slate-300 text-right">Reçu</TableHead>
                  <TableHead className="text-slate-300 text-right">Capital restant dû</TableHead>
                  <TableHead className="text-slate-300 text-right">Gain latent</TableHead>
                  <TableHead className="text-slate-300 text-right">Perte estimée</TableHead>
                  <TableHead className="text-slate-300">Valorisation</TableHead>
                  <TableHead className="text-slate-300 text-right">Coupon</TableHead>
                  <TableHead className="text-slate-300">Souscrit le</TableHead>
                  <TableHead className="text-slate-300">Statut</TableHead>
                  <TableHead className="text-slate-300">Projet</TableHead>
                  <TableHead className="text-right text-slate-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center py-12 text-slate-400">
                      {positions.length === 0
                        ? 'Vous n’avez encore aucune souscription.'
                        : 'Aucune position ne correspond à ces filtres.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((p) => (
                    <TableRow
                      key={p.key}
                      className={`border-slate-800 hover:bg-slate-800/30 ${p.isInDefault ? 'bg-red-500/5' : ''}`}
                    >
                      <TableCell className="font-mono text-xs text-slate-400">{p.key}</TableCell>
                      <TableCell className="font-medium text-white max-w-[220px]">
                        <div className="truncate">{p.projectTitle}</div>
                        <div className="text-xs text-slate-500">{p.sector || '—'} · {p.location || '—'}</div>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">{p.titleTypeLabel}</TableCell>
                      <TableCell className="text-right font-mono text-slate-300">
                        {formatCurrency(p.reservedAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-400">
                        {formatCurrency(p.settledAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-blue-400">
                        {formatCurrency(p.totalReceived)}
                      </TableCell>
                      {/* Valorisation SERVEUR, position par position. Un tiret
                          quand elle n'existe pas : une réservation n'est pas
                          valorisée, et l'inventer serait pire que le vide. */}
                      <TableCell className="text-right font-mono text-white">
                        {p.valuation ? formatCurrency(p.valuation.capitalOutstanding) : '—'}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${
                        (p.valuation?.latentGain ?? 0) < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                        {p.valuation ? formatCurrency(p.valuation.latentGain) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-300">
                        {p.valuation
                          ? (p.valuation.impairment > 0 ? formatCurrency(p.valuation.impairment) : '—')
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400" title={p.valuation?.valuationNote || ''}>
                        {p.valuation ? valuationMethodLabel(p.valuation.valuationMethod) : 'Non valorisée'}
                      </TableCell>
                      <TableCell className="text-right font-bold text-purple-400">
                        {formatPercent(p.couponRatePercent)}
                      </TableCell>
                      <TableCell className="text-slate-300">{formatDate(p.subscriptionDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={subscriptionStatusClass(p.status)}>
                          {p.statusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={projectStatusClass(p.projectStatus)}>
                          {p.projectStatusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setSelected(p)}
                          title="Rapports de performance du projet"
                          disabled={!p.projectCode}
                        >
                          <TrendingUp className="w-4 h-4 text-blue-400" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rapports de performance</DialogTitle>
          </DialogHeader>
          {selected && (
            <PerformanceReports projectCode={selected.projectCode} projectName={selected.projectTitle} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyInvestments;
