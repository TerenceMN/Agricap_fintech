import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { api } from '@/services/api';

const statusVariantMap = {
  'Validé': 'success',
  'En attente': 'info',
  'Non applicable': 'secondary',
};

// Journal des mouvements financiers d'un dossier — chargé depuis le backend.
const TransactionSubTable = ({ creditId, currency: creditCurrency }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.portfolio.transactions(creditId)
      .then((r) => { if (alive) setTransactions(r.transactions || []); })
      .catch(() => { if (alive) setTransactions([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [creditId]);

  return (
    <div className="p-4 bg-slate-800/50">
      <h4 className="text-md font-semibold text-white mb-3">Journal des Mouvements Financiers</h4>
      <Table>
        <TableHeader>
          <TableRow className="border-slate-700">
            <TableHead>Date</TableHead>
            <TableHead>Type d'opération</TableHead>
            <TableHead>Moyen de paiement</TableHead>
            <TableHead>Référence</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="text-right">Solde Restant ({creditCurrency})</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Vérifié par</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx, index) => (
            <TableRow key={tx.id ?? index} className="border-slate-700 text-xs">
              <TableCell>{tx.date}</TableCell>
              <TableCell className="font-medium">{tx.type}</TableCell>
              <TableCell>{tx.paymentMethod || '-'}</TableCell>
              <TableCell className="font-mono">{tx.ref || '-'}</TableCell>
              <TableCell className={`text-right font-mono ${tx.amount === null ? '' : tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {tx.amount !== null ? `${tx.amount.toLocaleString('fr-FR')} ${tx.currency}` : '-'}
                {tx.originalAmount && <div className="text-xs text-slate-400">({tx.originalAmount.toLocaleString('fr-FR')} {tx.originalCurrency})</div>}
              </TableCell>
              <TableCell className="text-right font-mono text-slate-300">
                {Number(tx.balance).toLocaleString('fr-FR')} {creditCurrency}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariantMap[tx.status] || 'default'}>{tx.status}</Badge>
              </TableCell>
              <TableCell>{tx.verifiedBy || '-'}</TableCell>
            </TableRow>
          ))}
          {loading && (
            <TableRow className="border-slate-700">
              <TableCell colSpan={8} className="text-center text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Chargement…</TableCell>
            </TableRow>
          )}
          {!loading && transactions.length === 0 && (
            <TableRow className="border-slate-700">
              <TableCell colSpan={8} className="text-center text-slate-400 py-4">Aucun mouvement pour ce crédit.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default TransactionSubTable;
