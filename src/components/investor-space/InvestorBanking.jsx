import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRightLeft, Plus, History } from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import { describeHistoryCoverage, movementTypeLabel } from '@/lib/investorSpaceWire';
import WalletDepositDialog from '@/components/treasury/WalletDepositDialog';

/**
 * Trésorerie de l'investisseur et historique RÉEL de ses mouvements.
 *
 * Repris de l'écran `Investments` supprimé (soldes, dépôt, mouvements) ; ce qui
 * change, c'est l'historique. Le prototype traçait une courbe de performance sur
 * douze mois générée en `Math.random()` — douze points existaient parce que le
 * graphique en voulait douze. Ici, on liste les mouvements servis, et la
 * profondeur réellement couverte est annoncée : quand elle est inférieure à
 * douze mois, l'écran le dit au lieu de laisser croire à une tendance.
 *
 * Aucun cumul, aucune moyenne : les montants affichés sont ceux du serveur,
 * ligne par ligne.
 *
 * LE DÉPÔT N'EST PLUS ÉCRIT ICI. Cet écran en portait une copie appauvrie du
 * formulaire de « Ma Trésorerie » : montant seul, aucune étape de confirmation,
 * et surtout la devise passée en dur (`'USD'`) à `wallets.deposit`. Un
 * investisseur qui déposait des francs voyait donc son versement enregistré en
 * dollars — un écart de montant, pas un détail d'affichage. Le formulaire
 * partagé rend ce défaut impossible : la devise y est saisie puis reconfirmée.
 */
const InvestorBanking = ({ movements, onRefresh }) => {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState([]);
  const [walletMovements, setWalletMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDepositOpen, setDepositOpen] = useState(false);

  const loadWallets = async () => {
    setLoading(true);
    setError(null);
    try {
      const [walletsRes, walletMovementsRes] = await Promise.all([
        api.caisses.wallets.mine(),
        api.caisses.wallets.movements(),
      ]);
      setWallets(walletsRes);
      setWalletMovements(walletMovementsRes.slice(0, 20));
    } catch (err) {
      setError(err.message || 'Chargement de votre trésorerie impossible.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWallets(); }, []);

  const usdWallet = wallets.find((w) => w.currency === 'USD');
  const cdfWallet = wallets.find((w) => w.currency === 'CDF');
  const coverage = describeHistoryCoverage(movements);

  const handleDepositCompleted = async () => {
    await loadWallets();
    if (onRefresh) onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <p className="text-xs text-slate-400 mb-1">Solde USD</p>
                <p className="text-2xl font-bold text-white">
                  {loading ? '…' : formatCurrency(usdWallet?.balance ?? 0)}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <p className="text-xs text-slate-400 mb-1">Solde CDF</p>
                <p className="text-2xl font-bold text-white">
                  {loading ? '…' : `${(cdfWallet?.balance ?? 0).toLocaleString('fr-FR')} FC`}
                </p>
              </CardContent>
            </Card>
          </div>

          {error && (
            <Card className="bg-red-500/10 border-red-500/30">
              <CardContent className="p-4 text-sm text-red-300">{error}</CardContent>
            </Card>
          )}

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <History className="w-5 h-5 text-blue-400" />
                Historique de vos mouvements d’investissement
              </CardTitle>
              <CardDescription>{coverage.note}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-300">Date</TableHead>
                      <TableHead className="text-slate-300">Type</TableHead>
                      <TableHead className="text-right text-slate-300">Montant</TableHead>
                      <TableHead className="text-right text-slate-300">Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-slate-500">
                          Aucun mouvement enregistré.
                        </TableCell>
                      </TableRow>
                    )}
                    {movements.map((m) => (
                      <TableRow key={m.id} className="border-slate-800">
                        <TableCell className="text-slate-300">{formatDate(m.dateTime)}</TableCell>
                        <TableCell className="text-white">{movementTypeLabel(m.type)}</TableCell>
                        <TableCell className="text-right font-mono text-white">
                          {formatCurrency(m.amount, m.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="border-slate-600 text-slate-300">
                            {m.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white text-base">Mouvements de portefeuille (wallet)</CardTitle>
              <CardDescription>Dépôts, retraits et conversions de votre trésorerie AGRICAP.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-300">Date</TableHead>
                      <TableHead className="text-slate-300">Nature</TableHead>
                      <TableHead className="text-right text-slate-300">Montant</TableHead>
                      <TableHead className="text-right text-slate-300">Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!loading && walletMovements.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-slate-500">
                          Aucun mouvement de trésorerie.
                        </TableCell>
                      </TableRow>
                    )}
                    {walletMovements.map((m) => (
                      <TableRow key={m.id} className="border-slate-800">
                        <TableCell className="text-slate-300">{formatDate(m.createdAt || m.date)}</TableCell>
                        <TableCell className="text-white">{m.kind || m.type}</TableCell>
                        <TableCell className="text-right font-mono text-white">
                          {formatCurrency(m.amount, m.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="border-slate-600 text-slate-300">{m.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white">Actions</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => setDepositOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Faire un dépôt
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-700"
                onClick={() => navigate('/conversions')}
              >
                <ArrowRightLeft className="w-4 h-4 mr-2" /> Conversions obligataires
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <WalletDepositDialog
        open={isDepositOpen}
        onOpenChange={setDepositOpen}
        onCompleted={handleDepositCompleted}
      />
    </div>
  );
};

export default InvestorBanking;
