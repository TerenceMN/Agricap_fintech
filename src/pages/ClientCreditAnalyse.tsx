/**
 * Sous-page CLIENT « Analyse de mon crédit » — `/credits/analyse/:code`.
 *
 * Consommateur de `GET /api/credits/applications/<code>/analyse-resume/`
 * (`credits/analyse.py::serialiser_analyse_resume`), la seule vue d'analyse
 * qu'un client a le droit de voir. Le pendant staff riche (`analyse/`) expose
 * barèmes, plages et DSCR : il n'est JAMAIS appelé ici.
 *
 * Principe 7 (anti-gaming par asymétrie d'information). Le client voit :
 *   - sa LETTRE de score (A/B/C/D), jamais le score chiffré ;
 *   - ses points forts et ses pistes d'amélioration, formulés en actions.
 * Il ne voit JAMAIS : barème, seuil, tolérance, plage, poids, DSCR, règle du
 * moteur. Le backend est déjà conçu pour ne pas les servir ; cet écran ajoute
 * une seconde ligne de défense — il ne RE-RENDU que les cinq champs autorisés
 * (rendu par liste blanche), et si le payload portait un champ hors périmètre,
 * il ne l'affiche pas et le signale en console (`warnLeak`). Une régression du
 * serializer serveur ne peut donc pas fuiter par cet écran sans laisser de
 * trace.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Lightbulb, FileSearch } from 'lucide-react';
import Layout from '@/components/Layout';
import { api, ApiError } from '@/services/api';
import { Loading, Forbidden, ErrorPanel, Empty, toFieldErrors, type FieldError } from '@/components/backoffice/States';
import type { CreditAnalyseResume } from '@/types/api';

/** Les cinq—et uniquement cinq—champs qu'un client a le droit de recevoir. */
const CHAMPS_AUTORISES = new Set([
  'reference', 'scoreLettre', 'pointsForts', 'pointsAAmeliorer', 'analyseLe',
]);

/**
 * Garde anti-gaming : ne retient que les champs autorisés et signale toute clé
 * hors périmètre servie par le backend (régression possible du serializer). Le
 * rendu par liste blanche fait que rien de sensible ne s'affiche, même si le
 * warning passait inaperçu.
 */
function assainir(payload: Record<string, unknown>): CreditAnalyseResume {
  const fuites = Object.keys(payload).filter((k) => !CHAMPS_AUTORISES.has(k));
  if (fuites.length > 0) {
    // Signal développeur/audit (même canal que les warnings d'`api.ts`). On ne
    // montre jamais ces champs au client, et on ne les devine pas non plus.
    console.warn(
      `[anti-gaming] analyse-resume a renvoyé des champs hors périmètre client (ignorés) : ${fuites.join(', ')}`,
    );
  }
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const lettre = payload.scoreLettre;
  return {
    reference: typeof payload.reference === 'string' ? payload.reference : '',
    scoreLettre: (lettre === 'A' || lettre === 'B' || lettre === 'C' || lettre === 'D')
      ? lettre : ('D' as CreditAnalyseResume['scoreLettre']),
    pointsForts: strList(payload.pointsForts),
    pointsAAmeliorer: strList(payload.pointsAAmeliorer),
    analyseLe: typeof payload.analyseLe === 'string' ? payload.analyseLe : null,
  };
}

