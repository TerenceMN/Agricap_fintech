import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ArrowRightLeft, TrendingUp, Clock, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';

const FLOW_STATUS_LABEL = { EN_ATTENTE: 'En attente', APPROUVE: 'Approuvé', REJETE: 'Rejeté' };
const FLOW_STATUS_COLOR = {
  'En attente': 'bg-yellow-500/20 text-yellow-400',
  'Approuvé': 'bg-emerald-500/20 text-emerald-400',
  'Rejeté': 'bg-red-500/20 text-red-400',
};

const SimulationDialog = ({ open, onOpenChange, position, onConfirm, busy }) => {
  if (!position) return null;

  const coupons = Math.floor(position.investedAmount / position.couponAmount);
  const conversionValue = coupons * position.couponAmount;
  const shares = Math.floor(conversionValue / 100);

  const maturity = new Date(position.dateCreated);
  maturity.setMonth(maturity.getMonth() + position.termMonths);
  const monthsRemaining = Math.max(0, Math.round((maturity - new Date()) / (1000 * 60 * 60 * 24 * 30)));
  const estimatedRemainingInterest = position.investedAmount * (position.rate / 100) * (monthsRemaining / 12);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white max-w-3xl border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold gradient-text flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6"/> Simulation de Conversion
          </DialogTitle>
          <DialogDescription className="text-gray-400">{position.name} (OBL-{position.id})</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
          <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
            <h3 className="font-bold text-purple-400 flex items-center gap-2 mb-3">
              <ArrowRightLeft className="w-4 h-4"/> Conversion en Actions
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex justify-between"><span>Coupons convertis:</span> <span className="text-white font-mono">{coupons}</span></li>
              <li className="flex justify-between"><span>Valeur de conversion:</span> <span className="text-white font-mono">{conversionValue.toLocaleString()} $</span></li>
              <li className="flex justify-between"><span>Prix par action:</span> <span className="text-white font-mono">100 $</span></li>
              <li className="border-t border-purple-500/20 pt-2 flex justify-between font-bold text-lg text-purple-100">
                <span>Actions obtenues:</span> <span>{shares}</span>
              </li>
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5">
            <h3 className="font-bold text-blue-400 flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4"/> Conservation jusqu'à Maturité
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex justify-between"><span>Capital garanti:</span> <span className="text-white font-mono">{position.investedAmount.toLocaleString()} $</span></li>
              <li className="flex justify-between"><span>Intérêts restants (est., {monthsRemaining} mois):</span> <span className="text-white font-mono">{Math.round(estimatedRemainingInterest).toLocaleString()} $</span></li>
              <li className="flex justify-between text-gray-500"><span>Risque Capital:</span> <span>Faible</span></li>
              <li className="border-t border-blue-500/20 pt-2 flex justify-between font-bold text-lg text-blue-100">
                <span>Total estimé à terme:</span> <span>{Math.round(position.investedAmount + estimatedRemainingInterest).toLocaleString()} $</span>
              </li>
            </ul>
          </div>
        </div>

        <Alert className="bg-slate-800 border-l-4 border-l-yellow-500 border-y-0 border-r-0 text-gray-300">
          <TrendingUp className="h-4 w-4 text-yellow-500" />
          <AlertTitle className="text-yellow-400">Aucune valorisation de marché</AlertTitle>
          <AlertDescription className="text-xs">
            Les actions AGRICAP ne sont pas cotées sur un marché secondaire — leur valeur ci-dessus est fixée à 100 $/action par les conditions AGRICAP, pas une estimation de marché.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <div className="flex justify-between text-sm mb-1">
            <span>Souscription</span>
            <span>Maturité</span>
          </div>
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden relative">
            <div className="absolute left-0 top-0 h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, 100 - (monthsRemaining / position.termMonths) * 100))}%` }}></div>
          </div>
          <p className="text-center text-xs text-emerald-400 mt-1">
            <CheckCircle2 className="w-3 h-3 inline mr-1"/> {monthsRemaining} mois restants avant maturité
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fermer</Button>
          <Button disabled={busy || coupons === 0} onClick={onConfirm} className="bg-purple-600 hover:bg-purple-700">
            Procéder à la conversion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Conversions = () => {
  const { toast } = useToast();
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadData = async () => {
    try {
      const list = await api.investments.obligations.list();
      setPositions(list.filter((p) => p.status === 'ACTIF'));
      const conversions = await Promise.all(
        list.map((p) => api.investments.obligations.conversions(p.id).then((c) => c.map((x) => ({ ...x, positionName: p.name }))).catch(() => [])),
      );
      setHistory(conversions.flat());
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleConfirm = async () => {
    const coupons = Math.floor(selectedPosition.investedAmount / selectedPosition.couponAmount);
    setBusy(true);
    try {
      await api.investments.obligations.convert(selectedPosition.id, coupons);
      toast({ title: 'Conversion initiée', description: 'La validation peut prendre jusqu\'à 48h.' });
      setSelectedPosition(null);
      loadData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Conversion impossible.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <Helmet><title>Conversions - AGRICAP</title></Helmet>
      <div className="mb-8">
        <h1 className="text-3xl font-bold gradient-text">Conversion de Titres</h1>
        <p className="text-gray-400">Convertissez vos obligations en actions AGRICAP (100 $/action).</p>
      </div>

      <div className="space-y-4 mb-10">
        {positions.length === 0 && (
          <Card className="glass-effect">
            <CardContent className="p-8 text-center text-gray-400">
              Aucune position obligataire active éligible à la conversion.
            </CardContent>
          </Card>
        )}
        {positions.map(position => {
          const coupons = Math.floor(position.investedAmount / position.couponAmount);
          return (
            <Card key={position.id} className="glass-effect">
              <CardContent className="flex flex-col md:flex-row items-center justify-between p-6 gap-4">
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-white mb-1">{position.name}</h3>
                  <div className="flex gap-4 text-sm text-gray-400">
                    <span>{coupons} coupons</span>
                    <span>•</span>
                    <span className="text-white font-mono">{position.investedAmount.toLocaleString()} $</span>
                  </div>
                </div>

                <div className="flex flex-col md:items-end text-sm text-gray-400 gap-1">
                  <p>Taux: <span className="text-white">{position.rate}% / an</span></p>
                  <p>Échéance: {position.termMonths} mois</p>
                </div>

                <div className="w-full md:w-auto">
                  <Button onClick={() => setSelectedPosition(position)} className="w-full bg-purple-600 hover:bg-purple-700">
                    <ArrowRightLeft className="w-4 h-4 mr-2" /> Simuler Conversion
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-white">Historique des Conversions</CardTitle>
          <CardDescription>Vos conversions déjà demandées, tous portefeuilles confondus.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-white/10"><TableHead>Date</TableHead><TableHead>Portefeuille</TableHead><TableHead>Coupons</TableHead><TableHead>Actions</TableHead><TableHead>Statut</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-500">Aucune conversion demandée.</TableCell></TableRow>
              )}
              {history.map((h) => (
                <TableRow key={h.id} className="border-white/10">
                  <TableCell>{new Date(h.date).toLocaleDateString()}</TableCell>
                  <TableCell className="text-slate-300">{h.positionName}</TableCell>
                  <TableCell>{h.coupons}</TableCell>
                  <TableCell>{h.shares}</TableCell>
                  <TableCell><Badge className={FLOW_STATUS_COLOR[FLOW_STATUS_LABEL[h.status]]}>{FLOW_STATUS_LABEL[h.status] || h.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SimulationDialog
        open={!!selectedPosition}
        onOpenChange={(open) => !open && setSelectedPosition(null)}
        position={selectedPosition}
        onConfirm={handleConfirm}
        busy={busy}
      />
    </Layout>
  );
};

export default Conversions;
