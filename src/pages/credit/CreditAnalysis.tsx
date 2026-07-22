import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import {
  dimensionRetenueParLeServeur, etatDimensionProjet, libelleUnite,
} from '@/components/simulateur/dimension';
import { CriteresClient } from '@/components/simulateur/SimulationResult';
import type { CreditPrefillResult, NeedsParseResult, CreditSimulateResult } from '@/types/api';

// ─── Step indicator ────────────────────────────────────────────────────────────
const STEPS = ['Infos initiales', 'Feuille de besoins', 'Simulation', 'Soumission'];

const StepBar: React.FC<{ current: number }> = ({ current }) => (
  <div className="flex items-center gap-2 mb-8">
    {STEPS.map((label, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
              ${done ? 'bg-emerald-500 border-emerald-400 text-white'
                : active ? 'border-primary text-primary'
                : 'border-gray-600 text-gray-500'}`}>
              {done ? '✓' : i + 1}
            </div>
            <p className={`mt-1 text-xs text-center ${active ? 'text-white font-medium' : 'text-gray-500'}`}>{label}</p>
          </div>
          {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${done ? 'bg-emerald-500' : 'bg-gray-700'}`} />}
        </React.Fragment>
      );
    })}
  </div>
);

// ─── CreditAnalysis ────────────────────────────────────────────────────────────
const CreditAnalysis: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0 state
  const [prefill, setPrefill] = useState<CreditPrefillResult | null>(null);
  const [clientSub, setClientSub] = useState('');
  // Bénéficiaires possibles. Le personnel est exclu : le serveur refuse
  // (BENEFICIAIRE_INTERNE), donc le proposer serait offrir un choix voué à
  // l'échec. `isStaffRole` n'étant pas servi par `/rbac/users`, on s'appuie sur
  // le niveau hiérarchique — 0 = niveau client dans le registre RBAC.
  const [clients, setClients] = useState<Array<{ sub: string; name: string; email: string; roleLabel: string }>>([]);
  const [clientsErreur, setClientsErreur] = useState('');
  const [vcCode, setVcCode] = useState('');
  // Dimension du projet : la grandeur à laquelle le référentiel de la filière
  // rapporte ses coûts unitaires. Ce n'est PLUS une superficie en hectares par
  // construction — une filière apicole se dimensionne en ruches, une
  // bioconversion en m². `uniteSaisie` mémorise l'unité dans laquelle la valeur
  // a été tapée : c'est ce qui permet de détecter, quand le serveur révèle
  // l'unité de la filière, que la valeur ne veut plus dire ce qu'elle disait.
  const [quantiteReference, setQuantiteReference] = useState('');
  const [uniteSaisie, setUniteSaisie] = useState('');
  const [amountRequested, setAmountRequested] = useState('');
  const [currency, setCurrency] = useState('USD');

  // Step 1 state
  const [nsFile, setNsFile] = useState<File | null>(null);
  const [nsResult, setNsResult] = useState<NeedsParseResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 2 state
  const [simResult, setSimResult] = useState<CreditSimulateResult | null>(null);
  const [guaranteeType, setGuaranteeType] = useState<'epargne' | 'morale' | ''>('');

  // Step 3: created application code
  const [appCode, setAppCode] = useState<string | null>(null);

  // ── Step 0: Load prefill on mount ──
  useEffect(() => {
    api.credits.prefill()
      .then((data) => {
        setPrefill(data);
        if (data.defaults.value_chain_code) setVcCode(data.defaults.value_chain_code);
        if (data.defaults.area_ha) {
          // Le préremplissage ne connaît qu'une superficie : elle n'est donc
          // reprise QUE comme une valeur exprimée en hectares, et l'unité de
          // saisie l'accompagne. Si la filière se mesure autrement, l'écart
          // sera signalé au lieu d'être hérité en silence.
          setQuantiteReference(String(data.defaults.area_ha));
          setUniteSaisie('ha');
        }
        if (data.defaults.currency) setCurrency(data.defaults.currency);
      })
      .catch(() => {}); // prefill optionnel

    // Liste des bénéficiaires possibles. `level === 0` = niveau client au
    // registre RBAC ; le personnel (niveaux 1 à 5) est écarté.
    api.rbac.users.list()
      .then((users) => {
        const eligibles = (users || []).filter((u) => u.level === 0 && u.status !== 'Suspendu');
        setClients(eligibles.map((u) => ({
          sub: u.sub, name: u.name, email: u.email, roleLabel: u.roleLabel,
        })));
        if (!eligibles.length) {
          setClientsErreur(
            "Aucun client enregistré pour l'instant. Un crédit doit être au nom "
            + "d'un client : créez-en un depuis « Utilisateurs » avant de continuer."
          );
        }
      })
      .catch(() => setClientsErreur(
        "La liste des clients n'a pas pu être chargée. Sans bénéficiaire, la "
        + "demande sera refusée : réessayez avant de poursuivre."
      ));
  }, []);

  // ── Dimension du projet, dans l'unité de la filière ──
  // L'unité vient du serveur (filière du préremplissage, puis référentiel
  // réellement résolu par la simulation) — jamais d'une table filière → unité
  // recopiée ici, qui serait un référentiel de plus dans le navigateur.
  const valueChain = useMemo(
    () => prefill?.valueChains.find((vc) => vc.code === vcCode) ?? null,
    [prefill, vcCode],
  );
  const dimension = useMemo(
    () => etatDimensionProjet({
      quantite: quantiteReference,
      uniteSaisie,
      valueChain,
      refData: simResult?.refData,
    }),
    [quantiteReference, uniteSaisie, valueChain, simResult],
  );
  // Ce que le SERVEUR a retenu : tant que `simulate_scoring` ne relaie pas la
  // dimension canonique, un dossier apicole est simulé en hectares sans que
  // rien ne le dise. On le dit.
  const dimensionServeur = useMemo(
    () => dimensionRetenueParLeServeur({
      refData: simResult?.refData,
      quantiteEnvoyee: quantiteReference,
      uniteEnvoyee: dimension.uniteEffective,
    }),
    [simResult, quantiteReference, dimension.uniteEffective],
  );

  const majQuantite = (valeur: string) => {
    setQuantiteReference(valeur);
    setUniteSaisie(dimension.uniteEffective);
  };

  // ── Step 0 → 1: validate form ──
  const handleStep0Next = () => {
    if (!amountRequested || parseFloat(amountRequested) <= 0) {
      setError('Veuillez saisir un montant demandé positif.');
      return;
    }
    if (dimension.verdict.bloquant) {
      setError(dimension.verdict.message ?? 'Dimension du projet à corriger.');
      return;
    }
    setError(null);
    setStep(1);
  };

  // ── Step 1: Parse needs sheet ──
  const handleParseSheet = async () => {
    if (!nsFile) { setError('Veuillez choisir un fichier Excel.'); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', nsFile);
      if (vcCode) fd.append('value_chain_code', vcCode);
      // `parse/` ne connaît que `area_ha` (il alimente `NeedsSheet.area_ha`) :
      // on ne le renseigne donc QUE pour les filières mesurées en hectares.
      // Y écrire 30 ruches ferait entrer « 30 ha » dans la feuille.
      if (dimension.payload.area_ha != null) fd.append('area_ha', String(dimension.payload.area_ha));
      if (currency) fd.append('currency', currency);
      const result = await api.credits.parseNeedsSheet(fd);
      setNsResult(result);
      // Pre-fill amount from needs sheet total if not yet set
      if (!amountRequested && result.grandTotal) {
        setAmountRequested(String(result.grandTotal));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur lors du parsing.');
    } finally {
      setBusy(false);
    }
  };

  // ── Step 2: Simulate scoring ──
  const handleSimulate = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.credits.simulate({
        value_chain_code: vcCode || undefined,
        needs_sheet_id: nsResult?.id,
        ...dimension.payload,
        amount_requested: parseFloat(amountRequested),
        currency,
      });
      setSimResult(result);
      setStep(2);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur de simulation.');
    } finally {
      setBusy(false);
    }
  };

  // ── Step 3: Create + submit application ──
  const handleCreateAndSubmit = async () => {
    setBusy(true); setError(null);
    try {
      // Create draft
      const app = await api.credits.create({
        client_sub: clientSub || undefined,
        value_chain_code: vcCode || undefined,
        ...dimension.payload,
        currency,
        amount_requested: parseFloat(amountRequested),
        needs_sheet_id: nsResult?.id,
        guarantee_type: guaranteeType || undefined,
        prefill_snapshot: prefill
          ? {
            vcCode,
            quantiteReference,
            uniteReference: dimension.uniteEffective,
            amountRequested,
          }
          : {},
      });
      setAppCode(app.code);
      // Submit
      await api.credits.submit(app.code);
      setStep(3);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur lors de la soumission.');
    } finally {
      setBusy(false);
    }
  };

  const scoreColor = (s: number) =>
    s >= 70 ? 'text-emerald-400' : s >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="min-h-screen bg-background text-slate-100 p-6">
      <Helmet><title>Nouvelle demande de crédit — AGRICAP FINTECH</title></Helmet>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white [&>option]:bg-slate-800 [&>option]:text-white">Nouvelle demande de crédit</h1>
          <div className="flex gap-3 text-sm">
            <Link to="/credit/dossiers" className="text-primary underline">Mes dossiers</Link>
          </div>
        </div>

        <StepBar current={step} />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 mb-6">
            {error}
          </div>
        )}

        {/* ── STEP 0 : Informations initiales ── */}
        {step === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <h2 className="font-bold text-lg">Informations de la demande</h2>

            {prefill && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 text-sm">
                <p className="text-emerald-300 font-medium mb-1">Profil client</p>
                <p>
                  <span className="text-slate-400">Nom :</span>{' '}
                  <span className="font-medium">{prefill.client.displayName}</span>
                  {prefill.debt.debtRatioPct != null && (
                    <> · <span className="text-slate-400">Endettement :</span>{' '}
                      <span className={prefill.debt.debtRatioPct > 60 ? 'text-red-300' : 'text-emerald-300'}>
                        {prefill.debt.debtRatioPct}%
                      </span>
                    </>
                  )}
                </p>
              </div>
            )}

            {/* Bénéficiaire du crédit.
                Le champ `clientSub` existait dans l'état du composant et partait
                dans `api.credits.create`, mais AUCUNE interface ne le remplissait :
                il restait vide, la demande retombait donc sur l'agent connecté,
                et le serveur la refuse désormais (BENEFICIAIRE_INTERNE) — un
                membre du personnel ne peut pas être bénéficiaire de son propre
                crédit. Sans ce sélecteur, le parcours était sans issue.
                Les internes sont exclus de la liste : on ne propose pas un choix
                que le serveur rejettera. */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">
                Bénéficiaire du crédit
              </label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
                value={clientSub}
                onChange={(e) => setClientSub(e.target.value)}
              >
                <option value="">— Choisir le client —</option>
                {clients.map((c) => (
                  <option key={c.sub} value={c.sub}>
                    {c.name || c.email || c.sub}{c.roleLabel ? ` · ${c.roleLabel}` : ''}
                  </option>
                ))}
              </select>
              {clientsErreur ? (
                <p className="text-xs text-amber-300/90 mt-1">{clientsErreur}</p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  Un crédit est toujours au nom d'un client. Le personnel AGRICAP
                  n'apparaît pas dans cette liste : il ne peut pas être bénéficiaire.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Filière</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
                  value={vcCode}
                  onChange={(e) => setVcCode(e.target.value)}
                >
                  <option value="">— Choisir une filière —</option>
                  {prefill?.valueChains.map((vc) => (
                    <option key={vc.code} value={vc.code}>{vc.label}</option>
                  ))}
                </select>
              </div>

              {/* Dimension du projet — l'unité n'est PAS un choix : c'est celle
                  du référentiel de la filière. Un champ « superficie (ha) » en
                  dur rendait tout dossier non agricole indimensionnable
                  autrement que par l'API, et faisait échouer l'analyse en 422
                  DIMENSION_INCOHERENTE sans que personne ne sache pourquoi. */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Dimension du projet
                  {dimension.unite ? ` (${dimension.unite})` : ''}
                </label>
                <div className="flex items-stretch">
                  <input
                    type="number"
                    min="0"
                    className="w-full bg-white/5 border border-white/10 rounded-l-lg px-3 py-2 text-sm"
                    placeholder={dimension.uniteEffective === 'ha' ? 'Ex: 5' : 'Ex: 30'}
                    value={quantiteReference}
                    onChange={(e) => majQuantite(e.target.value)}
                    aria-describedby="aide-dimension"
                  />
                  <span className="px-3 py-2 text-sm text-slate-300 bg-white/10 border border-l-0 border-white/10 rounded-r-lg whitespace-nowrap">
                    {libelleUnite(dimension.uniteEffective, Number(quantiteReference) || 2)
                      || dimension.uniteEffective}
                  </span>
                </div>
                <p id="aide-dimension" className="text-xs text-slate-500 mt-1">
                  {dimension.unite
                    ? `Cette filière se mesure en « ${dimension.unite} »`
                      + `${dimension.source === 'simulation' ? ' (référentiel du moteur)' : ''}.`
                      + ' Aucune conversion n\'est faite : la quantité doit être exprimée dans'
                      + ' cette unité.'
                    : "L'unité de référence de cette filière n'est pas encore servie par le "
                      + 'serveur : la valeur est prise en hectares et sera confrontée au '
                      + 'référentiel à la simulation.'}
                </p>
                {dimension.verdict.etat === 'incoherente' && (
                  <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <p className="text-xs text-red-200">{dimension.verdict.message}</p>
                    <button
                      type="button"
                      className="mt-2 text-xs px-2 py-1 rounded bg-white/10 text-slate-100"
                      onClick={() => { setQuantiteReference(''); setUniteSaisie(dimension.unite ?? ''); }}
                    >
                      Ressaisir en {libelleUnite(dimension.unite, 2) || dimension.unite}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Montant demandé *</label>
                <input
                  type="number"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: 5000"
                  value={amountRequested}
                  onChange={(e) => setAmountRequested(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Devise</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleStep0Next}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-semibold [&>option]:bg-slate-800 [&>option]:text-white"
            >
              Suivant : Feuille de besoins →
            </button>
          </div>
        )}

        {/* ── STEP 1 : Feuille de besoins ── */}
        {step === 1 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <h2 className="font-bold text-lg">Feuille de besoins (Excel)</h2>

            <div className="flex flex-col gap-3">
              <label className="text-xs text-slate-400">
                Fichier Excel de la feuille de besoins (.xlsx)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setNsFile(e.target.files?.[0] ?? null)}
                className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm file:bg-emerald-500/20 file:text-emerald-300 file:border-none file:px-4 file:py-1.5 file:rounded file:mr-3"
              />
              <a
                href={api.credits.templateUrl(vcCode || undefined)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline"
              >
                ↓ Télécharger le gabarit{vcCode ? ` (${vcCode})` : ''}
              </a>
            </div>

            {nsResult && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 space-y-2">
                <p className="text-emerald-300 font-medium text-sm">✓ Feuille parsée avec succès</p>
                <p className="text-sm">Total : <span className="font-bold">{nsResult.grandTotal.toLocaleString('fr-FR')} {nsResult.currency}</span></p>
                {nsResult.area_ha && <p className="text-sm">Superficie : {nsResult.area_ha} ha</p>}
                {nsResult.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {nsResult.warnings.map((w, i) => <p key={i} className="text-xs text-yellow-300">⚠ {w}</p>)}
                  </div>
                )}
                {Object.entries(nsResult.totalByModule).map(([mod, total]) => (
                  <div key={mod} className="flex justify-between text-xs text-slate-300">
                    <span className="capitalize">{mod.replace(/_/g, ' ')}</span>
                    <span>{total.toLocaleString('fr-FR')} {nsResult.currency}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button onClick={() => setStep(0)} className="px-4 py-2 rounded-lg bg-white/10 text-sm">
                ← Retour
              </button>
              <button
                onClick={handleParseSheet}
                disabled={busy || !nsFile}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50 [&>option]:bg-slate-800 [&>option]:text-white"
              >
                {busy ? 'Analyse…' : 'Analyser le fichier'}
              </button>
              {nsResult && (
                <button
                  onClick={handleSimulate}
                  disabled={busy}
                  className="flex-1 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-semibold text-sm disabled:opacity-50 [&>option]:bg-slate-800 [&>option]:text-white"
                >
                  {busy ? 'Simulation…' : 'Simuler le scoring →'}
                </button>
              )}
              {!nsResult && (
                <button
                  onClick={handleSimulate}
                  disabled={busy}
                  className="flex-1 py-2 rounded-lg bg-white/10 text-slate-300 text-sm disabled:opacity-50"
                >
                  Simuler sans feuille →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2 : Résultat simulation + garantie ── */}
        {step === 2 && simResult && (
          <div className="space-y-5">
            {/* Score card */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h2 className="font-bold text-lg mb-4">Résultat de simulation</h2>
              {/* Le serveur ne sert PAS de score quand aucun critère n'est
                  calculable : il refuse de laisser passer un 0 qui se lirait
                  comme une mauvaise note. L'écran affiche le motif, pas un
                  chiffre inventé. */}
              {simResult.score === null && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm text-amber-100">
                    {simResult.unavailable?.message
                      || "Le score n'est pas calculable en l'état ; le détail par critère en donne la raison."}
                  </p>
                  {simResult.unavailable?.code && (
                    <p className="text-[11px] text-amber-300/80 mt-1 font-mono">{simResult.unavailable.code}</p>
                  )}
                </div>
              )}
              {/* La dimension effectivement retenue par le serveur : tant qu'il
                  ignore `quantite_reference`, un dossier non agricole est simulé
                  sur une autre grandeur que celle saisie — et la fiabilité
                  technique sort « non calculable » sans explication visible. */}
              {dimensionServeur && !dimensionServeur.retenue && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm text-amber-100">
                    Le serveur n'a pas retenu la dimension saisie : il a scoré sur{' '}
                    <span className="font-semibold">
                      {dimensionServeur.quantiteServeur ?? '—'}{' '}
                      {libelleUnite(dimensionServeur.uniteServeur, dimensionServeur.quantiteServeur)
                        || dimensionServeur.uniteServeur || '—'}
                    </span>{' '}
                    au lieu de {quantiteReference || '—'}{' '}
                    {libelleUnite(dimension.uniteEffective, Number(quantiteReference) || 2)}.
                    La fiabilité technique de cette simulation est à lire avec cette réserve.
                  </p>
                </div>
              )}
              <div className="flex items-center gap-6 mb-4">
                <div className="text-center">
                  <p className="text-xs text-slate-400">Score estimé</p>
                  <p className={`text-5xl font-black ${simResult.score == null ? 'text-slate-500' : scoreColor(simResult.score)}`}>
                    {simResult.score ?? '—'}
                  </p>
                  <p className="text-xs text-slate-400">/100</p>
                </div>
                <div>
                  <p className={`text-xl font-bold ${simResult.eligible ? 'text-emerald-400' : 'text-red-400'}`}>
                    {simResult.eligible ? '✓ Éligible au crédit' : '✗ Non éligible'}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">{simResult.valuationNote}</p>
                  {simResult.proposedRate && (
                    <p className="text-sm mt-1">Taux indicatif : <span className="font-bold text-blue-300">{simResult.proposedRate}% / an</span></p>
                  )}
                  {/* Ex-« Score minimum requis : 60 ». C'est un SEUIL du moteur,
                      et cet écran figure dans le menu du CLIENT (« Analyse de
                      crédit ») : le principe 7 l'interdit — connaître la barre,
                      c'est pouvoir viser la barre. L'éligibilité, elle, reste
                      annoncée : c'est le verdict, pas la règle. */}
                </div>
              </div>

              {/* Détail par critère en version CLIENT (libellés, critères non
                  évalués), pas la grille pondérée : ce parcours est ouvert au
                  demandeur. Le détail chiffré — points, poids, bandes, plages —
                  vit sur `/credit/dossiers/<code>/scoring`, réservé au staff. */}
              <div className="mt-2">
                <CriteresClient simResult={simResult} />
              </div>
            </div>

            {/* Guarantee selection */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-3">
              <h3 className="font-bold">Type de garantie</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { value: 'epargne', label: 'Nantissement Épargne', desc: 'Blocage d\'un montant sur votre épargne' },
                  { value: 'morale', label: 'Caution Morale', desc: 'Engagement d\'un tiers garant (7j pour confirmer)' },
                ].map((g) => (
                  <label
                    key={g.value}
                    className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all
                      ${guaranteeType === g.value
                        ? 'bg-emerald-500/10 border-emerald-500/50'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                  >
                    <input
                      type="radio"
                      name="guarantee"
                      value={g.value}
                      checked={guaranteeType === g.value}
                      onChange={() => setGuaranteeType(g.value as 'epargne' | 'morale')}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="font-medium text-sm">{g.label}</p>
                      <p className="text-xs text-slate-400">{g.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg bg-white/10 text-sm">
                ← Retour
              </button>
              <button
                onClick={handleCreateAndSubmit}
                disabled={busy || !simResult.eligible}
                className="flex-1 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold disabled:opacity-50 [&>option]:bg-slate-800 [&>option]:text-white"
              >
                {busy ? 'Soumission…' : '✓ Créer et soumettre la demande'}
              </button>
            </div>
            {!simResult.eligible && (
              <p className="text-xs text-red-300 text-center">Le score ne satisfait pas le seuil minimum requis.</p>
            )}
          </div>
        )}

        {/* ── STEP 3 : Succès ── */}
        {step === 3 && appCode && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-10 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto text-3xl text-white [&>option]:bg-slate-800 [&>option]:text-white">
              ✓
            </div>
            <h2 className="text-2xl font-bold text-white [&>option]:bg-slate-800 [&>option]:text-white">Demande soumise !</h2>
            <p className="text-slate-400">
              Votre dossier <span className="text-emerald-300 font-mono font-bold">{appCode}</span> est maintenant
              en cours d'analyse. Vous serez notifié par SMS dès qu'une décision est prise.
            </p>
            <div className="flex gap-3 justify-center mt-6">
              <button
                onClick={() => navigate(`/credit/dossiers/${appCode}`)}
                className="px-6 py-2 rounded-lg bg-primary text-white font-semibold text-sm [&>option]:bg-slate-800 [&>option]:text-white"
              >
                Voir le dossier
              </button>
              <button
                onClick={() => {
                  setStep(0); setNsFile(null); setNsResult(null); setSimResult(null);
                  setAmountRequested(''); setQuantiteReference(''); setUniteSaisie('');
                  setGuaranteeType(''); setAppCode(null);
                }}
                className="px-6 py-2 rounded-lg bg-white/10 text-sm"
              >
                Nouvelle demande
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditAnalysis;