/** Descripteur QUALITATIF par lettre — aucun seuil, aucun chiffre exposé. */
const LETTRE_META: Record<string, { mot: string; anneau: string; texte: string; fond: string }> = {
  A: { mot: 'Profil solide', anneau: 'border-emerald-400/60', texte: 'text-emerald-300', fond: 'bg-emerald-500/10' },
  B: { mot: 'Bon profil', anneau: 'border-blue-400/60', texte: 'text-blue-300', fond: 'bg-blue-500/10' },
  C: { mot: 'Profil à consolider', anneau: 'border-amber-400/60', texte: 'text-amber-300', fond: 'bg-amber-500/10' },
  D: { mot: 'Profil fragile', anneau: 'border-red-400/60', texte: 'text-red-300', fond: 'bg-red-500/10' },
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;

const ClientCreditAnalyse: React.FC = () => {
  const { code = '' } = useParams();
  const [resume, setResume] = useState<CreditAnalyseResume | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(null);
    setNotFound(false);
    setErrors([]);
    try {
      const raw = await api.credits.analyseResume(code) as unknown as Record<string, unknown>;
      setResume(assainir(raw));
    } catch (e) {
      setResume(null);
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(e.message);
      } else if (e instanceof ApiError && e.status === 404) {
        // Le backend distingue « dossier introuvable » de « pas encore analysé »
        // (code ANALYSE_ABSENTE) ; les deux se lisent 404 côté client — on montre
        // un état « en attente d'analyse » plutôt qu'une erreur brutale.
        setNotFound(true);
      } else {
        setErrors(toFieldErrors(e));
      }
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  const meta = resume ? (LETTRE_META[resume.scoreLettre] ?? LETTRE_META.D) : null;
  const analyseLe = fmtDate(resume?.analyseLe ?? null);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-6 space-y-6 text-white">
        <Helmet><title>Analyse de mon crédit — AGRICAP</title></Helmet>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            to="/credits"
            className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour à mes demandes
          </Link>
          <span className="text-xs font-mono text-slate-500">Dossier {code}</span>
        </div>

        <div>
          <h1 className="text-2xl font-bold">Analyse de mon crédit</h1>
          <p className="text-sm text-slate-400 mt-1">
            Voici votre note et des pistes concrètes pour renforcer votre dossier. La décision
            finale reste prise par un conseiller.
          </p>
        </div>

        {loading && <Loading label="Chargement de votre analyse…" />}

        {!loading && forbidden && (
          <Forbidden message="Vous n'avez pas accès à cette analyse." detail={forbidden} />
        )}

        {!loading && notFound && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
            <FileSearch className="w-9 h-9 text-slate-500 mx-auto mb-3" aria-hidden="true" />
            <p className="text-slate-200 font-medium">Votre dossier n'a pas encore été analysé.</p>
            <p className="text-slate-500 text-sm mt-1">
              Dès qu'un analyste l'aura étudié, votre note et vos pistes d'amélioration
              apparaîtront ici. Vous serez notifié.
            </p>
          </div>
        )}

        {!loading && !forbidden && !notFound && errors.length > 0 && (
          <ErrorPanel errors={errors} title="Analyse indisponible" />
        )}

        {!loading && resume && meta && (
          <>
            {/* ── Lettre de score : jamais le score chiffré (principe 7) ── */}
            <div className={`rounded-2xl border ${meta.anneau} ${meta.fond} p-6 flex items-center gap-6`}>
              <div className={`w-24 h-24 rounded-full border-4 ${meta.anneau} flex items-center justify-center shrink-0`}>
                <span className={`text-5xl font-black ${meta.texte}`}>{resume.scoreLettre}</span>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Votre note</p>
                <p className={`text-2xl font-bold ${meta.texte}`}>{meta.mot}</p>
                {analyseLe && (
                  <p className="text-xs text-slate-500 mt-1">Analysé le {analyseLe}</p>
                )}
              </div>
            </div>

            {/* ── Points forts ── */}
            {resume.pointsForts.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <h2 className="font-semibold flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> Vos points forts
                </h2>
                <ul className="space-y-2">
                  {resume.pointsForts.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-200">
                      <span className="text-emerald-400 mt-0.5" aria-hidden="true">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── Pistes d'amélioration ── */}
            {resume.pointsAAmeliorer.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <h2 className="font-semibold flex items-center gap-2 text-amber-300">
                  <Lightbulb className="w-5 h-5" aria-hidden="true" /> Pistes pour renforcer votre dossier
                </h2>
                <ul className="space-y-2">
                  {resume.pointsAAmeliorer.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-200">
                      <span className="text-amber-400 mt-0.5" aria-hidden="true">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {resume.pointsForts.length === 0 && resume.pointsAAmeliorer.length === 0 && (
              <Empty
                title="Aucune piste particulière à afficher."
                hint="Votre note résume l'analyse de votre dossier."
              />
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Cette page ne montre volontairement ni votre score chiffré, ni les règles de calcul :
              elle vous donne le nécessaire pour progresser, sans permettre d'« optimiser » un dossier
              à rebours. Pour toute question, contactez votre agence.
            </p>
          </>
        )}
      </div>
    </Layout>
  );
};

export default ClientCreditAnalyse;
