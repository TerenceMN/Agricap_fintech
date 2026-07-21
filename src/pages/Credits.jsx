import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import MesDossiers from '@/components/credits/MesDossiers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from '@/contexts/AuthContext.jsx';
import AdminCreditsDashboard from '@/components/admin/credits/CreditsDashboard.jsx';
import { api, ApiError } from '@/services/api';

import {
    Check, Send, Shield, ArrowLeft, RefreshCw, Info, Banknote, History, Shuffle, FileSignature, User, Landmark, CalendarDays, AlertTriangle, Package, ShieldCheck, Loader2
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  GUARANTEE_CONFIG, guaranteeConfig,
} from '@/components/guarantees/guaranteeConfig';
import { guaranteeErrorList, guaranteeErrorMessage } from '@/components/guarantees/guaranteeErrors';
import { formatDateFr, formatMontant } from '@/components/guarantees/format';
import GuaranteeCoverage from '@/components/guarantees/GuaranteeCoverage';
import PledgeableAssets from '@/components/guarantees/PledgeableAssets';
import { MODULE_CODES, canonicalModule, moduleConfig } from '@/components/simulateur/modules';
import NeedsSheetPanel, { NeedsSheetErrorList, NeedsSheetFailure } from '@/components/simulateur/NeedsSheetPanel';
import { isFileValidationError, transportErrorMessage } from '@/components/simulateur/needsSheetErrors';
import ModuleGrid from '@/components/simulateur/ModuleGrid';
import {
  DonutChartScore, ModuleFinancingSummary, ScoreBreakdown, SchedulePreview, scoreLetterOf,
} from '@/components/simulateur/SimulationResult';

// =================================================================
// ===== CLIENT VIEW COMPONENTS (EXISTING & UPDATED) ===============
// =================================================================

const STEPS = [
  { id: 1, name: 'Demande Initiale' },
  { id: 2, name: 'Simulation & Scoring' },
  { id: 3, name: 'Garanties' },
  { id: 4, name: 'Synthèse & Soumission' },
];

// La table d'affichage des 8 modules vit dans `@/components/simulateur/modules` :
// codes canoniques du backend (`maindoeuvre`, `postrecolte`…), alias hérités
// résolus par `moduleConfig()`. La table locale précédente était indexée en
// camelCase et faisait disparaître deux modules des totaux affichés.

