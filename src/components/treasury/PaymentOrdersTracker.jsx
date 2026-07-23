import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Send } from 'lucide-react';
import { api } from '@/services/api';
import { Loading, Empty, ErrorPanel, toFieldErrors } from '@/components/backoffice/States';
import { paymentStatusMeta, directionLabel } from '@/components/treasury/depositOutcome';

/**
 * Suivi des ordres de paiement du client — la contrepartie honnête d'un dépôt
 * devenu asynchrone.
 *
 * Depuis que le wallet est la seule porte vers l'extérieur, un dépôt ou un
 * retrait externe part vers le fournisseur Makuta et n'est réglé qu'à sa
 * confirmation. Cet écran liste ces ordres avec leur statut LISIBLE (le libellé
 * complet vient du serveur, jamais reconstruit ici) et réserve un bandeau à
 * l'état INDETERMINATE : « issue en cours de vérification — ne relancez pas ».
 *
 * LECTURE SEULE, volontairement. Aucun bouton ne « relance » un ordre : un ordre
 * indéterminé a peut-être abouti chez le fournisseur, et un rejeu à l'aveugle
 * paierait deux fois. « Actualiser » ne fait que RELIRE la liste — il ne renvoie
 * aucun ordre.
 */
const PaymentOrdersTracker = ({ refreshSignal = 0 }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    setErrors([]);
    return api.caisses.wallets.paymentOrders()
      .then((rows) => setOrders(Array.isArray(rows) ? rows : []))
      .catch((err) => setErrors(toFieldErrors(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshSignal]);

  const indeterminate = orders.filter((o) => o.status === 'INDETERMINATE');

  return (
    <Card className="glass-effect">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-white">
            <Send className="w-5 h-5 text-blue-400" /> Ordres de paiement
          </CardTitle>
          <CardDescription>
            Dépôts et retraits externes confiés au fournisseur. Un montant n’est crédité
            qu’une fois l’ordre confirmé.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="border-slate-700 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </Button>
      </CardHeader>
      <CardContent>
        {/* Bandeau INDETERMINATE : le serveur le dit, on l'affiche tel quel — et
            surtout on ne propose AUCUNE relance. */}
        {indeterminate.length > 0 && (
          <div
            className="mb-4 rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 text-sm text-orange-200"
            role="alert"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {indeterminate.length} ordre(s) à l’issue inconnue — en cours de vérification.
                </p>
                <p className="opacity-90 mt-1">
                  La liaison avec le fournisseur a été coupée après l’envoi. Ces ordres ont
                  peut-être abouti : ils sont en cours de vérification. Ne les relancez pas —
                  un nouvel envoi risquerait de payer deux fois.
                </p>
              </div>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mb-4">
            <ErrorPanel errors={errors} title="Chargement des ordres impossible" />
          </div>
        )}

        {loading && orders.length === 0 && <Loading label="Chargement de vos ordres de paiement…" />}

        {!loading && errors.length === 0 && orders.length === 0 && (
          <Empty
            title="Aucun ordre de paiement"
            hint="Vos dépôts et retraits externes apparaîtront ici avec leur statut."
          />
        )}

        {orders.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead>Référence</TableHead>
                  <TableHead>Sens</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Détail</TableHead>
                  <TableHead>Créé le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const meta = paymentStatusMeta(o.status);
                  return (
                    <TableRow key={o.reference} className="border-slate-800 align-top">
                      <TableCell className="font-mono text-xs text-gray-400">{o.reference}</TableCell>
                      <TableCell className="text-white">{directionLabel(o.direction)}</TableCell>
                      {/* Montant servi en CHAÎNE (Decimal) : affiché tel quel, jamais
                          reconverti en float. */}
                      <TableCell className="font-bold text-white whitespace-nowrap">
                        {o.amount} {o.currency}
                      </TableCell>
                      <TableCell>
                        <Badge className={meta.badgeClass}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400 max-w-xs">
                        {o.detail}
                        {o.failureDetail && (
                          <span className="block text-red-300/80 mt-1">{o.failureDetail}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                        {o.createdAt ? new Date(o.createdAt).toLocaleString('fr-FR') : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentOrdersTracker;
