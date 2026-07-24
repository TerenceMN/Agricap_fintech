import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api } from '@/services/api';
import {
  Loader2, RefreshCw, AlertTriangle, ShieldAlert, ServerCrash, FileQuestion, Lock, History,
} from 'lucide-react';
import ComparaisonAnalyse from './ComparaisonAnalyse';
import DiagnosticDiffere from './DiagnosticDiffere';
import EcheancierServeur from './EcheancierServeur';
import { readLoanRates } from '@/lib/loanRateDisplay';
import {
  formatRatio2, formatPourcent, formatDateHeureFr, NULL_DISPLAY,
  MODE_DIFFERE_LABEL, MODE_DIFFERE_AIDE, RECOMMANDATION_LABEL,
} from './format';

/**
 * Simulateur de l'analyste (SPEC §8c).
 *
 * L'analyste ajuste durée / différé / taux / mode de différé, clique
 * « Ré-analyser », et le SERVEUR renvoie une analyse complète : DSCR, DSCR
 * stressé, score, recommandation, échéancier. Le front affiche, compare, et ne
 * calcule rien.
 *
 * Trois choix structurants :
 *
 * 1. **Aucun chiffre financier n'est produit ici.** L'annexe A de la SPEC donne
 *    les formules de l'échéancier — elles servent à comprendre l'affichage, pas
 *    à le reproduire. Un échéancier « approximatif » côté navigateur à côté de
 *    l'échéancier opposable du moteur, c'est la double réalité que ce module
 *    passe son temps à éliminer.
 *
 * 2. **Le 404 est un état, pas une panne.** Tant que `POST .../reanalyser/`
 *    n'est pas livré (aucune route `analyse` dans `backend/credits/urls.py` à ce
 *    jour), l'écran le dit en clair au lieu d'afficher un toast d'erreur
 *    générique ou, pire, un résultat fabriqué.
 *
 * 3. **La permission est vérifiée par le serveur** (CLAUDE.md §7.2). Le front ne
 *    devine aucun code de capacité RBAC : il appelle l'endpoint protégé et
 *    affiche honnêtement un refus 403 s'il en reçoit un.
 */

const STATUT = {
  CHARGEMENT: 'chargement',
  PRET: 'pret',
  ABSENTE: 'absente',      // 404 — moteur non livré OU aucune analyse encore exécutée
  INTERDIT: 'interdit',    // 403 — permission refusée par le serveur
  ERREUR: 'erreur',
  SANS_DOSSIER: 'sansDossier', // prêt non rattaché à une demande de crédit
};

/** Paramètres par défaut du formulaire quand aucune analyse n'existe encore.
 *  Ce ne sont pas des valeurs métier : ce sont les caractéristiques du prêt déjà
 *  affichées ailleurs dans le modal, reprises pour éviter une saisie à blanc. */
const parametresDepuisCredit = (credit) => ({
  dureeMois: Number(credit?.duration) || 12,
  differeMois: 0,
  // Ce champ valait `Number(credit.rate) * 12`.
  //
  // Ce n'était pas de l'affichage : cette valeur part dans
  // `POST .../reanalyser/` et ressort en échéancier, en DSCR et en
  // recommandation — que l'analyste lit ensuite comme des chiffres serveur. Une
  // annualisation fabriquée au navigateur devenait ainsi l'hypothèse d'une
  // analyse opposable, sans que rien ne dise d'où venait le taux.
  //
  // Le serveur sert le taux annuel du prêt (`annualRate`, figé par
  // `portfolio/rates.py`) : on le reprend TEL QUEL. Quand il ne le sert pas, le
  // champ reste VIDE et l'analyste renseigne le taux qu'il simule — un taux
  // déduit d'un mensuel arrondi à 6 décimales ne vaut pas mieux qu'une saisie,
  // et il aurait l'air d'une donnée du dossier.
  tauxAnnuel: readLoanRates(credit).annual ?? '',
  modeDiffere: 'interets_seuls',
});

