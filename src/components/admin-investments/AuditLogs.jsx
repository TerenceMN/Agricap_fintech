import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, Download, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/services/api';
import { useExport } from '@/lib/agricapHooks';

const ENTITY_TYPES = ['Project', 'Offer', 'Investor', 'Subscription'];

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const { exportToCSV } = useExport();

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.audit.entries()
      .then(setLogs)
      .catch((err) => setError(err.message || "Impossible de charger le journal d'audit."))
      .finally(() => setLoading(false));
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesType = filterType === 'all' || log.entityType === filterType;
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      String(log.entityId || '').toLowerCase().includes(q) ||
      String(log.action || '').toLowerCase().includes(q) ||
      String(log.user || '').toLowerCase().includes(q);
    return matchesType && matchesSearch;
  });

  const getActionColor = (action) => {
    if (action?.includes('create') || action?.includes('subscribe')) return 'text-green-400';
    if (action?.includes('suspend') || action?.includes('reject')) return 'text-red-400';
    if (action?.includes('transition') || action?.includes('update') || action?.includes('validate')) return 'text-yellow-400';
    return 'text-blue-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex gap-2 flex-1">
           <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Rechercher (action, entité, utilisateur)..."
              className="pl-10 bg-slate-900 border-slate-700"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[180px] bg-slate-900 border-slate-700">
              <SelectValue placeholder="Type d'entité" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les entités</SelectItem>
              {ENTITY_TYPES.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="border-slate-700" onClick={() => exportToCSV(filteredLogs, 'journal_audit_investissements')}>
          <Download className="w-4 h-4 mr-2"/> Exporter CSV
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-300">Horodatage</TableHead>
                <TableHead className="text-slate-300">Action</TableHead>
                <TableHead className="text-slate-300">Type d'entité</TableHead>
                <TableHead className="text-slate-300">ID Entité</TableHead>
                <TableHead className="text-slate-300">Utilisateur</TableHead>
                <TableHead className="text-right text-slate-300">Détails</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.slice(0, 100).map((log) => (
                <TableRow key={log.id} className="border-slate-800 hover:bg-slate-800/30">
                  <TableCell className="text-slate-400 font-mono text-xs">
                    {new Date(log.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className={`font-bold ${getActionColor(log.action)}`}>
                    {log.action}
                  </TableCell>
                  <TableCell className="text-white">{log.entityType || '-'}</TableCell>
                  <TableCell className="font-mono text-slate-400 text-xs">{log.entityId || '-'}</TableCell>
                  <TableCell className="text-slate-300 text-xs">{log.user || 'Système'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setSelectedLog(log)}
                    >
                      <Eye className="w-4 h-4 text-slate-400"/>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredLogs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Aucune entrée d'audit trouvée.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Détail de l'entrée d'audit</DialogTitle>
            <DialogDescription>ID : {selectedLog?.id}</DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 font-mono text-sm">
              <div className="grid grid-cols-2 gap-2 p-4 bg-black/20 rounded">
                <span className="text-slate-500">Horodatage :</span>
                <span>{selectedLog.timestamp}</span>
                <span className="text-slate-500">Utilisateur :</span>
                <span>{selectedLog.user || 'Système'}</span>
                <span className="text-slate-500">Rôle :</span>
                <span>{selectedLog.role || '-'}</span>
                <span className="text-slate-500">Adresse IP :</span>
                <span>{selectedLog.ip || '-'}</span>
              </div>
              <div className="p-4 bg-slate-800 rounded border border-slate-700">
                <p className="text-xs text-slate-400 mb-2">Détails (payload) :</p>
                <p className="whitespace-pre-wrap break-all">{JSON.stringify(selectedLog.details, null, 2)}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuditLogs;
