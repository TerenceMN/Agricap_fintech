import React, { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import StatCard from '@/components/StatCard';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  TrendingUp, DollarSign, Calendar, FileText, Download, AlertCircle,
  ArrowRightLeft, Clock, Activity, CheckCircle, Wallet, Calculator, AlertTriangle, Info,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatPercent } from '@/lib/investorSpaceWire';
import {
  MATURITY_VALUE_GAP, WITHDRAWAL_NET_GAP, BOND_SAVINGS_PLAN_GAP,
  bondFlowStatusLabel, buildBondOfferTerms, buildObligationRows, buildWithdrawalRows,
  subscriptionAmount, totalBondsActive, totalInvestedActive,
} from '@/lib/obligationsWire';

/*
 * Cette page portait quatre constantes en tête de fichier, sous le commentaire
 * « Termes réels du produit (défauts backend) » :
 *
 *     COUPON_VALUE = 250 · ANNUAL_RATE = 0.09 · MATURITY_MONTHS = 24
 *     WITHDRAWAL_PENALTY_RATE = 0.02
 *
 * Elles étaient exactes le jour où elles ont été écrites : c'étaient les
 * `default=` du modèle `ObligationPosition`. Le backend les a supprimés depuis
 * — « Les termes ne s'inventent pas […] toute position créée sans les préciser
 * héritait de termes que personne n'avait décidés » (investments/models.py) —
 * et les termes viennent désormais de l'`Offer` souscrite.
 *
 * L'écran, lui, continuait d'annoncer « Rendement 9 %/an » et « Taux Annuel 9 % »
 * dans le même tableau que le `p.rate` réellement servi : deux taux
 * contradictoires côte à côte. Il projetait aussi une « Valeur Maturité Est. »
 * en `montant × 1,09 ^ années` — capitalisation COMPOSÉE sur un produit dont le
 * coupon est en intérêt SIMPLE — et un « Net à Recevoir » calculé sur une
 * pénalité de 2 % en dur, alors que `BondWithdrawal.penalty_rate` est un champ
 * PAR LIGNE que rien ne publie avant la demande.
 *
 * Toute la lecture des termes vit désormais dans `lib/obligationsWire.ts`, avec
 * ses tests. Ce fichier n'affiche plus que ce que le serveur sert, et NOMME ce
 * qu'il ne sert pas (`MATURITY_VALUE_GAP`, `WITHDRAWAL_NET_GAP`,
 * `BOND_SAVINGS_PLAN_GAP`).
 */

const STATUS_COLORS = {
  ACTIF: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  MATURE: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  EN_ATTENTE: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};