const parametresDepuisAnalyse = (analyse) => ({
  dureeMois: analyse?.parametres?.dureeMois ?? 0,
  differeMois: analyse?.parametres?.differeMois ?? 0,
  tauxAnnuel: analyse?.parametres?.tauxAnnuel ?? 0,
  modeDiffere: analyse?.parametres?.modeDiffere || 'interets_seuls',
});

const SimulateurMoteur = ({ code, credit, actif = true }) => {
  const [statut, setStatut] = useState(STATUT.CHARGEMENT);
  const [messageErreur, setMessageErreur] = useState('');
  const [runs, setRuns] = useState([]);           // analyses connues, dans l'ordre d'obtention
  const [params, setParams] = useState(() => parametresDepuisCredit(credit));
  const [busy, setBusy] = useState(false);
  const [erreurRun, setErreurRun] = useState(null);
  const [baseComparaison, setBaseComparaison] = useState('precedente'); // 'precedente' | 'initiale'

  // Taux du prêt tels que le SERVEUR les sert — sert à dire d'où vient (ou ne
  // vient pas) la valeur pré-remplie du champ « Taux annuel ».
  const tauxCredit = useMemo(() => readLoanRates(credit), [credit]);

  const courante = runs.length ? runs[runs.length - 1] : null;
  const initiale = runs.length ? runs[0] : null;
  const precedente = runs.length > 1 ? runs[runs.length - 2] : null;
  const reference = baseComparaison === 'initiale' ? initiale : precedente;

  // ── Chargement de l'analyse de référence ────────────────────────────────
  const charger = useCallback(async () => {
    if (!code) { setStatut(STATUT.SANS_DOSSIER); return; }
    setStatut(STATUT.CHARGEMENT);
    setErreurRun(null);
    try {
      const a = await api.credits.analyse(code);
      setRuns([a]);
      setParams(parametresDepuisAnalyse(a));
      setStatut(STATUT.PRET);
    } catch (e) {
      const status = e?.status;
      if (status === 404) setStatut(STATUT.ABSENTE);
      else if (status === 403 || status === 401) setStatut(STATUT.INTERDIT);
      else setStatut(STATUT.ERREUR);
      setMessageErreur(e?.message || 'Erreur inconnue');
      setRuns([]);
      setParams(parametresDepuisCredit(credit));
    }
  }, [code, credit]);

  useEffect(() => { if (actif) charger(); }, [actif, charger]);

  // ── Validations de saisie (le serveur reste l'autorité) ─────────────────
  const invalide = useMemo(() => {
    const d = Number(params.dureeMois);
    const f = Number(params.differeMois);
    const t = Number(params.tauxAnnuel);
    if (!Number.isFinite(d) || d < 1) return 'La durée doit valoir au moins 1 mois.';
    if (!Number.isFinite(f) || f < 0) return 'Le différé ne peut pas être négatif.';
    if (f >= d) return "Le différé doit rester strictement inférieur à la durée : sans mois d'amortissement, il n'y a pas d'échéancier.";
    // Champ vide : `Number('')` vaut 0, et une analyse lancée « à 0 % » par
    // omission ne se distinguerait pas d'une analyse voulue à 0 %. On exige la
    // saisie plutôt que de laisser un zéro implicite entrer dans le moteur.
    if (params.tauxAnnuel === '' || params.tauxAnnuel === null || params.tauxAnnuel === undefined) {
      return "Le taux annuel n'est pas servi par le serveur pour ce prêt : saisissez le taux annuel à simuler.";
    }
    if (!Number.isFinite(t) || t < 0) return 'Le taux annuel ne peut pas être négatif.';
    return null;
  }, [params]);

  const modifie = useMemo(() => {
    if (!courante) return true;
    const p = parametresDepuisAnalyse(courante);
    return Number(p.dureeMois) !== Number(params.dureeMois)
      || Number(p.differeMois) !== Number(params.differeMois)
      || Number(p.tauxAnnuel) !== Number(params.tauxAnnuel)
      || p.modeDiffere !== params.modeDiffere;
  }, [courante, params]);

  // ── Ré-analyse : le moteur s'exécute côté serveur, on affiche sa sortie ──
  const reanalyser = async () => {
    if (!code || invalide) return;
    setBusy(true);
    setErreurRun(null);
    try {
      const a = await api.credits.reanalyser(code, {
        duree_mois: Number(params.dureeMois),
        differe_mois: Number(params.differeMois),
        taux_annuel: Number(params.tauxAnnuel),
        mode_differe: params.modeDiffere,
      });
      setRuns((prev) => [...prev, a]);
      setParams(parametresDepuisAnalyse(a));
      setStatut(STATUT.PRET);
    } catch (e) {
      setErreurRun({ status: e?.status ?? null, message: e?.message || 'Erreur inconnue' });
    } finally {
      setBusy(false);
    }
  };

  const majParam = (champ, valeur) => setParams((p) => ({ ...p, [champ]: valeur }));

  // ── États explicites ────────────────────────────────────────────────────
  if (statut === STATUT.SANS_DOSSIER) {
    return (
      <Alert className="border-slate-600 bg-slate-800/40 text-slate-300">
        <FileQuestion className="h-4 w-4" />
        <AlertTitle>Aucune demande de crédit rattachée</AlertTitle>
        <AlertDescription className="text-sm">
          Ce prêt n'est lié à aucune demande de crédit (<code>applicationCode</code> vide) :
          le moteur d'analyse n'a pas de dossier — plan de financement, flux de trésorerie,
          référentiel de filière — sur lequel s'exécuter. Le simulateur d'analyse ne
          s'applique qu'aux prêts issus du pipeline de demande.
        </AlertDescription>
      </Alert>
    );
  }

  if (statut === STATUT.CHARGEMENT) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l'analyse serveur…
      </div>
    );
  }

  if (statut === STATUT.INTERDIT) {
    return (
      <Alert className="border-red-500/40 bg-red-900/10 text-red-200">
        <Lock className="h-4 w-4" />
        <AlertTitle>Accès refusé par le serveur</AlertTitle>
        <AlertDescription className="text-sm space-y-2">
          <p>
            Le serveur refuse l'analyse de ce dossier pour votre compte
            {messageErreur ? ` (« ${messageErreur} »)` : ''}. L'analyse expose les barèmes,
            les plages du référentiel et les seuils du moteur : elle est réservée aux rôles
            habilités.
          </p>
          <p className="text-xs text-red-300/70">
            Aucun bouton de ré-analyse n'est proposé : la permission est vérifiée côté
            serveur, le front ne la contourne pas.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  const enteteEtat = (() => {
    if (statut === STATUT.ABSENTE) {
      return (
        <Alert className="border-amber-500/40 bg-amber-900/10 text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Aucune analyse servie pour ce dossier</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              Le serveur répond <strong>404</strong> sur
              <code className="mx-1">GET /api/credits/applications/{code}/analyse/</code>.
              Deux causes, indiscernables depuis le navigateur : le moteur d'analyse n'est pas
              encore déployé, ou aucune analyse n'a encore été exécutée sur ce dossier.
            </p>
            <p className="text-xs text-amber-300/70">
              Le bouton ci-dessous interroge le serveur. S'il répond 404 à son tour, c'est le
              moteur qui manque — et rien n'aura été écrit nulle part.
            </p>
          </AlertDescription>
        </Alert>
      );
    }
    if (statut === STATUT.ERREUR) {
      return (
        <Alert className="border-red-500/40 bg-red-900/10 text-red-200">
          <ServerCrash className="h-4 w-4" />
          <AlertTitle>Analyse indisponible</AlertTitle>
          <AlertDescription className="text-sm flex flex-col gap-2">
            <span>{messageErreur}</span>
            <div>
              <Button size="sm" variant="outline" onClick={charger} className="border-red-500/40 text-red-200 hover:bg-red-900/20">
                <RefreshCw className="w-3 h-3 mr-2" /> Réessayer
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      );
    }
    return null;
  })();

  return (
    <div className="space-y-5">
      {enteteEtat}

      {/* Immuabilité — principe 3. L'analyste doit savoir que ses essais laissent une trace. */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-200 flex gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Chaque ré-analyse <strong>crée une nouvelle analyse horodatée</strong> côté serveur.
          Rien n'est écrasé : ce n'est pas un brouillon. Vos essais sont conservés, consultables
          par un auditeur, et l'écart entre deux analyses successives d'un même dossier est
          lui-même un signal suivi.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Paramètres ────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-4">
            <h4 className="font-semibold text-emerald-400 text-sm">Paramètres à simuler</h4>

            <div>
              <Label className="text-xs text-slate-400">Durée totale (mois)</Label>
              <Input
                type="number" min="1" value={params.dureeMois}
                onChange={(e) => majParam('dureeMois', e.target.value)}
                className="bg-slate-900 border-slate-700 mt-1 font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-slate-400">Différé (mois)</Label>
              <Input
                type="number" min="0" value={params.differeMois}
                onChange={(e) => majParam('differeMois', e.target.value)}
                className="bg-slate-900 border-slate-700 mt-1 font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-slate-400">Taux annuel (%/an)</Label>
              <Input
                type="number" step="0.01" min="0" value={params.tauxAnnuel}
                onChange={(e) => majParam('tauxAnnuel', e.target.value)}
                className="bg-slate-900 border-slate-700 mt-1 font-mono"
              />
              {/* Provenance de la valeur pré-remplie. Sans elle, l'analyste ne
                  peut pas savoir si le taux vient du dossier ou de sa propre
                  saisie précédente — et c'est cette hypothèse-là qui fait
                  l'échéancier. */}
              {!courante && (
                tauxCredit.annualServed ? (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Repris du prêt : {tauxCredit.annualText} (servi par le serveur, taux
                    contractuel {tauxCredit.monthlyText}). Modifiable pour simuler.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-400/80 mt-1 leading-relaxed">
                    Aucun taux annuel n'est servi pour ce prêt : le champ reste vide.
                    Il n'est pas déduit du taux contractuel ({tauxCredit.monthlyText}) —
                    une annualisation faite ici deviendrait l'hypothèse d'une analyse
                    opposable sans que rien ne dise qu'elle vient du navigateur.
                  </p>
                )
              )}
            </div>

            <div>
              <Label className="text-xs text-slate-400">Mode de différé</Label>
              <Select value={params.modeDiffere} onValueChange={(v) => majParam('modeDiffere', v)}>
                <SelectTrigger className="bg-slate-900 border-slate-700 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interets_seuls">{MODE_DIFFERE_LABEL.interets_seuls}</SelectItem>
                  <SelectItem value="franchise_totale">{MODE_DIFFERE_LABEL.franchise_totale}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 mt-1">{MODE_DIFFERE_AIDE[params.modeDiffere]}</p>
            </div>

            {invalide && (
              <p className="text-[11px] text-red-300">{invalide}</p>
            )}
            {!invalide && modifie && courante && (
              <p className="text-[11px] text-amber-300">
                Paramètres modifiés — les chiffres affichés à droite restent ceux de la
                dernière analyse serveur tant que vous n'avez pas relancé.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                onClick={reanalyser}
                disabled={busy || !!invalide || !code}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {busy
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyse en cours…</>
                  : <><RefreshCw className="w-4 h-4 mr-2" /> {courante ? 'Ré-analyser' : "Lancer l'analyse"}</>}
              </Button>
              {courante && modifie && (
                <Button
                  variant="ghost" size="sm" disabled={busy}
                  onClick={() => setParams(parametresDepuisAnalyse(courante))}
                  className="text-slate-400 hover:bg-slate-800"
                >
                  Rétablir
                </Button>
              )}
            </div>

            {erreurRun && (
              <Alert className="border-red-500/40 bg-red-900/10 text-red-200 mt-2">
                <ServerCrash className="h-4 w-4" />
                <AlertTitle className="text-sm">
                  {erreurRun.status === 404
                    ? 'Moteur non disponible (404)'
                    : erreurRun.status === 403
                      ? 'Ré-analyse refusée (403)'
                      : 'Ré-analyse échouée'}
                </AlertTitle>
                <AlertDescription className="text-xs space-y-1">
                  <p>{erreurRun.message}</p>
                  <p className="text-red-300/70">
                    {erreurRun.status === 404
                      ? "L'endpoint de ré-analyse n'est pas servi par le backend. Aucune analyse n'a été créée, aucun paramètre n'a été enregistré."
                      : "Aucune analyse n'a été créée. Les chiffres affichés restent ceux de la dernière analyse serveur reçue."}
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        {/* ── Résultats servis par le moteur ────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {!courante ? (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-sm text-slate-400">
              Aucun résultat d'analyse à afficher. Les valeurs de DSCR, de score et
              l'échéancier apparaîtront ici dès que le serveur aura renvoyé une analyse —
              ils ne sont jamais estimés dans le navigateur.
            </div>
          ) : (
            <>
              {runs.length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Comparer à :</span>
                  <Button
                    size="sm" variant={baseComparaison === 'precedente' ? 'secondary' : 'ghost'}
                    className="h-7 text-xs" onClick={() => setBaseComparaison('precedente')}
                  >
                    Analyse précédente
                  </Button>
                  <Button
                    size="sm" variant={baseComparaison === 'initiale' ? 'secondary' : 'ghost'}
                    className="h-7 text-xs" onClick={() => setBaseComparaison('initiale')}
                  >
                    Analyse d'origine
                  </Button>
                </div>
              )}

              <ComparaisonAnalyse
                courante={courante}
                reference={reference}
                libelleReference={baseComparaison === 'initiale' ? "analyse d'origine" : 'analyse précédente'}
              />

              <DiagnosticDiffere analyse={courante} />

              <EcheancierServeur lignes={courante.echeancier} currency={credit?.currency || 'USD'} />

              <p className="text-[11px] text-slate-500">
                Analyse #{courante.id ?? NULL_DISPLAY} · moteur {courante.versionMoteur || NULL_DISPLAY} ·
                référentiel {courante.referentiel || NULL_DISPLAY} ·
                exécutée le {formatDateHeureFr(courante.executeLe)}.
                Aucun de ces chiffres n'est recalculé côté navigateur.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Trace des analyses de la session ───────────────────────── */}
      {runs.length > 0 && (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 flex items-center gap-2">
            <History className="w-3 h-3" /> Analyses obtenues depuis l'ouverture de cet écran
            <Badge variant="outline" className="text-[10px] h-5 ml-auto">{runs.length}</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 bg-slate-900/50 text-[10px] uppercase">
                <TableHead>Exécutée le</TableHead>
                <TableHead className="text-center">Durée</TableHead>
                <TableHead className="text-center">Différé</TableHead>
                <TableHead className="text-center">Taux</TableHead>
                <TableHead className="text-right">DSCR</TableHead>
                <TableHead className="text-right">DSCR stressé</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Recommandation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((a, i) => (
                <TableRow
                  key={a.id ?? `${a.executeLe}-${i}`}
                  className={`border-slate-800 text-xs ${i === runs.length - 1 ? 'bg-emerald-500/5' : ''}`}
                >
                  <TableCell className="text-slate-400">{formatDateHeureFr(a.executeLe)}</TableCell>
                  <TableCell className="text-center font-mono">{a.parametres?.dureeMois ?? NULL_DISPLAY}</TableCell>
                  <TableCell className="text-center font-mono">{a.parametres?.differeMois ?? NULL_DISPLAY}</TableCell>
                  <TableCell className="text-center font-mono">{formatPourcent(a.parametres?.tauxAnnuel)}</TableCell>
                  <TableCell className="text-right font-mono text-white">{formatRatio2(a.dscr, 3)}</TableCell>
                  <TableCell className="text-right font-mono text-slate-300">{formatRatio2(a.dscrStress, 3)}</TableCell>
                  <TableCell className="text-right font-mono text-slate-300">{formatPourcent(a.scoreGlobal, 1)}</TableCell>
                  <TableCell className="text-slate-300">
                    {RECOMMANDATION_LABEL[a.recommandation] || a.recommandation || NULL_DISPLAY}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-2 text-[11px] text-slate-500 bg-slate-900/40">
            Cette liste est locale à l'écran ouvert. Les analyses, elles, sont conservées
            côté serveur — fermer ce modal n'en efface aucune.
          </p>
        </div>
      )}
    </div>
  );
};

export default SimulateurMoteur;