const DemandeInitiale = ({ formData, setFormData, nextStep, prefill }) => {
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  const handleCurrencyChange = (value) => setFormData(prev => ({ ...prev, currency: value }));
  const handleVcChange = (value) => setFormData(prev => ({ ...prev, vcCode: value }));

  // Filière et superficie sont exigées ici, pas au moment de soumettre : le
  // dossier brouillon est créé dès l'étape 2 (le téléversement de la feuille en
  // a besoin), et `submit` les refuserait de toute façon
  // (`FILIERE_MANQUANTE`, `SUPERFICIE_MANQUANTE`). Autant le dire tout de suite.
  const hasChainChoice = prefill?.valueChains?.length > 0;
  const isValid = Boolean(
    formData.montant && parseFloat(formData.montant) > 0
    && formData.superficie && parseFloat(formData.superficie) > 0
    && (hasChainChoice ? formData.vcCode : true),
  );

  return (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">

       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><Label htmlFor="demandeur">Nom du demandeur / Coopérative</Label><Input id="demandeur" name="demandeur" value={formData.demandeur} onChange={handleChange} className="bg-white/5" /></div>
        <div><Label htmlFor="localisation">Localisation</Label><Input id="localisation" name="localisation" value={formData.localisation} onChange={handleChange} className="bg-white/5" /></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="vcCode">Filière agricole</Label>
          {prefill?.valueChains?.length > 0 ? (
            <Select onValueChange={handleVcChange} value={formData.vcCode}>
              <SelectTrigger id="vcCode" className="bg-white/5"><SelectValue placeholder="Choisir une filière..." /></SelectTrigger>
              <SelectContent>
                {prefill.valueChains.map(vc => <SelectItem key={vc.code} value={vc.code}>{vc.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input id="culture" name="culture" value={formData.culture} onChange={handleChange} placeholder="Ex: Café, Maïs..." className="bg-white/5" />
          )}
        </div>
        <div><Label htmlFor="superficie">Superficie (ha) *</Label><Input type="number" id="superficie" name="superficie" value={formData.superficie} onChange={handleChange} className="bg-white/5" /></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Label htmlFor="montant">Montant souhaité *</Label>
          <Input type="number" id="montant" name="montant" value={formData.montant} onChange={handleChange} className="bg-white/5" />
          <p className="text-xs text-gray-500 mt-1.5">
            Ordre de grandeur de votre demande. Le détail chiffré, poste par poste, viendra de
            votre feuille de besoins à l'étape suivante.
          </p>
        </div>
        <div><Label htmlFor="currency">Devise</Label>
          <Select onValueChange={handleCurrencyChange} value={formData.currency}>
            <SelectTrigger id="currency" className="bg-white/5"><SelectValue placeholder="Devise..." /></SelectTrigger>
            <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      {/* Le dépôt de la feuille de besoins a rejoint l'étape 2 : il exige un
          dossier existant côté serveur (`dataset_key = fb__<code>`), donc les
          informations ci-dessus. */}
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <Info className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-sm text-gray-400 leading-relaxed">
          À l'étape suivante, vous téléchargerez le template officiel AGRICAP et téléverserez
          votre feuille de besoins remplie. Ce sont ses montants — et eux seuls — qui alimentent
          la simulation et l'analyse de votre dossier.
        </p>
      </div>

      <Button onClick={nextStep} disabled={!isValid} className="w-full bg-gradient-to-r from-emerald-500 to-blue-600 py-6 text-lg disabled:opacity-50">
        Passer à ma feuille de besoins <ArrowLeft className="w-5 h-5 ml-2 transform rotate-180" />
      </Button>
    </motion.div>
  );
};
/**
 * Étape 2 — le simulateur est un **calque strict** de la feuille de besoins.
 *
 * SPEC §1.4, les 5 points :
 *  1. sans feuille ingérée, les 8 modules sont vides et désactivés, et un
 *     encart renvoie vers le template officiel ;
 *  2. après téléversement, chaque module affiche son coût en LECTURE SEULE,
 *     issu de `5_Synthese_Besoins` — les modules à 0 sont grisés ;
 *  3. le seul réglage restant est « Financement demandé % » par module ;
 *  4. « Simuler » appelle `POST /credits/simulate/` avec le seul
 *     `application_code` : le backend lit les `DataRecord` et ignorerait de
 *     toute façon tout montant du payload (lot 2, principe 1) ;
 *  5. pour changer un coût, le client change son classeur et le re-téléverse.
 *
 * Ce qui a disparu avec cette version : l'initialisation des coûts au
 * `Math.random()`, les champs de saisie de coût, les interrupteurs
 * d'activation par module, et l'envoi de `ns_totals` dans le payload de
 * simulation. Aucun score ni taux n'est calculé ici.
 *
 * Reste un unique calcul côté navigateur, explicitement voulu par la SPEC
 * (point 3) : « Montant total financé » = Σ (coût du fichier × part demandée).
 * Ce n'est pas un chiffre du moteur mais l'expression de la demande du client.
 * Voir le rapport de lot pour la limite qui s'y attache (aucun endpoint ne
 * permet aujourd'hui de le renvoyer au dossier).
 */
const SimulateurIntelligent = ({
  formData, setFormData, nextStep, prevStep, uploadNeedsSheet, runSimulation,
}) => {
  const { toast } = useToast();
  const nsResult = formData.nsResult || null;

  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState([]);
  // Panne de transport (session expirée, service indisponible) : affichée à part
  // des refus de validation — voir `isFileValidationError`.
  const [uploadFailure, setUploadFailure] = useState(null);
  const [lastFile, setLastFile] = useState(null);

  const [simLoading, setSimLoading] = useState(false);
  const [simErrors, setSimErrors] = useState([]);
  const [simFailure, setSimFailure] = useState(null);
  const [simResult, setSimResult] = useState(formData.simResult || null);
  // Instantané du financement % au moment de la dernière simulation : sert à
  // détecter qu'un curseur a bougé depuis, ce qui périme le score affiché.
  const [simFinancing, setSimFinancing] = useState(formData.simFinancing || null);

  // Part demandée à AGRICAP, par module. Seul état réellement saisi par le
  // client sur cet écran ; conservé d'un téléversement à l'autre.
  const [financing, setFinancing] = useState(
    () => Object.fromEntries(MODULE_CODES.map(code => [code, 100])),
  );

  /** Coûts par module, tels que l'API les a extraits des `DataRecord`. */
  const costs = useMemo(() => {
    const raw = nsResult?.totalByModule;
    if (!raw) return null;
    const out = Object.fromEntries(MODULE_CODES.map(code => [code, 0]));
    Object.entries(raw).forEach(([key, value]) => {
      const code = canonicalModule(key);
      // Le backend sert des chaînes décimales (`"1330.00"`) : pas de `parseInt`,
      // qui tronquerait les centimes sans le dire.
      if (code) out[code] = Number(value) || 0;
    });
    return out;
  }, [nsResult]);

  const { totalNeeds, totalFinanced, pieData } = useMemo(() => {
    if (!costs) return { totalNeeds: 0, totalFinanced: 0, pieData: [] };
    let needs = 0;
    let financed = 0;
    const slices = [];
    MODULE_CODES.forEach((code) => {
      const cost = costs[code] || 0;
      if (cost <= 0) return;
      const share = (cost * (financing[code] ?? 100)) / 100;
      needs += cost;
      financed += share;
      if (share > 0) {
        slices.push({ name: moduleConfig(code).label, value: share, color: moduleConfig(code).color });
      }
    });
    return { totalNeeds: needs, totalFinanced: financed, pieData: slices };
  }, [costs, financing]);

  // Le lot 2 rattache la simulation à une révision précise. Si le client
  // re-téléverse après avoir simulé, le score affiché ne décrit plus le
  // fichier courant : on le dit au lieu de laisser un chiffre périmé à l'écran.
  const simulatedRevision = simResult?.needsSource?.revision ?? null;
  const staleRevision = Boolean(
    simResult && nsResult && simulatedRevision != null && simulatedRevision !== nsResult.revision,
  );
  // De même, bouger un curseur de « Financement demandé % » après avoir simulé
  // périme le score : la demande n'est plus celle qui a été scorée.
  const staleFinancing = useMemo(() => {
    if (!simResult || !simFinancing) return false;
    return MODULE_CODES.some(
      (code) => (simFinancing[code] ?? 100) !== (financing[code] ?? 100),
    );
  }, [simResult, simFinancing, financing]);
  const staleSimulation = staleRevision || staleFinancing;
  // Les chiffres serveur (montant ajusté, part par module) ne valent que pour la
  // demande réellement scorée : on ne les montre pas s'ils sont périmés.
  const montantAjuste = !staleSimulation ? (simResult?.montantDemandeAjuste ?? null) : null;

  const handleUpload = async (file) => {
    setUploading(true);
    setUploadErrors([]);
    setUploadFailure(null);
    setLastFile(file);
    try {
      const result = await uploadNeedsSheet(file);
      // Nouvelle révision ⇒ la simulation précédente ne vaut plus rien.
      setSimResult(null);
      setSimErrors([]);
      setFormData(prev => ({ ...prev, nsResult: result, simResult: null }));
      toast({
        title: `Feuille validée — révision ${result.revision}`,
        description: 'Les coûts de vos 8 modules sont maintenant ceux de votre fichier.',
      });
    } catch (e) {
      // Un échec de transport n'est PAS un refus du fichier. Le confondre
      // enverrait le client corriger un classeur valide parce que son jeton a
      // expiré — un écran qui se trompe de coupable coûte plus cher qu'un
      // écran qui dit « réessayez ».
      if (!isFileValidationError(e)) {
        const failure = transportErrorMessage(e);
        setUploadFailure(failure);
        toast({ variant: 'destructive', title: failure.titre, description: failure.message });
        return;
      }
      // 422 : une entrée par contrôle en échec. Toutes affichées d'un coup —
      // sinon le client les redécouvre une par une, à chaque téléversement.
      const causes = guaranteeErrorList(e);
      setUploadErrors(causes);
      toast({
        variant: 'destructive',
        title: causes.length > 1
          ? `Feuille refusée — ${causes.length} points à corriger`
          : 'Feuille refusée',
        description: causes.length > 1
          ? 'Le détail est affiché sous le formulaire de dépôt.'
          : causes[0].message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSimulate = async () => {
    setSimLoading(true);
    setSimErrors([]);
    setSimFailure(null);
    // Instantané figé de la demande envoyée — sert de référence de fraîcheur.
    const financingSent = { ...financing };
    try {
      const result = await runSimulation(financingSent);
      setSimResult(result);
      setSimFinancing(financingSent);
      setFormData(prev => ({ ...prev, simResult: result, simFinancing: financingSent }));
    } catch (e) {
      setSimResult(null);
      setSimFinancing(null);
      if (isFileValidationError(e)) setSimErrors(guaranteeErrorList(e));
      else setSimFailure(transportErrorMessage(e));
    } finally {
      setSimLoading(false);
    }
  };

  const handleFinancingChange = (code, pct) => setFinancing(prev => ({ ...prev, [code]: pct }));

  const handleSubmit = () => {
    // Forme conservée pour l'étape 4 : `{module: {cost, financing, active}}`.
    // `cost` vient du fichier, `active` en découle — ce n'est plus un choix.
    const modules = Object.fromEntries(
      MODULE_CODES.map((code) => {
        const cost = costs?.[code] ?? 0;
        return [code, { cost, financing: financing[code] ?? 100, active: cost > 0 }];
      }),
    );
    setFormData(prev => ({ ...prev, modules, totalFinanced, simResult }));
    nextStep();
  };

  return (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
      <NeedsSheetPanel
        valueChainCode={formData.vcCode}
        currency={formData.currency}
        templateUrl={api.credits.templateUrl(formData.vcCode || undefined)}
        result={nsResult}
        uploading={uploading}
        errors={uploadErrors}
        failure={uploadFailure}
        onUpload={handleUpload}
        onRetry={lastFile ? () => handleUpload(lastFile) : undefined}
      />

      {/* ── Score et montants : tout vient du serveur, sauf la part demandée ── */}
      <div className="flex flex-col lg:flex-row items-center justify-around gap-8 glass-effect p-6 rounded-2xl">
        <DonutChartScore score={simResult?.score ?? null} />

        <div className="text-center lg:text-left">
          <h3 className="text-2xl font-bold text-white">Simulation de crédit</h3>
          {simResult ? (
            <div className="mt-2 space-y-1">
              <p className={`font-semibold ${simResult.eligible ? 'text-emerald-400' : 'text-red-400'}`}>
                {simResult.eligible ? '✓ Éligible' : '✗ Non éligible'}
              </p>
              <p className="text-sm text-gray-400">{simResult.valuationNote}</p>
              {simResult.proposedRate != null && (
                <p className="text-sm">Taux indicatif : <b className="text-blue-300">{simResult.proposedRate} %/an</b></p>
              )}
            </div>
          ) : (
            <p className="text-gray-400 mt-1 max-w-sm">
              {nsResult
                ? 'Lancez la simulation : le score est calculé par AGRICAP à partir des montants de votre feuille.'
                : 'Le score ne peut être calculé qu\'à partir de votre feuille de besoins.'}
            </p>
          )}

          <div className="mt-4 glass-effect p-4 rounded-lg inline-block text-left">
            {/* Tant que le moteur n'a pas répondu, on montre l'APERÇU de la
                demande (Σ coût × part), expression du choix client autorisée par
                la SPEC §1.4 point 3 — clairement étiqueté « à confirmer ». Dès
                qu'une simulation fraîche renvoie `montantDemandeAjuste`, c'est
                CE chiffre serveur qui fait foi (principe 3). */}
            <p className="text-sm text-gray-400">
              {montantAjuste != null ? 'Montant demandé scoré' : 'Montant demandé (aperçu)'}
            </p>
            <p className="text-3xl font-bold text-emerald-400 tabular-nums">
              {montantAjuste != null
                ? formatMontant(montantAjuste, formData.currency, { decimals: 0 })
                : costs ? formatMontant(totalFinanced, formData.currency, { decimals: 0 }) : '—'}
            </p>
            {costs && (
              <p className="text-xs text-gray-500 mt-1">
                sur un besoin total de {formatMontant(totalNeeds, formData.currency, { decimals: 0 })}
                {montantAjuste == null && ' · à confirmer par la simulation'}
              </p>
            )}
          </div>

          <div className="mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSimulate}
              disabled={simLoading || !nsResult}
              className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
            >
              {simLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Simulation en cours…
                </>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" /> Simuler via l'API</>
              )}
            </Button>
            {!nsResult && (
              <p className="text-[11px] text-gray-600 mt-2">Téléversez d'abord votre feuille de besoins.</p>
            )}
          </div>
        </div>

        <div className="glass-effect p-4 rounded-2xl w-full lg:w-72">
          <h4 className="font-bold text-white text-center mb-2">Répartition demandée</h4>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={5}>
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <RechartsTooltip
                  formatter={(value, name) => [formatMontant(value, formData.currency, { decimals: 0 }), name]}
                  contentStyle={{ backgroundColor: 'rgba(30,41,59,0.9)', border: 'none', borderRadius: '0.5rem' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[150px] flex items-center justify-center text-center px-4">
              <p className="text-xs text-gray-600">
                La répartition s'affichera dès que votre feuille de besoins sera déposée.
              </p>
            </div>
          )}
        </div>
      </div>

      {staleSimulation && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-amber-100/90">
            {staleRevision ? (
              <>
                Votre feuille a été mise à jour (révision {nsResult.revision}) depuis cette
                simulation, calculée sur la révision {simulatedRevision}. Relancez la simulation
                pour obtenir le score correspondant à votre fichier actuel.
              </>
            ) : (
              <>
                Vous avez modifié la part demandée d'au moins un module depuis cette simulation.
                Relancez-la pour recalculer le score et le montant sur votre demande actuelle.
              </>
            )}
          </p>
        </div>
      )}

      <NeedsSheetFailure failure={simFailure} onRetry={handleSimulate} />
      <NeedsSheetErrorList errors={simErrors} title="La simulation n'a pas pu être lancée" />

      <ModuleGrid
        costs={costs}
        financing={financing}
        onFinancingChange={handleFinancingChange}
        currency={formData.currency}
      />

      {!staleSimulation && <ModuleFinancingSummary simResult={simResult} currency={formData.currency} />}

      <ScoreBreakdown simResult={simResult} />
      <SchedulePreview simResult={simResult} currency={formData.currency} />

      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-end gap-3">
        <Button onClick={prevStep} variant="ghost">
          <ArrowLeft className="w-5 h-5 mr-2" aria-hidden="true" /> Retour
        </Button>
        <div className="flex flex-col items-end gap-2">
          {!nsResult && (
            <p className="text-xs text-gray-500 text-right max-w-md">
              Votre feuille de besoins est indispensable pour continuer : c'est elle qui définit
              le plan de financement soumis à l'analyse.
            </p>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!nsResult}
            className="bg-gradient-to-r from-emerald-500 to-blue-600 py-6 text-lg disabled:opacity-40"
          >
            Choisir mes garanties <ArrowLeft className="w-5 h-5 ml-2 transform rotate-180" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * Étape 3 — garanties opposables (SPEC §2.4).
 *
 * Ce que cet écran ne fait plus :
 *  - lire `localStorage.agricap_assets` (les actifs viennent de `/api/assets/mine`) ;
 *  - calculer un nantissement d'épargne à « 20 % du montant » côté client ;
 *  - proposer des cases à cocher sans endpoint derrière.
 *
 * Ce qu'il fait : le client mobilise **ses** actifs vérifiés via
 * `POST /credits/applications/<code>/guarantees/asset/`, seul type de garantie
 * qu'un client peut poser lui-même. Épargne et caution solidaire relèvent d'un
 * agent (`CAN_INSTRUCT` côté serveur) : elles sont présentées, jamais cochables
 * — un bouton sans permission serveur n'existe pas (CLAUDE.md §7.2).
 *
 * La couverture affichée vient de `coverage`, calculé par le backend sur les
 * valeurs retenues après décote.
 */
const CLIENT_PLACEABLE_GUARANTEES = ['materiel', 'foncier'];
const AGENT_PLACEABLE_GUARANTEES = ['epargne', 'morale'];

const ConfigurationGaranties = ({ nextStep, prevStep, draftCode, ensureDraft, onGuaranteesChange }) => {
  const { toast } = useToast();

  const [assets, setAssets] = useState([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState(null);

  const [guaranteeSet, setGuaranteeSetState] = useState(null);
  // Le résumé serveur est aussi remonté au parent : l'étape 4 affiche les
  // garanties du dossier, pas une copie locale de la sélection.
  const setGuaranteeSet = useCallback((value) => {
    setGuaranteeSetState(value);
    onGuaranteesChange?.(value);
  }, [onGuaranteesChange]);

  const [guaranteesLoading, setGuaranteesLoading] = useState(false);
  const [pledgingId, setPledgingId] = useState(null);
  const [pledgeError, setPledgeError] = useState(null);

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      // Le backend filtre lui-même les actifs mobilisables : vérifié ou libéré,
      // libre de gage, valeur retenue > 0. Le front n'en déduit rien.
      const res = await api.assets.mine({ pledgeable: true });
      setAssets(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setAssets([]);
      setAssetsError(guaranteeErrorMessage(e, 'Impossible de charger vos actifs mobilisables.'));
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  const loadGuarantees = useCallback(async (code) => {
    if (!code) return;
    setGuaranteesLoading(true);
    try {
      setGuaranteeSet(await api.credits.guarantees(code));
    } catch (e) {
      setPledgeError(guaranteeErrorMessage(e, 'Impossible de relire les garanties du dossier.'));
    } finally {
      setGuaranteesLoading(false);
    }
  }, [setGuaranteeSet]);

  useEffect(() => { loadAssets(); }, [loadAssets]);
  useEffect(() => { if (draftCode) loadGuarantees(draftCode); }, [draftCode, loadGuarantees]);

  const pledgedAssetIds = useMemo(
    () => (guaranteeSet?.items || []).filter(g => g.asset?.id).map(g => g.asset.id),
    [guaranteeSet],
  );

  const handlePledge = async (asset) => {
    setPledgingId(asset.id);
    setPledgeError(null);
    try {
      const code = draftCode || await ensureDraft();
      const updated = await api.credits.placeAssetGuarantee(code, asset.id);
      setGuaranteeSet(updated);
      await loadAssets(); // l'actif proposé n'est plus mobilisable ailleurs
      toast({
        title: 'Actif proposé en garantie',
        description: `« ${asset.name} » est rattaché à votre dossier. Un agent AGRICAP doit encore confirmer le gage pour qu'il couvre le crédit.`,
      });
    } catch (e) {
      // 422 → chaque règle refusée devient une consigne actionnable, jamais « erreur ».
      const message = guaranteeErrorMessage(e);
      setPledgeError(message);
      toast({ variant: 'destructive', title: 'Garantie refusée', description: message });
    } finally {
      setPledgingId(null);
    }
  };

  const hasGuarantee = (guaranteeSet?.items || []).some(
    g => g.status === 'pending' || g.status === 'active',
  );

  return (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
      <div className="glass-effect p-6 rounded-2xl">
        <h3 className="text-xl font-bold text-white mb-2">Garanties du dossier</h3>
        <p className="text-gray-400 text-sm leading-relaxed">
          Une garantie n'a de valeur que si elle est opposable : l'actif doit exister à votre nom,
          avoir été vérifié par un agent AGRICAP et être libre de tout gage. Vous mobilisez ici vos
          actifs vérifiés ; les autres types de garantie sont constitués avec votre agent pendant
          l'instruction du dossier.
        </p>
      </div>

      {/* ── Garanties sur actif : les seules qu'un client peut poser lui-même ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h4 className="font-semibold text-white flex items-center gap-2">
            <Package className="w-4 h-4" aria-hidden="true" /> Mes actifs mobilisables
          </h4>
          <div className="flex gap-2">
            {CLIENT_PLACEABLE_GUARANTEES.map(code => {
              const cfg = GUARANTEE_CONFIG[code];
              const Icon = cfg.icon;
              const available = assets.some(a => a.guaranteeType === code);
              return (
                <span
                  key={code}
                  className={`px-2.5 py-1 rounded-full border text-[11px] flex items-center gap-1.5 ${
                    available
                      ? 'border-white/20 text-gray-200 bg-white/5'
                      : 'border-white/10 text-gray-600 bg-white/[0.02]'
                  }`}
                  title={available ? undefined : `Aucun actif vérifié de type « ${cfg.label} »`}
                >
                  <Icon className="w-3 h-3" style={{ color: available ? cfg.color : undefined }} aria-hidden="true" />
                  {cfg.label}
                </span>
              );
            })}
          </div>
        </div>

        <PledgeableAssets
          assets={assets}
          loading={assetsLoading}
          error={assetsError}
          pledgingId={pledgingId}
          pledgedAssetIds={pledgedAssetIds}
          onRetry={loadAssets}
          onPledge={handlePledge}
        />

        {pledgeError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{pledgeError}</span>
            </p>
          </div>
        )}
      </div>

      {/* ── Garanties constituées en agence (endpoints réservés au staff) ── */}
      <div className="space-y-3">
        <h4 className="font-semibold text-white flex items-center gap-2">
          <Shield className="w-4 h-4" aria-hidden="true" /> Garanties constituées avec votre agent
        </h4>
        {AGENT_PLACEABLE_GUARANTEES.map(code => {
          const cfg = GUARANTEE_CONFIG[code];
          const Icon = cfg.icon;
          return (
            <div key={code} className="p-4 rounded-xl border border-white/10 bg-white/[0.03]">
              <div className="flex items-start gap-3">
                <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: cfg.color }} aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-semibold text-gray-200">{cfg.label}</p>
                  <p className="text-sm text-gray-400 mt-1">{cfg.description}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {code === 'epargne'
                      ? "Le montant à bloquer est arrêté par AGRICAP à l'instruction, en fonction du solde réellement disponible sur votre plan d'épargne."
                      : "Le garant doit consentir personnellement à son engagement : cette caution est enregistrée par votre agent, jamais depuis votre espace."}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Couverture, telle que le backend la calcule ── */}
      {guaranteesLoading && !guaranteeSet && (
        <div className="glass-effect rounded-2xl p-5 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {guaranteeSet && <GuaranteeCoverage guaranteeSet={guaranteeSet} />}

      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-end gap-3 mt-8">
        <Button onClick={prevStep} variant="ghost">
          <ArrowLeft className="w-5 h-5 mr-2" aria-hidden="true" /> Retour
        </Button>
        <div className="flex flex-col items-end gap-2">
          {!hasGuarantee && (
            <p className="text-xs text-gray-500 text-right max-w-md">
              Aucune garantie n'est encore rattachée au dossier. Vous pouvez continuer : votre
              agent pourra en constituer une pendant l'instruction.
            </p>
          )}
          <Button onClick={nextStep} className="bg-gradient-to-r from-emerald-500 to-blue-600 py-6 text-lg">
            Voir la synthèse <ArrowLeft className="w-5 h-5 ml-2 transform rotate-180" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};


const FicheSynthese = ({ formData, prevStep, submitApplication, guaranteeSet, submitErrors = [] }) => (
    <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
      <div className="glass-effect p-8 rounded-2xl">
        <h3 className="text-2xl font-bold text-white mb-6">Fiche de Synthèse Finale</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div className="bg-white/5 p-4 rounded-lg"><p className="text-sm text-gray-400">Demandeur</p><p className="font-bold">{formData.demandeur}</p></div>
          <div className="bg-white/5 p-4 rounded-lg"><p className="text-sm text-gray-400">Superficie</p><p className="font-bold">{formData.superficie} ha</p></div>
          <div className="bg-white/5 p-4 rounded-lg"><p className="text-sm text-gray-400">Culture</p><p className="font-bold">{formData.culture}</p></div>
          <div className="bg-white/5 p-4 rounded-lg col-span-2 md:col-span-1"><p className="text-sm text-gray-400">Montant total financé</p><p className="font-bold text-2xl text-emerald-400">{formatMontant(formData.totalFinanced, formData.currency, { decimals: 0 })}</p></div>
          {/* Score du moteur ; `formData.scoreLetter` n'était jamais alimenté. */}
          <div className="bg-white/5 p-4 rounded-lg text-center"><p className="text-sm text-gray-400">Score</p><p className="font-black text-4xl gradient-text">{formData.simResult?.score != null ? scoreLetterOf(formData.simResult.score) : '—'}</p><p className="text-[11px] text-gray-500 mt-1">{formData.simResult?.score != null ? `${Math.round(formData.simResult.score)}/100` : 'simulation non lancée'}</p></div>
          {/* Taux proposé par le moteur ; le front n'en dérive aucun. */}
          <div className="bg-white/5 p-4 rounded-lg text-center"><p className="text-sm text-gray-400">Taux indicatif</p><p className="font-bold text-2xl">{formData.simResult?.proposedRate != null ? `${formData.simResult.proposedRate} %` : '—'}</p><p className="text-[11px] text-gray-500 mt-1">{formData.simResult?.proposedRate != null ? 'communiqué par AGRICAP' : 'communiqué après analyse'}</p></div>
        </div>

        <div className="mt-6">
           <h4 className="font-bold text-white mb-2">Garanties rattachées au dossier</h4>
           {/* Source unique : le résumé serveur des garanties du dossier. */}
           <div className="flex flex-wrap gap-2">
             {(guaranteeSet?.items || []).map((g) => {
                const cfg = guaranteeConfig(g.type);
                return (
                  <Badge key={g.id} variant="outline" className="text-blue-300 border-blue-500/30 bg-blue-500/10 py-1 px-3">
                    <ShieldCheck className="w-3 h-3 mr-1"/> {cfg.label}
                    {g.asset?.name ? ` — ${g.asset.name}` : ''}
                    {g.status === 'pending' ? ' (à confirmer)' : ''}
                  </Badge>
                );
             })}
             {!(guaranteeSet?.items || []).length && (
               <p className="text-sm text-gray-500">
                 Aucune garantie rattachée pour l'instant : votre agent pourra en constituer une pendant l'instruction.
               </p>
             )}
           </div>
        </div>

        {guaranteeSet?.coverage && (
          <div className="mt-6">
            <GuaranteeCoverage guaranteeSet={guaranteeSet} />
          </div>
        )}

        <div className="mt-6">
          <h4 className="font-bold text-white mb-2">Répartition du financement demandé</h4>
          <p className="text-xs text-gray-500 mb-2">
            Coûts issus de votre feuille de besoins
            {formData.nsResult?.revision != null ? ` (révision ${formData.nsResult.revision})` : ''} ·
            part demandée à AGRICAP.
          </p>
          <div className="space-y-2">
            {formData.modules && Object.entries(formData.modules)
              .filter(([, mod]) => mod.active)
              .map(([key, mod]) => {
                const cfg = moduleConfig(key);
                const Icon = cfg.icon;
                return (
                  <div key={key} className="flex justify-between items-center bg-white/5 p-2 rounded gap-3">
                    <span className="flex items-center gap-2 text-sm">
                      <Icon className="w-4 h-4 shrink-0" style={{ color: cfg.color }} aria-hidden="true" />
                      {cfg.label}
                      <span className="text-xs text-gray-500">({mod.financing} %)</span>
                    </span>
                    <span className="font-semibold tabular-nums shrink-0">
                      {formatMontant((mod.cost * mod.financing) / 100, formData.currency, { decimals: 0 })}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Refus de soumission : une ligne par cause, jamais un message agrégé. */}
      {submitErrors.length > 0 && (
        <div className="glass-effect rounded-2xl border border-red-500/30 p-5">
          <h4 className="font-bold text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            {submitErrors.length > 1
              ? `${submitErrors.length} points à corriger avant de soumettre`
              : 'Un point à corriger avant de soumettre'}
          </h4>
          <ul className="mt-3 space-y-2">
            {submitErrors.map((cause, i) => (
              <li key={cause.code ? `${cause.code}-${i}` : i} className="flex items-start gap-2 text-sm text-red-100/90">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" aria-hidden="true" />
                <span>{cause.message}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            Utilisez « Ajuster » pour revenir sur les étapes concernées, puis soumettez à nouveau.
          </p>
        </div>
      )}

       <div className="flex justify-between"><Button onClick={() => prevStep(3)} variant="ghost"><ArrowLeft className="w-5 h-5 mr-2"/> Ajuster</Button><Button onClick={submitApplication} className="bg-purple-600 hover:bg-purple-700 py-6 text-lg"><Send className="w-5 h-5 mr-2" /> Soumettre ma demande</Button></div>
    </motion.div>
);
const SuccessMessage = ({ loan, reset }) => ( <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center glass-effect p-12 rounded-2xl"><Check className="w-16 h-16 mx-auto bg-emerald-500 text-white rounded-full p-2 mb-4" /><h2 className="text-3xl font-bold text-white">Demande Soumise !</h2><p className="text-gray-300 mt-2 mb-6">Bonjour {loan.operator}, votre demande de {formatMontant(loan.amountApproved, loan.currency, { decimals: 0 })} a été envoyée. <br/> Nous vous notifierons dans 3 à 5 jours ouvrables.</p><Button onClick={reset}><RefreshCw className="w-4 h-4 mr-2"/> Nouvelle Demande</Button></motion.div>);

// La nomenclature des garanties vit désormais dans
// `@/components/guarantees/guaranteeConfig` : 4 codes canoniques
// (`epargne`, `morale`, `materiel`, `foncier`), alignés sur le backend, et
// `actif` / `immobilier` / `Gage matériel` / `Hypothèque` réduits à des alias
// d'affichage résolus par `guaranteeConfig()` (SPEC §2.2, principe 6).


const TransferDialog = ({ open, onOpenChange, subwallet, onTransfer, currency, suppliers }) => {
  const [amount, setAmount] = useState(''); const [supplier, setSupplier] = useState(''); const [description, setDescription] = useState('');
  const { toast } = useToast();
  const handleTransfer = () => {
    if (!amount || !supplier || !description) { toast({ variant: 'destructive', title: 'Erreur', description: 'Veuillez remplir tous les champs.' }); return; }
    const transferAmount = parseFloat(amount);
    if (transferAmount <= 0 || transferAmount > subwallet.balance) { toast({ variant: 'destructive', title: 'Erreur', description: 'Montant invalide ou solde insuffisant.' }); return; }
    onTransfer(subwallet.id, transferAmount, supplier, description);
    onOpenChange(false); setAmount(''); setSupplier(''); setDescription('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white"><DialogHeader><DialogTitle className="gradient-text">Transférer / Payer</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Depuis le portefeuille</Label><Input value={subwallet?.label} disabled className="bg-white/10" /></div>
          <div><Label>Solde disponible</Label><Input value={formatMontant(subwallet?.balance, currency, { decimals: 2 })} disabled className="bg-white/10" /></div>
          <div><Label>Vers le fournisseur</Label><Select onValueChange={setSupplier} value={supplier}><SelectTrigger className="bg-white/5"><SelectValue placeholder="Sélectionner un fournisseur..." /></SelectTrigger><SelectContent className="glass-effect">{suppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Montant ({currency})</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="bg-white/5" /></div>
          <div><Label>Motif / Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Achat semences de maïs" className="bg-white/5" /></div>
        </div>
        <DialogFooter><Button onClick={handleTransfer} className="bg-emerald-600 hover:bg-emerald-700">Exécuter le paiement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ContractDialog = ({ open, onOpenChange, contract }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="glass-effect text-white max-w-2xl"><DialogHeader><DialogTitle className="gradient-text flex items-center gap-2"><FileSignature/>Détails du Contrat</DialogTitle><DialogDescription>Contrat N° {contract.id}</DialogDescription></DialogHeader>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto p-1">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 p-3 rounded-lg"><p className="text-xs text-gray-400">Parties</p><p className="font-semibold">{contract.parties}</p></div>
          <div className="bg-white/5 p-3 rounded-lg"><p className="text-xs text-gray-400">Date d'effet</p><p className="font-semibold">{contract.date}</p></div>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">Ce contrat lie les parties susmentionnées pour un crédit de <span className="font-bold text-emerald-400">{formatMontant(contract.amount, contract.currency, { decimals: 0 })}</span>. Les fonds sont débloqués selon les sous-portefeuilles définis. Le remboursement est attendu selon les termes convenus. Les garanties listées sont engagées pour la durée du contrat.</p>
      </div>
      <DialogFooter><Button onClick={() => onOpenChange(false)} variant="outline">Fermer</Button></DialogFooter>
    </DialogContent>
  </Dialog>
);

const RepaymentSchedule = ({ schedule, currency }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-400 uppercase bg-white/5">
                <tr>
                    <th className="px-6 py-3">Échéance</th>
                    <th className="px-6 py-3">Principal</th>
                    <th className="px-6 py-3">Intérêts</th>
                    <th className="px-6 py-3 text-right">Total</th>
                    <th className="px-6 py-3 text-right">Solde restant</th>
                </tr>
            </thead>
            <tbody>
                {schedule.map((row) => (
                    <tr key={row.number} className="border-b border-white/10 hover:bg-white/5">
                        <td className="px-6 py-4">{row.date}</td>
                        <td className="px-6 py-4 tabular-nums">{formatMontant(row.principal, currency, { decimals: 2 })}</td>
                        <td className="px-6 py-4 tabular-nums">{formatMontant(row.interest, currency, { decimals: 2 })}</td>
                        <td className="px-6 py-4 text-right font-bold text-white tabular-nums">{formatMontant(row.total, currency, { decimals: 2 })}</td>
                        <td className="px-6 py-4 text-right text-gray-400 tabular-nums">{formatMontant(row.balance, currency, { decimals: 2 })}</td>
                    </tr>
                ))}
                {schedule.length === 0 && (
                    <tr><td colSpan="5" className="text-center py-8 text-gray-500">Échéancier non disponible.</td></tr>
                )}
            </tbody>
        </table>
    </div>
);

const RebalanceDialog = ({ open, onOpenChange, subwallet, subwallets, onRebalance, currency }) => {
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const { toast } = useToast();

  const others = subwallets.filter(sw => sw.id !== subwallet?.id);

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!toId || !amt || amt <= 0 || amt > subwallet.balance) {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Montant invalide ou solde insuffisant.' });
      return;
    }
    onRebalance(subwallet.id, Number(toId), amt);
    onOpenChange(false); setToId(''); setAmount('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white">
        <DialogHeader><DialogTitle className="gradient-text">Réajuster entre modules</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Depuis</Label><Input value={subwallet?.label} disabled className="bg-white/10" /></div>
          <div><Label>Solde disponible</Label><Input value={formatMontant(subwallet?.balance, currency, { decimals: 2 })} disabled className="bg-white/10" /></div>
          <div><Label>Vers le module</Label><Select onValueChange={setToId} value={toId}><SelectTrigger className="bg-white/5"><SelectValue placeholder="Sélectionner un module..." /></SelectTrigger><SelectContent className="glass-effect">{others.map(sw => <SelectItem key={sw.id} value={String(sw.id)}>{sw.label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Montant ({currency})</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="bg-white/5" /></div>
        </div>
        <DialogFooter><Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">Réajuster</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const GestionCreditsClient = ({ approvedCredit, refreshCredit }) => {
  const [activeSubwallet, setActiveSubwallet] = useState(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [rebalanceDialogOpen, setRebalanceDialogOpen] = useState(false);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const { toast } = useToast();

  useEffect(() => { api.suppliers.list().then(setSuppliers).catch(() => {}); }, []);

  if (!approvedCredit) {
    return (
      <div className="text-center glass-effect p-12 rounded-2xl">
        <Info className="w-16 h-16 mx-auto text-blue-400 mb-4" />
        <h2 className="text-2xl font-bold text-white">Aucun crédit approuvé</h2>
        <p className="text-gray-400 mt-2">Soumettez une demande de crédit pour commencer.</p>
      </div>
    );
  }

  const handleTransfer = async (subwalletId, amount, supplier, description) => {
    try {
      await api.portfolio.mine.pay(approvedCredit.id, subwalletId, amount, supplier, description);
      await refreshCredit();
      toast({ title: 'Succès', description: `Paiement de ${amount} ${approvedCredit.currency} à ${supplier} exécuté.` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleRebalance = async (fromId, toId, amount) => {
    try {
      await api.portfolio.mine.rebalance(approvedCredit.id, fromId, toId, amount);
      await refreshCredit();
      toast({ title: 'Réajustement effectué' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleOpenTransferDialog = (subwallet) => {
    setActiveSubwallet(subwallet);
    setTransferDialogOpen(true);
  };

  const handleOpenRebalanceDialog = (subwallet) => {
    setActiveSubwallet(subwallet);
    setRebalanceDialogOpen(true);
  };

  const subwalletLabel = (id) => approvedCredit.subwallets.find(sw => sw.id === id)?.label || '—';

  const InfoCard = ({ icon: Icon, label, value, iconBg, onClick, isButton = false }) => (
    <div className={`bg-slate-800/50 p-3 rounded-lg flex items-center gap-3 ${isButton ? 'cursor-pointer hover:bg-slate-700/80 transition-colors' : ''}`} onClick={onClick}>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className="w-4 h-4 text-white" />
        </div>
        <div>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="font-semibold text-white">{value}</p>
        </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="glass-effect p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">Crédit: {approvedCredit.type}</h3>
                <p className="text-gray-400 mb-4">Total Approuvé: <span className="font-bold text-emerald-400">{formatMontant(approvedCredit.amountApproved, approvedCredit.currency, { decimals: 0 })}</span></p>
              </div>
              <Button size="sm" variant="outline" className="border-white/20 hover:bg-white/10" onClick={() => setContractDialogOpen(true)}>
                  <FileSignature className="w-4 h-4 mr-2" /> Voir Contrat
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <InfoCard icon={User} label="Gestionnaire" value={approvedCredit.manager || 'Non assigné'} iconBg="bg-blue-500" />
                <InfoCard icon={Landmark} label="Investisseur" value={approvedCredit.investor || 'Non assigné'} iconBg="bg-purple-500" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {approvedCredit.subwallets.map((sub) => {
                const cfg = moduleConfig(sub.moduleKey);
                const Icon = cfg.icon;
                return (
                  <div key={sub.id} className="bg-white/5 p-4 rounded-lg space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2"><Icon className="w-5 h-5" style={{ color: cfg.color }} aria-hidden="true" /><h4 className="font-semibold text-white">{cfg.label}</h4></div>
                      <p className="text-2xl font-bold tabular-nums">{formatMontant(sub.balance, approvedCredit.currency, { decimals: 0 })}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-emerald-600/80 hover:bg-emerald-600 text-xs flex-1" onClick={() => handleOpenTransferDialog(sub)}><Banknote className="w-3 h-3 mr-1"/>Payer</Button>
                      <Button size="sm" variant="outline" className="text-xs border-white/20 hover:bg-white/10 flex-1" onClick={() => handleOpenRebalanceDialog(sub)}><Shuffle className="w-3 h-3 mr-1"/>Réajuster</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Repayment Schedule Section */}
          <div className="glass-effect p-6 rounded-2xl">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-purple-400"/> Échéancier de Remboursement</h3>
            <RepaymentSchedule schedule={approvedCredit.schedule || []} currency={approvedCredit.currency} />
          </div>

        </div>
        <div className="space-y-8">
          <div className="glass-effect p-6 rounded-2xl">
            <h3 className="text-xl font-bold text-white mb-4">Garanties Enregistrées</h3>
            <div className="space-y-3">
              {approvedCredit.guarantees.map(g => {
                // `guaranteeConfig` résout aussi les alias hérités (actif, immobilier…).
                const cfg = guaranteeConfig(g.type);
                const Icon = cfg.icon;
                return (<div key={g.id} className="bg-white/5 p-3 rounded-lg flex items-center gap-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{backgroundColor: `${cfg.color}20`}}><Icon className="w-4 h-4" style={{color: cfg.color}}/></div><div><p className="font-semibold text-sm">{cfg.label}</p><p className="text-xs text-gray-400">{g.description || ''}</p></div></div>)
              })}
              {approvedCredit.guarantees.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Aucune garantie enregistrée.</p>}
            </div>
          </div>
        </div>
      </div>
      <div className="glass-effect p-6 rounded-2xl">
        <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2"><History/> Historique des Transactions</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-xs text-gray-400 uppercase bg-white/5"><tr><th scope="col" className="px-6 py-3">Date</th><th scope="col" className="px-6 py-3">Module</th><th scope="col" className="px-6 py-3">Bénéficiaire</th><th scope="col" className="px-6 py-3 text-right">Montant</th><th scope="col" className="px-6 py-3 text-center">Statut</th></tr></thead><tbody>{approvedCredit.transactions.map(t => (<tr key={t.id} className="border-b border-white/10 hover:bg-white/5"><td className="px-6 py-4">{formatDateFr(t.date)}</td><td className="px-6 py-4">{t.subwalletId ? subwalletLabel(t.subwalletId) : t.type}</td><td className="px-6 py-4">{t.ref || '—'}</td><td className="px-6 py-4 text-right font-mono">{formatMontant(t.amount ?? 0, approvedCredit.currency, { decimals: 2 })}</td><td className="px-6 py-4 text-center"><span className="bg-emerald-500/20 text-emerald-300 text-xs font-medium px-2.5 py-0.5 rounded-full">{t.status}</span></td></tr>))}{approvedCredit.transactions.length === 0 && (<tr><td colSpan="5" className="text-center py-8 text-gray-500">Aucune transaction pour le moment.</td></tr>)}</tbody></table></div>
      </div>
      {activeSubwallet && <TransferDialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen} subwallet={activeSubwallet} onTransfer={handleTransfer} currency={approvedCredit.currency} suppliers={suppliers} />}
      {activeSubwallet && <RebalanceDialog open={rebalanceDialogOpen} onOpenChange={setRebalanceDialogOpen} subwallet={activeSubwallet} subwallets={approvedCredit.subwallets} onRebalance={handleRebalance} currency={approvedCredit.currency} />}
      <ContractDialog open={contractDialogOpen} onOpenChange={setContractDialogOpen} contract={{
        id: approvedCredit.id, parties: `${approvedCredit.operator} - AGRICAP`,
        date: approvedCredit.startDate || approvedCredit.date, amount: approvedCredit.amountApproved,
        currency: approvedCredit.currency,
      }} />
    </motion.div>
  );
};


// =================================================================
// ===== MAIN PAGE COMPONENT =======================================
// =================================================================
const Credits = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [approvedCredit, setApprovedCredit] = useState(null);
  const [submittedAppCode, setSubmittedAppCode] = useState(null);
  const [prefill, setPrefill] = useState(null);
  // Code du dossier brouillon : porte les garanties posées avant soumission.
  const [draftCode, setDraftCode] = useState(null);
  const [guaranteeSet, setGuaranteeSet] = useState(null);
  // Causes d'un refus de soumission, une entrée par cause.
  const [submitErrors, setSubmitErrors] = useState([]);
  const [formData, setFormData] = useState({
    demandeur: '', localisation: '', superficie: '', culture: '',
    montant: '', currency: 'USD',
    vcCode: '', nsResult: null, simResult: null, modules: null, totalFinanced: 0,
  });
  // Refs lues par `ensureDraft` : évite de recréer le callback (et donc de
  // relancer les effets enfants) à chaque frappe dans le formulaire.
  // Toutes les demandes du client, pas seulement celle qui est active :
  // sans ça, un dossier refusé ou accordé-non-décaissé n'a aucune surface.
  const [mesDossiers, setMesDossiers] = useState([]);
  const [dossiersEnChargement, setDossiersEnChargement] = useState(true);
  const draftCodeRef = React.useRef(null);
  const formDataRef = React.useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  useEffect(() => {
    if (user?.role === 'client') {
      // Charger le crédit actif via le nouveau module credits
      // Toutes les demandes du client — le tri par état se fait à l'affichage.
      api.credits.list()
        .then(apps => {
          setMesDossiers(apps);
          const actif = apps.find(a => a.status === 'active');
          setApprovedCredit(actif ? _appToLoan(actif) : null);
        })
        .finally(() => setDossiersEnChargement(false))
        .catch(() => {
          // Fallback sur portfolio/mine
          api.portfolio.mine.list()
            .then(loans => setApprovedCredit(loans.length ? loans[0] : null))
            .catch(() => {})
            .finally(() => setDossiersEnChargement(false));
        });
      // Charger les données de préremplissage
      api.credits.prefill()
        .then(data => {
          setPrefill(data);
          setFormData(prev => ({
            ...prev,
            demandeur: data.client?.displayName || prev.demandeur,
            vcCode: data.defaults?.value_chain_code || '',
            superficie: data.defaults?.area_ha ? String(data.defaults.area_ha) : '',
            currency: data.defaults?.currency || 'USD',
          }));
        })
        .catch(() => {});
    }
  }, [user]);

  // Convertit un CreditApplication en forme affichable dans GestionCreditsClient.
  // Les clés suivent `credits/workflow.py::serialize_application`, qui émet du
  // camelCase (`valueChain`, `amountApproved`, `scoreResult`…). Les lectures en
  // snake_case précédentes ne croisaient jamais la réponse : les montants et la
  // filière s'affichaient vides sur des données pourtant présentes.
  const _appToLoan = (app) => ({
    id: app.code,
    type: app.valueChain?.label || 'Crédit Agricole',
    amountApproved: app.amountApproved ?? app.amountRequested ?? 0,
    currency: app.currency,
    manager: app.reviewedBySub || 'AGRICAP',
    investor: '—',
    subwallets: (app.moduleAllocations || []).map((m, i) => ({
      id: i + 1,
      moduleKey: m.module,
      label: m.module.replace(/_/g, ' '),
      allocatedAmount: m.amountFinanced,
      balance: m.amountFinanced,
    })),
    guarantees: app.guarantees?.items?.map(g => ({
      id: g.id,
      type: g.type,
      description: g.asset
        ? `${g.asset.name} — retenu ${formatMontant(g.asset.retainedValue, g.asset.currency)}`
        : g.type === 'epargne'
          ? `${formatMontant(g.holdAmount, g.holdCurrency || app.currency)} bloqués`
          : `${g.guarantorName || '—'} — ${g.status}`,
    })) || [],
    transactions: [],
    schedule: app.scoreResult?.scheduleDraft?.map((s, i) => ({
      number: i + 1, date: `Mois ${s.month}`,
      principal: s.principal, interest: s.interest,
      total: s.payment, balance: s.balance,
    })) || [],
    startDate: app.disbursement?.confirmedAt || app.createdAt,
  });

  const refreshCredit = async () => {
    if (!approvedCredit) return;
    try {
      if (approvedCredit.id?.startsWith?.('CRED-')) {
        const app = await api.credits.get(approvedCredit.id);
        setApprovedCredit(_appToLoan(app));
      } else {
        setApprovedCredit(await api.portfolio.mine.detail(approvedCredit.id));
      }
    } catch (e) { /* silencieux */ }
  };

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, 4));
  const prevStep = (step) => setCurrentStep(prev => step || Math.max(prev - 1, 1));

  /**
   * Crée le dossier en DRAFT au plus tard, et une seule fois.
   *
   * Ce mécanisme existait pour les garanties (poser un gage exige un dossier
   * côté serveur). Le lot 3 le réutilise tel quel : l'ingestion de la feuille
   * de besoins a la même exigence, `dataset_key = fb__{code}` n'ayant de sens
   * qu'attaché à un dossier. Le brouillon est donc créé au premier
   * téléversement — pas à l'ouverture de l'étape, pour ne pas semer des
   * dossiers vides — puis réutilisé par les garanties et la soumission.
   *
   * `needs_sheet_id` a été retiré du corps : il lisait `nsResult.id`, clé que
   * l'API n'a jamais servie (elle renvoie `needsSheetId`, et désormais
   * `needsSourceId`). Le rattachement de la feuille au dossier est fait côté
   * serveur par `parse_and_ingest` (`application.needs_source`).
   */
  const ensureDraft = useCallback(async () => {
    if (draftCodeRef.current) return draftCodeRef.current;
    const fd = formDataRef.current;
    const app = await api.credits.create({
      value_chain_code: fd.vcCode || undefined,
      area_ha: fd.superficie ? parseFloat(fd.superficie) : undefined,
      currency: fd.currency,
      amount_requested: parseFloat(fd.montant) || 0,
      prefill_snapshot: { demandeur: fd.demandeur, localisation: fd.localisation },
    });
    // Un code vide ne doit JAMAIS circuler. `parse/` teste `if application_code:`
    // — une chaîne vide y est fausse et fait basculer l'endpoint sur le parse
    // hérité, en mémoire, sans ingestion `dataio` ni révision. Le client verrait
    // « feuille enregistrée · révision undefined » sur une feuille que le moteur
    // ne lira jamais : un état de succès mensonger, exactement le motif que
    // `moteur-front-analyse` a rencontré avec `applicationCode = ""`.
    // Et le cache `if (draftCodeRef.current)` étant lui aussi testé en vérité,
    // un code vide ferait recréer un brouillon à chaque appel.
    const code = typeof app?.code === 'string' ? app.code.trim() : '';
    if (!code) {
      const err = new Error("Le dossier a été créé sans code exploitable.");
      err.code = 'DRAFT_CODE_MISSING';
      throw err;
    }
    draftCodeRef.current = code;
    setDraftCode(code);
    return code;
  }, []);

  /**
   * Téléverse la feuille de besoins du dossier courant (SPEC §1.4, points 1 et 5).
   *
   * `application_code` bascule l'endpoint en mode SPEC : validation des 6
   * contrôles, ingestion `dataio` (kind `FEUILLE_BESOINS`), nouvelle révision,
   * puis extraction des totaux depuis les `DataRecord`. Les erreurs remontent
   * telles quelles — c'est l'appelant qui les affiche, toutes.
   */
  const uploadNeedsSheet = useCallback(async (file) => {
    const code = await ensureDraft();
    const body = new FormData();
    body.append('file', file);
    body.append('application_code', code);
    return api.credits.parseNeedsSheet(body);
  }, [ensureDraft]);

  const submitApplication = async (finalFormData) => {
    try {
      // 1. Réutiliser le brouillon s'il existe (garanties déjà rattachées),
      //    sinon le créer maintenant.
      const code = await ensureDraft();
      // 2. Soumettre. Le serveur revérifie l'éligibilité des garanties posées.
      await api.credits.submit(code);
      setSubmittedAppCode(code);
      setIsSubmitted(true);
      // Objet "loan-like" pour SuccessMessage
      setApprovedCredit({
        id: code,
        operator: finalFormData.demandeur,
        amountApproved: parseFloat(finalFormData.montant) || finalFormData.totalFinanced,
        currency: finalFormData.currency,
      });
      setSubmitErrors([]);
      toast({ title: '✅ Demande soumise !', description: `Dossier ${code} en cours d'analyse.` });
    } catch (e) {
      // `submit` renvoie une entrée par cause (`APPLICATION_INCOMPLETE` agrège
      // superficie manquante, montant manquant, garantie inéligible…). Les
      // afficher toutes : sinon le client les redécouvre une par une, à chaque
      // tentative.
      const causes = guaranteeErrorList(e);
      setSubmitErrors(causes);
      toast({
        variant: 'destructive',
        title: causes.length > 1 ? `Soumission refusée — ${causes.length} points à corriger` : 'Soumission refusée',
        description: causes.length > 1
          ? 'Le détail est affiché sous la fiche de synthèse.'
          : causes[0].message,
      });
    }
  };

  const resetProcess = () => {
    setCurrentStep(1);
    setIsSubmitted(false);
    setSubmittedAppCode(null);
    draftCodeRef.current = null;
    setDraftCode(null);
    setGuaranteeSet(null);
    setSubmitErrors([]);
    setFormData({
      demandeur: prefill?.client?.displayName || '',
      localisation: '', superficie: '', culture: '', montant: '',
      currency: prefill?.defaults?.currency || 'USD',
      vcCode: prefill?.defaults?.value_chain_code || '',
      nsResult: null, simResult: null, modules: null, totalFinanced: 0,
    });
  };

  /**
   * Simulation adossée aux tables du dossier (SPEC §1.4 point 4, contrat §1).
   *
   * Le corps porte `application_code` et, désormais, `module_financing` : le
   * client choisit la PART demandée par module (% entier), pas les coûts. Depuis
   * le lot 2, le backend charge `application.needs_source`, relit les
   * `DataRecord` de la révision courante pour les COÛTS et **ignore** tout
   * montant du payload — principe 1, ce qui est scoré est ce qui est en base.
   * Le `module_financing` n'ouvre aucune brèche : il ne fixe pas un coût, il
   * pondère la demande (`part = cout_fichier × pct/100`), et le montant scoré
   * devient `Σ parts demandées`, calculé côté serveur.
   *
   * Les erreurs ne sont plus avalées : un 422 `NEEDS_SOURCE_MISSING` doit se
   * voir à l'écran, pas produire un score vide sans explication.
   *
   * @param {Record<string, number>} [moduleFinancing] part demandée par module, en %
   */
  const runSimulation = useCallback(async (moduleFinancing) => {
    const code = await ensureDraft();
    const payload = { application_code: code };
    if (moduleFinancing && Object.keys(moduleFinancing).length > 0) {
      payload.module_financing = moduleFinancing;
    }
    return api.credits.simulate(payload);
  }, [ensureDraft]);

  const renderClientApplicationFlow = () => {
    if (isSubmitted && approvedCredit) { return <SuccessMessage loan={approvedCredit} reset={resetProcess} />; }
    switch (currentStep) {
      case 1: return <DemandeInitiale formData={formData} setFormData={setFormData} nextStep={nextStep} prefill={prefill} />;
      case 2: return <SimulateurIntelligent formData={formData} setFormData={setFormData} nextStep={nextStep} prevStep={prevStep} uploadNeedsSheet={uploadNeedsSheet} runSimulation={runSimulation} />;
      case 3: return <ConfigurationGaranties nextStep={nextStep} prevStep={prevStep} draftCode={draftCode} ensureDraft={ensureDraft} onGuaranteesChange={setGuaranteeSet} />;
      case 4: return <FicheSynthese formData={formData} prevStep={prevStep} submitApplication={() => submitApplication(formData)} guaranteeSet={guaranteeSet} submitErrors={submitErrors} />;
      default: return null;
    }
  };

  const renderClientView = () => (
    <Tabs defaultValue="gestion" className="w-full">
      <TabsList className="grid w-full grid-cols-3 bg-white/5">
        <TabsTrigger value="gestion">Gérer mes crédits</TabsTrigger>
        <TabsTrigger value="demandes">Mes demandes de crédit</TabsTrigger>
        <TabsTrigger value="demande">Demander un crédit</TabsTrigger>
      </TabsList>
      {/* Le crédit accepté (GestionCreditsClient) et la liste des demandes
          étaient empilés dans un seul onglet. Séparés : « Mes demandes de
          crédit » est désormais son propre onglet, à côté du crédit accepté. */}
      <TabsContent value="gestion" className="pt-6 space-y-8">
        <GestionCreditsClient approvedCredit={approvedCredit} refreshCredit={refreshCredit} />
      </TabsContent>
      <TabsContent value="demandes" className="pt-6">
        <MesDossiers dossiers={mesDossiers} chargement={dossiersEnChargement} />
      </TabsContent>
      <TabsContent value="demande" className="pt-6">
          {!(isSubmitted && approvedCredit) && (
              <div className="flex justify-center items-center gap-4 mb-8">
                  {STEPS.map(step => (
                      <React.Fragment key={step.id}>
                      <div className="flex flex-col items-center text-center">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${currentStep >= step.id ? 'bg-emerald-500 border-emerald-400' : 'bg-white/10 border-gray-600'}`}>
                          {currentStep > step.id ? <Check className="w-6 h-6 text-white"/> : <span className="font-bold">{step.id}</span>}
                          </div>
                          <p className={`mt-2 text-xs font-semibold ${currentStep >= step.id ? 'text-white' : 'text-gray-500'}`}>{step.name}</p>
                      </div>
                      {step.id < STEPS.length && <div className={`flex-1 h-1 rounded-full ${currentStep > step.id ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>}
                      </React.Fragment>
                  ))}
              </div>
          )}
          <AnimatePresence mode="wait">{renderClientApplicationFlow()}</AnimatePresence>
      </TabsContent>
    </Tabs>
  );

  const renderAdminView = () => (
    <AdminCreditsDashboard />
  );

  return (
    <Layout>
      <Helmet><title>Crédits - AGRICAP FINTECH</title><meta name="description" content="Demandez et gérez votre crédits agricoles." /></Helmet>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-4xl font-bold gradient-text mb-2">
            {user?.role === 'admin' ? 'Module Crédits Agricoles' : 'Espace Crédits'}
        </h1>
        <p className="text-gray-400">
            {user?.role === 'admin' ? 'Gestion, suivi et pilotage du cycle de vie des crédits.' : 'Suivez vos demandes et gérez les fonds alloués.'}
        </p>
      </motion.div>
      {user?.role === 'admin' ? renderAdminView() : renderClientView()}
    </Layout>
  );
};

export default Credits;