const FLOW_STATUS_COLORS = {
  EN_ATTENTE: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  APPROUVE: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  PAYE: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  REJETE: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const usd = (n) => `${Number(n ?? 0).toLocaleString('fr-FR')} $`;

/** Panneau d'un manque SERVEUR — même forme que `PortfolioTools` : ce qui
 *  existe, ce qui manque, comment ce serait alimenté, quel contrat le comblerait. */
const DataGapPanel = ({ gap }) => (
  <Card className="bg-slate-900 border-slate-800">
    <CardHeader>
      <CardTitle className="text-white text-base flex items-start gap-2">
        <Info className="w-4 h-4 mt-1 shrink-0 text-blue-400" />
        {gap.title}
      </CardTitle>
      <CardDescription className="italic">« {gap.question} »</CardDescription>
    </CardHeader>
    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
      <div>
        <p className="text-emerald-400 font-semibold mb-2">Ce que le serveur sert</p>
        <ul className="space-y-1.5 text-slate-400 list-disc pl-4">
          {gap.whatExists.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-amber-400 font-semibold mb-2">Ce qui manque</p>
        <ul className="space-y-1.5 text-slate-400 list-disc pl-4">
          {gap.whatIsMissing.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-slate-300 font-semibold mb-2">Par quel moyen ce serait alimenté</p>
        <ul className="space-y-1.5 text-slate-500 list-disc pl-4">
          {gap.howItWouldBeFed.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-slate-300 font-semibold mb-2">Contrat serveur à créer</p>
        <ul className="space-y-1.5 text-slate-500 list-disc pl-4 font-mono text-xs">
          {gap.serverContract.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
    </CardContent>
  </Card>
);

const Obligations = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');

  const [positions, setPositions] = useState([]);
  const [offers, setOffers] = useState([]);
  const [flows, setFlows] = useState([]); // retraits + conversions, toutes positions
  const [loading, setLoading] = useState(true);
  const [offersError, setOffersError] = useState(null);

  const [isWithdrawOpen, setWithdrawOpen] = useState(false);
  const [isConvertOpen, setConvertOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);

  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [subscribeQty, setSubscribeQty] = useState(1);
  const [subscribeBusy, setSubscribeBusy] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [withdrawReason, setWithdrawReason] = useState('Urgence médicale');

  const rows = useMemo(() => buildObligationRows(positions), [positions]);
  const terms = useMemo(() => buildBondOfferTerms(offers), [offers]);
  const selectedTerms = useMemo(
    () => terms.find((t) => String(t.offerId) === String(selectedOfferId)) || null,
    [terms, selectedOfferId],
  );

  const totalInvested = totalInvestedActive(rows);
  const totalBonds = totalBondsActive(rows);
  const activeCount = rows.filter((r) => r.status === 'ACTIF').length;

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await api.investments.obligations.list();
      setPositions(list);
      const histories = await Promise.all(list.map(async (p) => {
        const [withdrawals, conversions] = await Promise.all([
          api.investments.obligations.withdrawals(p.id).catch(() => []),
          api.investments.obligations.conversions(p.id).catch(() => []),
        ]);
        return [
          ...buildWithdrawalRows(withdrawals).map((w) => ({ ...w, kind: 'withdrawal', positionName: p.name })),
          ...conversions.map((c) => ({
            ...c, kind: 'conversion', positionName: p.name,
            statusLabel: bondFlowStatusLabel(c.status),
          })),
        ];
      }));
      setFlows(histories.flat());
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Les TERMES du produit — offres réellement ouvertes. Sans elles, l'écran ne
  // replie pas sur une brochure : il dit qu'il n'y a rien à souscrire.
  const loadOffers = async () => {
    try {
      setOffersError(null);
      setOffers(await api.investments.offers.open());
    } catch (err) {
      setOffers([]);
      setOffersError(err.message || 'Offres ouvertes indisponibles.');
    }
  };

  useEffect(() => { loadData(); loadOffers(); }, []);

  useEffect(() => {
    if (!selectedOfferId && terms.length > 0) setSelectedOfferId(String(terms[0].offerId));
  }, [terms, selectedOfferId]);

  const handleSubscribe = async () => {
    if (!selectedTerms) return;
    setSubscribeBusy(true);
    try {
      // Contrat réel de `POST /investments/obligations` : l'offre porte les
      // termes, la quantité porte le prix, la clé rend l'appel rejouable.
      // L'ancien corps (`{name, investedAmount}`) laissait le montant au client —
      // c'est précisément ce que `obligations.souscrire` a fermé.
      await api.investments.obligations.subscribe({
        offerId: selectedTerms.offerId,
        bonds: Number(subscribeQty),
        idempotencyKey: crypto.randomUUID(),
        name: `${selectedTerms.title} — ${new Date().toLocaleDateString('fr-FR')}`,
      });
      toast({ title: 'Souscription encaissée', description: 'Votre portefeuille a été débité et la position créée.' });
      loadData();
      loadOffers();
      setActiveTab('portfolios');
    } catch (err) {
      toast({ title: 'Souscription refusée', description: err.message || 'Souscription impossible.', variant: 'destructive' });
    } finally {
      setSubscribeBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawAmount > selectedPosition.investedAmount) {
      toast({ title: 'Erreur', description: 'Montant supérieur au capital investi.', variant: 'destructive' });
      return;
    }
    try {
      await api.investments.obligations.withdraw(selectedPosition.id, { amount: withdrawAmount, reason: withdrawReason });
      toast({ title: 'Demande envoyée', description: 'Votre demande de retrait est en cours d\'examen.' });
      setWithdrawOpen(false);
      loadData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Demande impossible.', variant: 'destructive' });
    }
  };

  const handleConvert = async () => {
    try {
      await api.investments.obligations.convert(selectedPosition.id, selectedPosition.bonds);
      toast({ title: 'Conversion initiée', description: 'La validation peut prendre jusqu\'à 48h.' });
      setConvertOpen(false);
      loadData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Conversion impossible.', variant: 'destructive' });
    }
  };

  const DashboardOverview = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="bg-slate-900 border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
        <CardContent className="p-8 relative z-10">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="flex-1 space-y-4">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Obligation agricole</Badge>
              <h2 className="text-3xl font-bold text-white">Obligations & Coupons</h2>
              <p className="text-slate-400 leading-relaxed">
                En souscrivant un titre obligataire, vous financez directement un projet agricole.
                {' '}
                <span className="text-slate-300">
                  Les conditions — valeur d'un titre, coupon, maturité — appartiennent à l'offre
                  souscrite et sont figées avec votre position : elles ne sont pas les mêmes d'une
                  offre à l'autre, et cette page n'en annonce aucune qui ne vienne du serveur.
                </span>
              </p>

              {/* Termes du produit : ceux des offres OUVERTES, offre par offre.
                  Il n'existe plus de « Rendement : 9 %/an » de brochure. */}
              {terms.length > 0 ? (
                <div className="space-y-2 pt-2">
                  {terms.map((t) => (
                    <div key={t.offerId} className="flex flex-wrap items-center gap-3 bg-slate-800/50 px-3 py-2 rounded-lg border border-slate-700">
                      <span className="font-mono text-xs text-slate-400">{t.offerCode}</span>
                      <span className="text-sm font-medium text-white">{t.title}</span>
                      <span className="flex items-center gap-1.5 text-sm text-slate-300">
                        <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> {usd(t.bondUnitValue)} / titre
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-slate-300">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        coupon {formatPercent(t.couponRatePercent)} / an
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-slate-300">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" /> {t.maturityMonths} mois
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Alert className="bg-slate-800/50 border-slate-700 text-slate-300">
                  <AlertCircle className="w-4 h-4" />
                  <AlertTitle>Aucune offre obligataire ouverte</AlertTitle>
                  <AlertDescription className="text-sm">
                    {offersError
                      ? `Les offres ouvertes n'ont pas pu être chargées (${offersError}).`
                      : 'Il n\'y a pas d\'offre à souscrire en ce moment.'}
                    {' '}Aucun taux ni aucune valeur de titre n'est affiché à la place : les
                    conditions viennent d'une offre, et sans offre il n'y a pas de conditions.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <div className="flex flex-col gap-3 min-w-[200px]">
              <Button
                size="lg" className="bg-emerald-600 hover:bg-emerald-700 w-full"
                disabled={terms.length === 0} onClick={() => setActiveTab('subscribe')}
              >
                Souscrire
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Capital placé (positions actives)" value={usd(totalInvested)} icon={Wallet} trend="up" gradient="from-emerald-600 to-teal-600" />
        <StatCard title="Titres détenus" value={totalBonds} change="Positions actives" icon={FileText} trend="neutral" gradient="from-violet-600 to-purple-600" />
        <StatCard title="Positions actives" value={activeCount} change={`sur ${rows.length}`} icon={Activity} trend="neutral" gradient="from-blue-600 to-cyan-600" />
        <StatCard title="Offres ouvertes" value={terms.length} change="Souscriptibles" icon={DollarSign} trend="neutral" gradient="from-amber-500 to-orange-600" />
      </div>

      {/* Là où s'affichait « Valeur Maturité Est. » — un chiffre composé au
          navigateur sur un taux de brochure, présenté comme une estimation. */}
      <DataGapPanel gap={MATURITY_VALUE_GAP} />
    </div>
  );

  const PortfoliosTable = () => (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white">Mes positions</CardTitle>
          <CardDescription>
            Termes figés à la souscription. Aucune valeur à maturité n'est projetée ici.
          </CardDescription>
        </div>
        <Button onClick={() => setActiveTab('subscribe')} disabled={terms.length === 0} className="bg-emerald-600">
          <DollarSign className="w-4 h-4 mr-2" /> Nouveau
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-slate-800/50">
              <TableHead>ID</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Offre</TableHead>
              <TableHead>Titres</TableHead>
              <TableHead>Capital placé</TableHead>
              <TableHead>Coupon (servi)</TableHead>
              <TableHead>Maturité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-500">Aucune position.</TableCell></TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id} className="border-slate-800 hover:bg-slate-800/30">
                <TableCell className="font-mono text-xs text-slate-400">OBL-{p.id}</TableCell>
                <TableCell className="font-medium text-white">{p.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {p.offerCode
                    ? <span className="text-slate-400">{p.offerCode}</span>
                    : <span className="text-amber-400" title={p.termsSource || ''}>termes sans offre</span>}
                </TableCell>
                <TableCell>{p.bonds}</TableCell>
                <TableCell className="text-emerald-400 font-mono">{usd(p.investedAmount)}</TableCell>
                <TableCell className="text-white font-bold">{formatPercent(p.ratePercent)} / an</TableCell>
                <TableCell className="text-slate-300">{p.termMonths} mois</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_COLORS[p.status]}>{p.statusLabel}</Badge>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  {p.status === 'ACTIF' && (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Retrait anticipé" onClick={() => { setSelectedPosition(p); setWithdrawAmount(0); setWithdrawOpen(true); }}><AlertCircle className="w-4 h-4 text-amber-400" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Conversion en actions" onClick={() => { setSelectedPosition(p); setConvertOpen(true); }}><ArrowRightLeft className="w-4 h-4 text-purple-400" /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.some((r) => r.termsOrphaned) && (
          <p className="text-xs text-amber-400/80 mt-4 leading-relaxed">
            Certaines positions ne sont rattachées à aucune offre : leurs termes sont
            antérieurs au rattachement obligatoire et n'ont donc pas d'auteur identifiable.
            Ils sont affichés tels quels, sans être complétés.
          </p>
        )}
      </CardContent>
    </Card>
  );

  const SubscribeSection = () => {
    const montant = subscriptionAmount(selectedTerms, Number(subscribeQty));
    const horsBornes = selectedTerms && (
      Number(subscribeQty) < selectedTerms.minBonds || Number(subscribeQty) > selectedTerms.maxBonds
    );

    if (!selectedTerms) {
      return (
        <Alert className="bg-slate-800/50 border-slate-700 text-slate-300 max-w-3xl mx-auto">
          <AlertCircle className="w-4 h-4" />
          <AlertTitle>Aucune offre obligataire ouverte</AlertTitle>
          <AlertDescription className="text-sm">
            Il n'y a rien à souscrire pour le moment. Le serveur refuse toute création de
            position sans offre applicable (<code>OBLIGATION_OFFER_REQUIRED</code>) : cet
            écran ne propose donc pas de formulaire plutôt que d'en proposer un qui échouerait.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Configurer la souscription</CardTitle>
            <CardDescription>Tous les termes ci-dessous viennent de l'offre choisie.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="mb-2 block">Offre</Label>
              <Select value={String(selectedOfferId)} onValueChange={setSelectedOfferId}>
                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {terms.map((t) => (
                    <SelectItem key={t.offerId} value={String(t.offerId)}>
                      {t.offerCode} — {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <p className="text-xs text-slate-400">Valeur d'un titre</p>
                <p className="text-lg font-bold text-white">{usd(selectedTerms.bondUnitValue)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <p className="text-xs text-slate-400">Coupon promis</p>
                <p className="text-lg font-bold text-emerald-400">{formatPercent(selectedTerms.couponRatePercent)} / an</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <p className="text-xs text-slate-400">Maturité</p>
                <p className="text-lg font-bold text-white">{selectedTerms.maturityMonths} mois</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-slate-700">
                <p className="text-xs text-slate-400">Titres disponibles</p>
                <p className="text-lg font-bold text-white">{selectedTerms.availableBonds}</p>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">
                Nombre de titres (de {selectedTerms.minBonds} à {selectedTerms.maxBonds})
              </Label>
              <div className="flex items-center gap-4">
                <Button variant="outline" onClick={() => setSubscribeQty(Math.max(selectedTerms.minBonds, Number(subscribeQty) - 1))} className="border-slate-700">-</Button>
                <Input type="number" value={subscribeQty} onChange={(e) => setSubscribeQty(Number(e.target.value))} className="bg-slate-800 border-slate-700 text-center font-bold text-lg" />
                <Button variant="outline" onClick={() => setSubscribeQty(Number(subscribeQty) + 1)} className="border-slate-700">+</Button>
              </div>
              {horsBornes && (
                <p className="text-xs text-amber-400 mt-2">
                  Hors des bornes servies par l'offre. Le serveur re-vérifie de toute façon :
                  cette borne est un confort de saisie, pas le contrôle.
                </p>
              )}
            </div>

            <div className="space-y-2 pt-4 border-t border-slate-800">
              <div className="flex justify-between text-xl">
                <span className="text-white font-bold">Montant débité</span>
                <span className="text-emerald-400 font-bold">{montant === null ? '—' : usd(montant)}</span>
              </div>
              <p className="text-xs text-slate-500">
                {subscribeQty} titre(s) × {usd(selectedTerms.bondUnitValue)}. C'est la règle de prix que
                le serveur applique (<code>obligations.souscrire</code>) ; le montant définitif est
                le sien.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Confirmation</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-300">
              <AlertCircle className="w-4 h-4" />
              <AlertTitle>Débit réel du portefeuille</AlertTitle>
              <AlertDescription className="text-sm">
                La souscription débite votre portefeuille USD, encaisse la souscription et crée la
                position — le tout ou rien, dans une seule transaction. Un solde insuffisant la
                refuse sans rien créer.
              </AlertDescription>
            </Alert>

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg"
              disabled={subscribeBusy || horsBornes || montant === null}
              onClick={handleSubscribe}
            >
              {subscribeBusy ? 'Envoi…' : 'Confirmer la souscription'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  const FlowsView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Historique retraits & conversions</CardTitle>
          <CardDescription>
            La pénalité affichée est celle que le serveur a RETENUE sur chaque retrait,
            ligne par ligne.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800">
                <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Position</TableHead>
                <TableHead>Montant</TableHead><TableHead>Pénalité retenue</TableHead><TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Aucun flux enregistré.</TableCell></TableRow>
              )}
              {flows.map((f) => (
                <TableRow key={`${f.kind}-${f.id}`} className="border-slate-800">
                  <TableCell>{new Date(f.date).toLocaleDateString('fr-FR')}</TableCell>
                  <TableCell>{f.kind === 'withdrawal' ? `Retrait (${f.reason || '-'})` : 'Conversion en actions'}</TableCell>
                  <TableCell className="text-slate-300">{f.positionName}</TableCell>
                  <TableCell className={f.kind === 'withdrawal' ? 'text-red-400' : 'text-purple-400'}>
                    {f.kind === 'withdrawal' ? `-${usd(f.amount)}` : `${f.shares} actions`}
                  </TableCell>
                  <TableCell className="font-mono text-slate-300">
                    {f.kind === 'withdrawal' ? formatPercent(f.penaltyPercent) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={FLOW_STATUS_COLORS[f.status]}>{f.statusLabel}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Échéances de maturité</CardTitle>
            <CardDescription>Date d'échéance = souscription + maturité servie.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rows.filter((p) => p.status === 'ACTIF').length === 0 && (
              <p className="text-sm text-slate-500">Aucune position active.</p>
            )}
            {rows.filter((p) => p.status === 'ACTIF').map((p) => {
              const maturity = new Date(p.dateCreated);
              maturity.setMonth(maturity.getMonth() + p.termMonths);
              return (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded bg-slate-800 border border-slate-700">
                  <Calendar className="text-blue-400" />
                  <div>
                    <p className="text-white font-bold">{maturity.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</p>
                    <p className="text-xs text-slate-400">{p.name}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <Layout>
      <Helmet><title>Obligations - AGRICAP Investor</title></Helmet>

      <Dialog open={isWithdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retrait anticipé</DialogTitle>
            <DialogDescription>Un retrait avant maturité entraîne une pénalité sur le capital retiré.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Ce bloc affichait « Pénalité : 2 % » puis un « Net à Recevoir » en
                gras et en vert, calculés AVANT tout appel serveur, sur une
                constante. `BondWithdrawal.penalty_rate` est un champ par ligne :
                2 % en est le défaut, pas la règle. Le montant net promis n'était
                donc confirmé par personne, sur l'écran même de la confirmation. */}
            <Alert className="bg-amber-500/10 border-amber-500/20 text-amber-200">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle className="text-sm">La pénalité applicable n'est pas connue avant l'envoi</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                Le taux de pénalité est fixé par le serveur au moment où la demande est
                enregistrée, et il est propre à chaque retrait. Aucun montant net n'est
                affiché ici : il serait une promesse que rien ne garantit. Le taux retenu et
                le montant apparaissent sur la ligne du retrait, dans « Flux & Retours »,
                dès que la demande est enregistrée.
              </AlertDescription>
            </Alert>

            <div>
              <Label>Montant du retrait (max : {usd(selectedPosition?.investedAmount)})</Label>
              <Input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(Number(e.target.value))} className="bg-slate-800 border-slate-700 mt-2" />
            </div>

            <div>
              <Label>Motif</Label>
              <Select value={withdrawReason} onValueChange={setWithdrawReason}>
                <SelectTrigger className="bg-slate-800 border-slate-700 mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Urgence médicale">Urgence médicale</SelectItem>
                  <SelectItem value="Urgence familiale">Urgence familiale</SelectItem>
                  <SelectItem value="Autre opportunité">Autre opportunité</SelectItem>
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-between text-sm pt-2 border-t border-slate-800">
              <span className="text-slate-400">Montant brut demandé</span>
              <span className="font-mono">{usd(withdrawAmount)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)}>Annuler</Button>
            <Button onClick={handleWithdraw} className="bg-amber-600 hover:bg-amber-700">Envoyer la demande</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isConvertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Conversion en actions</DialogTitle>
            <DialogDescription>La conversion est soumise à validation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <div>
                <p className="text-sm text-purple-300">Éligibilité</p>
                <p className="font-bold text-white">{selectedPosition?.status === 'ACTIF' ? 'Position active' : 'Non éligible'}</p>
              </div>
              <CheckCircle className="text-purple-400 w-8 h-8" />
            </div>

            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 bg-slate-800 rounded border border-slate-700">
                <p className="text-xs text-slate-400">Titres convertis</p>
                <p className="text-lg font-bold text-white">{selectedPosition?.bonds ?? 0}</p>
              </div>
              <div className="p-3 bg-slate-800 rounded border border-slate-700">
                <p className="text-xs text-slate-400">Capital concerné</p>
                <p className="text-lg font-bold text-white">{usd(selectedPosition?.investedAmount)}</p>
              </div>
            </div>

            {/* Le nombre d'actions obtenues valait ici `capital / 100`, avec un
                « Prix Action : 100 $ » en dur — un prix qu'aucune offre ne porte.
                Le serveur seul décide du ratio : il renvoie `shares`, on l'affiche
                ensuite dans l'historique plutôt que de l'annoncer avant. */}
            <p className="text-xs text-slate-400 leading-relaxed">
              Le nombre d'actions obtenues est déterminé par le serveur à la validation ; il
              n'est pas annoncé ici. Aucun prix d'action n'est publié par le module, et en
              afficher un reviendrait à promettre un ratio que personne n'a arrêté.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConvertOpen(false)}>Annuler</Button>
            <Button onClick={handleConvert} className="bg-purple-600 hover:bg-purple-700">Demander la conversion</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6 pb-20">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Obligations & Coupons</h1>
            <p className="text-slate-400">Titres obligataires adossés à des projets agricoles.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="border-slate-700" onClick={() => setActiveTab('documents')}><Download className="w-4 h-4 mr-2" /> Documents</Button>
            <Button onClick={() => setActiveTab('subscribe')} disabled={terms.length === 0} className="bg-emerald-600 hover:bg-emerald-700"><DollarSign className="w-4 h-4 mr-2" /> Souscrire</Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-900 border border-slate-800 p-1 w-full justify-start overflow-x-auto h-auto">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-800"><Activity className="w-4 h-4 mr-2" /> Vue d'ensemble</TabsTrigger>
            <TabsTrigger value="portfolios" className="data-[state=active]:bg-slate-800"><Wallet className="w-4 h-4 mr-2" /> Mes positions</TabsTrigger>
            <TabsTrigger value="create-plan" className="data-[state=active]:bg-slate-800"><Calculator className="w-4 h-4 mr-2" /> Plan récurrent</TabsTrigger>
            <TabsTrigger value="subscribe" className="data-[state=active]:bg-slate-800"><DollarSign className="w-4 h-4 mr-2" /> Souscrire</TabsTrigger>
            <TabsTrigger value="flows" className="data-[state=active]:bg-slate-800"><ArrowRightLeft className="w-4 h-4 mr-2" /> Flux & Retours</TabsTrigger>
            <TabsTrigger value="documents" className="data-[state=active]:bg-slate-800"><FileText className="w-4 h-4 mr-2" /> Documents</TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="overview"><DashboardOverview /></TabsContent>
            <TabsContent value="portfolios"><PortfoliosTable /></TabsContent>
            <TabsContent value="create-plan">
              {/* L'onglet projetait un tableau mois par mois en `cumul × 1,09 ^ (mois/12)`,
                  avec un « Taux Annuel » figé à 9 % dans un champ désactivé — et un bouton
                  « Activer ce Plan Épargne » qui ouvrait un toast « non disponible ».
                  La projection habillait en chiffres un produit qui n'existe pas. */}
              <div className="space-y-6">
                <DataGapPanel gap={BOND_SAVINGS_PLAN_GAP} />
                <p className="text-sm text-slate-400">
                  En attendant, la souscription d'un montant unique reste ouverte via
                  l'onglet « Souscrire ».
                </p>
              </div>
            </TabsContent>
            <TabsContent value="subscribe"><SubscribeSection /></TabsContent>
            <TabsContent value="flows">
              <div className="space-y-6">
                <FlowsView />
                <DataGapPanel gap={WITHDRAWAL_NET_GAP} />
              </div>
            </TabsContent>
            <TabsContent value="documents">
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader><CardTitle className="text-white">Centre de documentation</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-400">
                    Non disponible : la génération et le stockage de documents (contrats,
                    rapports d'impact, prospectus) ne sont pas implémentés côté serveur.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
};

export default Obligations;
