import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table';
import { DollarSign, Calendar, Percent, User, Briefcase, FileText, Shield, Star, Hash, Clock, Landmark, Users, Repeat, ShieldCheck, Loader2, CalendarDays, Gauge } from 'lucide-react';
import { api } from '@/services/api';
import TransactionSubTable from './TransactionSubTable';
import AnalyseTab from '@/components/analyse/AnalyseTab';
import { useCreditAnalyse } from '@/components/analyse/useCreditAnalyse';

const AnalysisPanel = ({ code }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.application(code)
      .then((r) => { if (alive) setResult(r); })
      .catch(() => { if (alive) setResult(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

  const color = (v) => v?.startsWith('OK') || v === 'JUSTIFIÉ' ? 'text-emerald-400'
    : v?.startsWith('NON ÉVALUABLE') ? 'text-slate-400' : 'text-amber-400';

  if (loading) return <div className="col-span-full text-sm text-slate-400 p-2">Chargement de l'analyse…</div>;
  if (!result) return <div className="col-span-full text-sm text-slate-500 p-2">Aucune analyse rattachée à ce dossier.</div>;

  return (
    <div className="col-span-full bg-slate-800/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Analyse & vérification (référentiel {result.chaine_valeur?.libelle})
        {result.analyse_ia?.used && <Badge variant="outline" className="text-violet-300 border-violet-500/40 bg-violet-500/10">IA</Badge>}
      </div>
      {result.analyse_ia?.synthese && <p className="text-xs text-violet-200/80 italic">{result.analyse_ia.synthese}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-slate-900/50 p-2 rounded"><p className="text-xs text-slate-400">Filière</p><p className="font-bold text-sm">{result.chaine_valeur?.libelle || '—'}</p></div>
        <div className="bg-slate-900/50 p-2 rounded"><p className="text-xs text-slate-400">Décision</p><p className="font-bold text-sm">{result.decision_suggeree?.code || '—'}</p></div>
        <div className="bg-slate-900/50 p-2 rounded"><p className="text-xs text-slate-400">Score</p><p className="font-bold text-sm">{result.score?.global ?? '—'}/100</p></div>
        <div className="bg-slate-900/50 p-2 rounded"><p className="text-xs text-slate-400">Statut analyse</p><p className="font-bold text-sm">{result.statut}</p></div>
      </div>
      <div className="rounded-lg border border-slate-700 divide-y divide-slate-800 max-h-48 overflow-y-auto">
        {(result.vraisemblance || []).map((v, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="text-slate-300">{v.controle}
              {v.ref_min != null && v.ref_max != null && <span className="text-slate-500"> (réf. {v.ref_min}–{v.ref_max})</span>}
            </span>
            <span className={color(v.verdict)}>{v.verdict}</span>
          </div>
        ))}
        {(result.vraisemblance || []).length === 0 && <div className="px-3 py-2 text-xs text-slate-500">Aucun contrôle.</div>}
      </div>
      {result.retour_client && <p className="text-xs text-slate-400 italic whitespace-pre-line">{result.retour_client}</p>}
    </div>
  );
};

const DetailItem = ({ icon: Icon, label, value, className = '' }) => (
    <div className={`bg-slate-800/50 p-3 rounded-lg flex items-start gap-3 ${className}`}>
        <div className="text-emerald-400 mt-1"><Icon className="w-5 h-5" /></div>
        <div>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="font-semibold text-white">{value}</p>
        </div>
    </div>
);

const fmt = (n, curr) => `${Number(n).toLocaleString('fr-FR')} ${curr}`;

const CreditDetailsModal = ({ isOpen, onOpenChange, credit }) => {
    const [activeTab, setActiveTab] = useState('info');
    const [scheduleData, setScheduleData] = useState(null);
    const [scheduleLoading, setScheduleLoading] = useState(false);
    // L'analyse n'est sollicitée qu'à l'ouverture de son onglet : on n'appelle
    // pas le moteur pour un analyste qui ne consulte que les transactions.
    const [analyseOuverte, setAnalyseOuverte] = useState(false);

    // Référence du dossier d'instruction (app `credits`) — distincte de l'id du
    // prêt (app `portfolio`). Les deux machines à états ne se mélangent pas :
    // `applicationCode` est la seule clé qui adresse le moteur d'analyse.
    const applicationCode = credit?.applicationCode || credit?.id;
    const analyseState = useCreditAnalyse(applicationCode, analyseOuverte);

    // Reset when a different loan is opened.
    useEffect(() => {
        setScheduleData(null);
        setActiveTab('info');
        setAnalyseOuverte(false);
    }, [credit?.id]);

    const loadSchedule = useCallback(async () => {
        if (!credit?.id || scheduleData) return;
        setScheduleLoading(true);
        try {
            const data = await api.portfolio.loanSchedule(credit.id);
            setScheduleData(data);
        } catch {
            setScheduleData({ error: true });
        } finally {
            setScheduleLoading(false);
        }
    }, [credit?.id, scheduleData]);

    if (!credit) return null;

    const scoreColor = credit.score > 85 ? 'text-emerald-400' : credit.score > 70 ? 'text-blue-400' : credit.score > 50 ? 'text-yellow-400' : 'text-red-400';

    const handleTabChange = (v) => {
        setActiveTab(v);
        if (v === 'schedule') loadSchedule();
        if (v === 'analyse') setAnalyseOuverte(true);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-4xl border-slate-700">
                <DialogHeader>
                    <DialogTitle className="gradient-text text-2xl">Détails du Crédit : {credit.id}</DialogTitle>
                    <DialogDescription>Fiche complète du dossier de {credit.operator}.</DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList className="bg-slate-800/60 border border-slate-700">
                        <TabsTrigger value="info" className="data-[state=active]:bg-slate-700">Informations</TabsTrigger>
                        <TabsTrigger value="transactions" className="data-[state=active]:bg-slate-700">Transactions</TabsTrigger>
                        <TabsTrigger value="schedule" className="data-[state=active]:bg-slate-700">
                            <CalendarDays className="w-4 h-4 mr-1" />Échéancier
                        </TabsTrigger>
                        <TabsTrigger value="analyse" className="data-[state=active]:bg-slate-700">
                            <Gauge className="w-4 h-4 mr-1" />Analyse
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="info" className="max-h-[62vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800 mt-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-1">
                            <DetailItem icon={Hash} label="ID Crédit" value={credit.id} />
                            <DetailItem icon={Calendar} label="Date de création" value={credit.date} />
                            <DetailItem icon={User} label="Bénéficiaire" value={credit.operator} />
                            <DetailItem icon={Briefcase} label="Catégorie de crédit" value={credit.type} />
                            <DetailItem icon={DollarSign} label="Montant demandé" value={fmt(credit.amountRequested, credit.currency)} />
                            <DetailItem icon={DollarSign} label="Montant approuvé" value={fmt(credit.amountApproved, credit.currency)} className="text-emerald-300" />
                            <DetailItem icon={DollarSign} label="Montant décaissé" value={fmt(credit.amountDisbursed, credit.currency)} />
                            <DetailItem icon={Repeat} label="Devise" value={credit.currency} />
                            <DetailItem icon={Clock} label="Durée (mois)" value={credit.duration} />
                            <DetailItem icon={Percent} label="Taux d'intérêt" value={`${credit.rate}%`} />
                            <DetailItem icon={Calendar} label="Échéance finale" value={credit.dueDate} />
                            <DetailItem icon={Landmark} label="Portefeuille source" value={credit.source} />
                            <DetailItem icon={User} label="Gestionnaire assigné" value={credit.manager} />
                            <DetailItem icon={Users} label="Investisseur associé" value={credit.investor} />
                            <DetailItem icon={Shield} label="Garantie(s)" value={credit.guarantee} />
                            <DetailItem icon={Star} label="Score de solvabilité" value={<span className={scoreColor}>{credit.score}/100</span>} />
                            <DetailItem icon={FileText} label="Statut actuel" value={
                                <Badge variant={
                                    credit.status === 'Approuvé' ? 'success' :
                                    credit.status === 'Défaut' || credit.status === 'Rejeté' ? 'destructive' :
                                    credit.status === 'En traitement' || credit.status === 'En cours' ? 'info' : 'default'
                                }>{credit.status}</Badge>
                            } />
                            <AnalysisPanel code={credit.applicationCode || credit.id} />
                        </div>
                    </TabsContent>

                    <TabsContent value="transactions" className="max-h-[62vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800 mt-3">
                        <div className="bg-slate-800/50 rounded-lg overflow-hidden">
                            <TransactionSubTable creditId={credit.id} currency={credit.currency} />
                        </div>
                    </TabsContent>

                    <TabsContent value="schedule" className="mt-3">
                        {scheduleLoading && (
                            <div className="flex justify-center items-center h-40 text-slate-400">
                                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Chargement de l'échéancier…
                            </div>
                        )}
                        {!scheduleLoading && scheduleData?.error && (
                            <div className="text-center text-slate-500 py-12">
                                <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                Impossible de charger l'échéancier — taux ou durée non encore configurés.
                            </div>
                        )}
                        {!scheduleLoading && scheduleData && !scheduleData.error && (
                            <div className="max-h-[62vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800 space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="bg-slate-800/60 p-3 rounded-lg">
                                        <p className="text-xs text-slate-400">Capital total</p>
                                        <p className="font-bold text-white text-sm">{fmt(scheduleData.totals.total_principal, scheduleData.currency)}</p>
                                    </div>
                                    <div className="bg-slate-800/60 p-3 rounded-lg">
                                        <p className="text-xs text-slate-400">Intérêts totaux</p>
                                        <p className="font-bold text-amber-400 text-sm">{fmt(scheduleData.totals.total_interest, scheduleData.currency)}</p>
                                    </div>
                                    <div className="bg-slate-800/60 p-3 rounded-lg">
                                        <p className="text-xs text-slate-400">Total remboursé</p>
                                        <p className="font-bold text-emerald-400 text-sm">{fmt(scheduleData.totals.total_payments, scheduleData.currency)}</p>
                                    </div>
                                    <div className="bg-slate-800/60 p-3 rounded-lg">
                                        <p className="text-xs text-slate-400">Taux effectif global</p>
                                        <p className="font-bold text-blue-400 text-sm">{scheduleData.totals.apr.toFixed(2)} %</p>
                                    </div>
                                </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-slate-700 hover:bg-transparent">
                                            <TableHead className="text-slate-400 w-10">#</TableHead>
                                            <TableHead className="text-slate-400">Date d'échéance</TableHead>
                                            <TableHead className="text-right text-slate-400">Paiement total</TableHead>
                                            <TableHead className="text-right text-slate-400">Capital</TableHead>
                                            <TableHead className="text-right text-slate-400">Intérêts</TableHead>
                                            <TableHead className="text-right text-slate-400">Solde restant</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {scheduleData.schedule.map((row) => (
                                            <TableRow key={row.number} className="border-slate-800 hover:bg-slate-800/40 text-sm">
                                                <TableCell className="text-slate-500">{row.number}</TableCell>
                                                <TableCell className="text-slate-200">{row.date}</TableCell>
                                                <TableCell className="text-right font-semibold text-white">{Number(row.total).toLocaleString('fr-FR')}</TableCell>
                                                <TableCell className="text-right text-blue-300">{Number(row.principal).toLocaleString('fr-FR')}</TableCell>
                                                <TableCell className="text-right text-amber-300">{Number(row.interest).toLocaleString('fr-FR')}</TableCell>
                                                <TableCell className="text-right text-slate-300">{Number(row.balance).toLocaleString('fr-FR')}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                        {!scheduleLoading && !scheduleData && (
                            <div className="text-center text-slate-500 py-12">
                                <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">Cliquez sur cet onglet pour charger l'échéancier d'amortissement.</p>
                            </div>
                        )}
                    </TabsContent>

                    {/* Onglet « Analyse » — moteur de scoring (SPEC Moteur §8b).
                        Surface STAFF : ce modal n'est monté que depuis le tableau de bord
                        admin (`CreditsDashboard` → `CreditsTable`), jamais depuis le parcours
                        client. Le serveur reste l'autorité : un 403 s'affiche tel quel. */}
                    <TabsContent value="analyse" className="mt-3">
                        {/* Pas de `currency` transmis : l'analyse porte SA devise
                            (`analyse.devise`). Celle du prêt portefeuille est un autre
                            agrégat — l'emprunter pour étiqueter des montants du moteur
                            serait une erreur de lignage. */}
                        <AnalyseTab code={applicationCode} state={analyseState} />
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)} variant="outline" className="border-slate-600 hover:bg-slate-700">Fermer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default CreditDetailsModal;
