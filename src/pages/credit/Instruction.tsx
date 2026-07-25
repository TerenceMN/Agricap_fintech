/**
 * Écran d'instruction de la direction — `/credit/instruction/:code`.
 *
 * Ce que la direction y fait :
 *   1. elle FIXE les paramètres du dossier (durée, différé et son mode, taux) et
 *      relance le moteur, qui recalcule l'échéancier, le DSCR, le stress et les
 *      cinq critères ;
 *   2. elle lit, POSTE PAR POSTE, la confrontation entre le classeur envoyé par
 *      le demandeur et le référentiel de sa filière ;
 *   3. elle voit contre QUELS documents cette analyse a été faite ;
 *   4. elle consigne, écart par écart, sa lecture — en ajout seul.
 *
 * Ce qu'elle n'y fait pas : approuver. Le moteur recommande, l'humain décide
 * ailleurs, avec motif, plafond de délégation et journal (principe 2).
 *
 * ─── ZÉRO CHIFFRE MÉTIER CALCULÉ AU NAVIGATEUR ───────────────────────────────
 *
 * Échéancier, totaux, DSCR, DSCR stressé, écarts, badges hors plage, score,
 * lettre, taux proposé : tout vient du serveur. Là où le serveur ne sert pas
 * (bornes des plages, prévisualisation sans écriture, choix du classeur de
 * référence), l'écran le DIT au lieu de le fabriquer.
 *
 * ─── STAFF STRICTEMENT (principe 7) ──────────────────────────────────────────
 *
 * Cette page expose barèmes, plages, tolérances, effectifs de référentiel et
 * empreintes de documents internes. Deux gardes se superposent, et la seconde
 * seule fait autorité :
 *   - garde d'affichage : `me.is_staff`, calculé PAR LE SERVEUR ;
 *   - garde serveur : `GET .../analyse/` exige `STAFF_ROLES`,
 *     `POST .../reanalyser/` et `.../analyse/justifier/` exigent `CAN_INSTRUCT`,
 *     `GET /dataio/sources` exige `IsStaff`. Chaque refus est relayé tel quel.
 * Rappel : `HasCapability("read")` ne veut pas dire « interne » —
 * `client`, `agri_op`, `investor` et `partner` le portent tous.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import type {
  CreditAnalyse, CreditApplication, CreditSimulateResult, DataSource, Me,
} from '@/types/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Card, CardHead, Note, Pill } from '@/components/instruction/Bits';
import ParametresInstruction from '@/components/instruction/ParametresInstruction';
import DocumentsReference from '@/components/instruction/DocumentsReference';
import ConfrontationPostes from '@/components/instruction/ConfrontationPostes';
// Restitution du moteur : quatre composants DÉJÀ écrits, testés et servis par
// l'onglet Analyse du même dossier. Ils ne sont pas réécrits ici — un second
// bandeau de recommandation ou un second échéancier auraient divergé du premier
// au premier remaniement, et `EcheancierTable` porte déjà la troncature à 24
// lignes et le rouge sur un CRD final non nul (invariant §5) que refaire aurait
// coûté du temps pris à ce qui manque vraiment.
import RecommendationBanner from '@/components/analyse/RecommendationBanner';
import CriteriaTable from '@/components/analyse/CriteriaTable';
import DscrPanel from '@/components/analyse/DscrPanel';
import EcheancierTable from '@/components/analyse/EcheancierTable';
import { construireConfrontation } from '@/components/instruction/confrontation';
import { construireChoixDocuments } from '@/components/instruction/documents';
import {
  SAISIE_VIDE, parametresModifies, payloadReanalyse, saisieDepuisAnalyse,
  type SaisieParametres,
} from '@/components/instruction/parametres';
import { formatMontant } from '@/components/instruction/format';

// ── Sélecteur de dossier ─────────────────────────────────────────────────────

const SelecteurDossier: React.FC = () => {
  const [dossiers, setDossiers] = useState<CreditApplication[] | null>(null);
  const [erreurs, setErreurs] = useState<FieldError[]>([]);
  const [interdit, setInterdit] = useState(false);

  useEffect(() => {
    let vivant = true;
    api.credits.list()
      .then((rows) => { if (vivant) setDossiers(rows ?? []); })
      .catch((e) => {
        if (!vivant) return;
        if (e instanceof ApiError && e.status === 403) setInterdit(true);
        setErreurs(toFieldErrors(e));
        setDossiers([]);
      });
    return () => { vivant = false; };
  }, []);

  if (interdit) {
    return (
      <Forbidden
        message="La liste des dossiers ne vous est pas ouverte."
        detail="L'instruction est réservée au personnel de crédit."
      />
    );
  }

  return (
    <Card>
      <CardHead
        title="Choisir un dossier à instruire"
        subtitle="L'instruction porte sur un dossier précis : sa feuille de besoins, sa filière, son montant."
      />
      {dossiers === null ? (
        <Loading label="Chargement des dossiers…" />
      ) : (
        <>
          <div className="p-4"><ErrorPanel errors={erreurs} title="Dossiers indisponibles" /></div>
          {dossiers.length === 0 ? (
            <Empty
              title="Aucun dossier accessible."
              hint="Un dossier apparaît ici dès qu'il vous est visible côté serveur."
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {dossiers.map((d) => (
                <li key={d.code}>
                  <Link
                    to={`/credit/instruction/${d.code}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-white/5"
                  >
                    <span className="min-w-0">
                      <span className="text-white font-medium font-mono">{d.code}</span>
                      <span className="text-slate-400 text-sm ml-3">{d.client?.displayName ?? ''}</span>
                      <span className="text-slate-500 text-xs ml-3">{d.valueChain?.label ?? ''}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-slate-300 text-sm tabular-nums">
                        {formatMontant(d.amountApproved ?? d.amountRequested, d.currency)}
                      </span>
                      <Pill label={d.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
};

// ── Écran d'instruction ──────────────────────────────────────────────────────

const Instruction: React.FC = () => {
  const { code } = useParams<{ code?: string }>();

  const [me, setMe] = useState<Me | null>(null);
  const [profilCharge, setProfilCharge] = useState(false);
  const [erreursProfil, setErreursProfil] = useState<FieldError[]>([]);

  const [analyse, setAnalyse] = useState<CreditAnalyse | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreurs, setErreurs] = useState<FieldError[]>([]);
  const [sansAnalyse, setSansAnalyse] = useState(false);
  const [interdit, setInterdit] = useState(false);
  const [executionInterdite, setExecutionInterdite] = useState(false);

  const [saisie, setSaisie] = useState<SaisieParametres>({ ...SAISIE_VIDE });
  const [busy, setBusy] = useState(false);

  const [sources, setSources] = useState<DataSource[] | null>(null);
  const [simulation, setSimulation] = useState<CreditSimulateResult | null>(null);
  const [detectionIndisponible, setDetectionIndisponible] = useState<string | null>(null);
  const [chargementDocuments, setChargementDocuments] = useState(false);

  // Profil : c'est le SERVEUR qui dit si l'utilisateur est interne.
  useEffect(() => {
    let vivant = true;
    api.me()
      .then((p) => { if (vivant) setMe(p); })
      .catch((e) => { if (vivant) setErreursProfil(toFieldErrors(e)); })
      .finally(() => { if (vivant) setProfilCharge(true); });
    return () => { vivant = false; };
  }, []);

  const charger = useCallback(async (reference: string) => {
    setChargement(true);
    setErreurs([]);
    setSansAnalyse(false);
    setInterdit(false);
    try {
      const data = await api.credits.analyse(reference);
      setAnalyse(data);
      setSaisie(saisieDepuisAnalyse(data));
    } catch (e) {
      setAnalyse(null);
      if (e instanceof ApiError && e.status === 404) {
        // Distinguer « dossier inconnu » de « jamais analysé » : le second est un
        // état de départ normal, pas une erreur.
        setSansAnalyse(e.code === 'ANALYSE_ABSENTE');
        if (e.code !== 'ANALYSE_ABSENTE') setErreurs(toFieldErrors(e));
      } else if (e instanceof ApiError && e.status === 403) {
        setInterdit(true);
      } else {
        setErreurs(toFieldErrors(e));
      }
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { if (code) void charger(code); }, [code, charger]);

  /**
   * Documents de référence. `POST /credits/simulate/` est appelé ici en LECTURE
   * SEULE : il ne crée aucune analyse et ne touche pas au dossier — c'est la
   * seule route qui NOMME le classeur que le moteur retient.
   */
  useEffect(() => {
    if (!code) return;
    let vivant = true;
    setChargementDocuments(true);
    setDetectionIndisponible(null);
    Promise.allSettled([
      api.dataSources(),
      api.credits.simulate({ application_code: code }),
    ]).then(([resSources, resSim]) => {
      if (!vivant) return;
      setSources(resSources.status === 'fulfilled' ? resSources.value : null);
      if (resSim.status === 'fulfilled') {
        setSimulation(resSim.value);
      } else {
        setSimulation(null);
        const raison = resSim.reason;
        setDetectionIndisponible(
          raison instanceof ApiError
            ? `Le serveur n'a pas pu dire quel classeur il retient : ${raison.message}`
            : "Le serveur n'a pas pu dire quel classeur il retient pour ce dossier.",
        );
      }
      setChargementDocuments(false);
    });
    return () => { vivant = false; };
  }, [code]);

  const executer = useCallback(async () => {
    if (!code) return;
    const resultat = payloadReanalyse(saisie);
    if (!resultat.ok) {
      setErreurs(resultat.erreurs);
      return;
    }
    setBusy(true);
    setErreurs([]);
    try {
      const nouvelle = await api.credits.reanalyser(code, resultat.payload);
      setAnalyse(nouvelle);
      setSaisie(saisieDepuisAnalyse(nouvelle));
      setSansAnalyse(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setExecutionInterdite(true);
      setErreurs(toFieldErrors(e));
    } finally {
      setBusy(false);
    }
  }, [code, saisie]);

  const justifier = useCallback(async (indicateur: string, justification: string) => {
    if (!code) return;
    setBusy(true);
    setErreurs([]);
    try {
      const misAJour = await api.credits.justifyIndicator(code, { indicateur, justification });
      setAnalyse(misAJour);
    } catch (e) {
      setErreurs(toFieldErrors(e));
    } finally {
      setBusy(false);
    }
  }, [code]);

  const confrontation = useMemo(() => construireConfrontation(analyse), [analyse]);
  const choixDocuments = useMemo(
    () => construireChoixDocuments(sources, simulation), [sources, simulation],
  );
  const modifie = useMemo(() => parametresModifies(saisie, analyse), [saisie, analyse]);
  const devise = analyse?.devise || analyse?.parametres?.devise || '';

  // ── Gardes d'affichage ────────────────────────────────────────────────────

  if (!profilCharge) {
    return <div className="p-6"><Loading label="Vérification de vos habilitations…" /></div>;
  }

  if (!me) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Helmet><title>Instruction — AGRICAP FINTECH</title></Helmet>
        <ErrorPanel errors={erreursProfil} title="Profil indisponible" />
        <Forbidden
          message="Impossible de vérifier votre profil."
          detail="Cet écran expose les barèmes et les plages du moteur : il ne s'ouvre pas tant que l'identité de l'utilisateur n'est pas confirmée par le serveur."
        />
      </div>
    );
  }

  if (!me.is_staff) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Helmet><title>Instruction — AGRICAP FINTECH</title></Helmet>
        <Forbidden
          message="Écran réservé au personnel d'instruction."
          detail="Il expose les références de filière, les tolérances et les règles du moteur. Un demandeur y lirait de quoi calibrer son dossier pour franchir la barre plutôt que pour réussir."
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <Helmet>
        <title>{code ? `Instruction ${code} — AGRICAP FINTECH` : 'Instruction — AGRICAP FINTECH'}</title>
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Instruction du dossier</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Vous fixez les paramètres, le moteur recalcule. Il produit une recommandation, jamais
            une décision : celle-ci se prend sur le dossier, avec son motif.
          </p>
        </div>
        {code && (
          <div className="flex items-center gap-2">
            <Link
              to={`/credit/dossiers/${code}`}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white"
            >
              Ouvrir le dossier {code}
            </Link>
            <Link
              to="/credit/instruction"
              className="px-3 py-2 rounded-lg border border-white/10 hover:bg-white/10 text-sm text-slate-300"
            >
              Changer de dossier
            </Link>
          </div>
        )}
      </header>

      {!code ? (
        <SelecteurDossier />
      ) : interdit ? (
        <Forbidden
          message="Ce dossier ne vous est pas ouvert."
          detail="Le serveur réserve l'analyse détaillée au personnel d'instruction, et refuse ce dossier à votre rôle."
        />
      ) : (
        <>
          <ErrorPanel errors={erreurs} title="Le serveur a refusé l'opération" />

          {chargement && <Loading label="Chargement de l'analyse…" />}

          {sansAnalyse && (
            <Note tone="info" title="Ce dossier n'a jamais été analysé">
              Aucune analyse n'existe encore. Fixez les paramètres ci-dessous et lancez le moteur :
              la première exécution créera l'analyse de référence du dossier.
            </Note>
          )}

          <ParametresInstruction
            saisie={saisie}
            onChange={setSaisie}
            modifie={modifie}
            busy={busy}
            onExecuter={executer}
            onReinitialiser={() => setSaisie(saisieDepuisAnalyse(analyse))}
            aUneAnalyse={analyse !== null}
            interdit={executionInterdite}
          />

          <DocumentsReference
            choix={choixDocuments}
            analyse={analyse}
            detectionIndisponible={detectionIndisponible}
            chargement={chargementDocuments}
          />

          {analyse && (
            <>
              <RecommendationBanner
                recommandation={analyse.recommandation}
                scoreGlobal={analyse.scoreGlobal}
                scoreLettre={analyse.scoreLettre}
                executeLe={analyse.executeLe}
                versionMoteur={analyse.versionMoteur}
                referentiel={analyse.referentielInfo?.code || analyse.referentiel}
                referentielInfo={analyse.referentielInfo}
              />

              {/* Le moteur recommande, l'humain décide : la page ne porte aucun
                  bouton de décision, et le dit plutôt que de le laisser deviner. */}
              <Note tone="info" title="Cette page n'approuve rien">
                La recommandation ci-dessus éclaire une décision ; elle ne la prend pas.
                L'approbation, le rejet et l'ajournement se font sur le dossier, avec motif
                obligatoire, plafond de délégation vérifié par le serveur et journalisation.
              </Note>

              <CriteriaTable criteres={analyse.criteres} scoreGlobal={analyse.scoreGlobal} />

              <DscrPanel analyse={analyse} currency={devise} />

              <EcheancierTable
                lignes={analyse.echeancier}
                currency={devise}
                totaux={analyse.totaux}
              />

              <ConfrontationPostes
                confrontation={confrontation}
                onJustifier={justifier}
                justificationPermise={!executionInterdite}
                busy={busy}
              />
            </>
          )}

          {!analyse && !chargement && !sansAnalyse && erreurs.length === 0 && (
            <Empty
              title="Aucune analyse à afficher."
              hint="Le serveur n'a servi aucune analyse pour ce dossier."
            />
          )}
        </>
      )}
    </div>
  );
};

export default Instruction;
