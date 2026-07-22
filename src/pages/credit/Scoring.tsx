/**
 * Page de SCORING (staff) — `/credit/dossiers/:code/scoring`.
 *
 * Ce que cet écran répond, et qu'aucun autre ne répondait : **comment ce score
 * a-t-il été obtenu, et pourquoi ce taux ?** L'onglet « Analyse de crédit » du
 * dossier montre le résultat (recommandation, DSCR, écarts, échéancier) ; cette
 * page montre la MÉCANIQUE — les cinq critères et leur pondération, le chemin
 * complet du taux de base au taux proposé, la dimension à laquelle le
 * référentiel a été rapporté, et la provenance de chaque règle appliquée.
 * C'est l'écran qui rend le moteur explicable à un analyste, et opposable
 * devant un comité.
 *
 * TROIS DISCIPLINES, tenues ligne à ligne :
 *
 *  1. **Zéro chiffre métier calculé ici.** Score global, points, poids, taux,
 *     bande, plancher : tout est servi par `GET /credits/applications/<code>/analyse/`
 *     (`analyse.py::serialiser_analyse_staff`), arrêté en `Decimal` côté serveur.
 *     Le total des points n'est PAS recomposé à l'écran — s'il ne tombait pas
 *     sur le score global, ce serait un défaut du moteur à remonter, et un
 *     écran qui le lisse le rendrait invisible.
 *
 *  2. **Aucun seuil en dur.** Bandes de score, ajustements, plancher, poids et
 *     grille de lettres vivent en base (`BaremeScore`, `InstitutionConfig`) et
 *     sont FIGÉS sur chaque analyse. La page affiche ce que le serveur sert ;
 *     elle ne recopie pas un barème, sinon le comité ne pourrait plus le
 *     recalibrer sans redéployer le front (principe 8).
 *
 *  3. **Staff uniquement (principe 7).** Barèmes, tolérances, plages, poids et
 *     grille de tarification n'ont pas à descendre chez le demandeur. L'accès
 *     est décidé par le SERVEUR (403 sur `analyse/`) et restitué tel quel : pas
 *     de garde de rôle côté front, qui reposerait sur `menuKeyFor` et masquerait
 *     l'écran à des rôles qui y ont droit. La vue client, volontairement pauvre,
 *     est `/credits/analyse/:code`.
 */
import React from 'react';
import { Helmet } from 'react-helmet';
import { Link, useParams } from 'react-router-dom';
import { Lock, RefreshCw, Ruler, ScrollText } from 'lucide-react';
import { Loading, Empty, ErrorPanel, Forbidden, toFieldErrors } from '@/components/backoffice/States';
import { useCreditAnalyse } from '@/components/analyse/useCreditAnalyse';
import RecommendationBanner from '@/components/analyse/RecommendationBanner';
import CriteriaTable from '@/components/analyse/CriteriaTable';
import TarificationPanel from '@/components/analyse/TarificationPanel';
import { libelleUnite } from '@/components/simulateur/dimension';
import { NULL_DISPLAY, formatDateTimeFr, formatPoids } from '@/components/analyse/analyseFormat';
import type { CreditAnalyse } from '@/types/api';

/** Quantité de référence formatée — présentation d'un nombre serveur. */
function quantiteFr(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined) return NULL_DISPLAY;
  const n = Number(valeur);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
}

/**
 * Dimension du projet retenue par le moteur.
 *
 * C'est le dénominateur de tout le critère technique : les coûts du référentiel
 * sont des coûts PAR unité (par hectare, par ruche, par sujet…), et le plan du
 * dossier leur est comparé après multiplication par cette quantité. Une
 * dimension absente met le critère technique à 0 — 25 % de la note — et l'écran
 * doit le dire, sinon l'analyste cherche l'explication dans le plan du client
 * alors qu'elle est dans le formulaire.
 */
const DimensionPanel: React.FC<{ analyse: CreditAnalyse }> = ({ analyse }) => {
  const details = analyse.criteres?.technique?.details ?? {};
  const quantite = details.quantiteReference ?? null;
  const unite = details.uniteReference ?? '';
  const refInfo = analyse.referentielInfo;

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
        <Ruler className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <div>
          <h4 className="font-semibold text-white text-sm">Dimension du projet</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Grandeur à laquelle les coûts unitaires du référentiel ont été rapportés.
          </p>
        </div>
      </header>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Quantité retenue</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {quantiteFr(quantite)}
            {unite ? <span className="text-sm text-slate-400 font-normal"> {libelleUnite(unite, quantite)}</span> : null}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Unité du référentiel</p>
          <p className="text-lg font-semibold text-white font-mono">{unite || NULL_DISPLAY}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Référentiel appliqué</p>
          <p className="text-sm font-semibold text-white font-mono">{refInfo?.code || analyse.referentiel || NULL_DISPLAY}</p>
          {refInfo && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              {refInfo.filiere} · v{refInfo.version} ·{' '}
              {refInfo.estIndicatif
                ? `indicatif (${refInfo.nCasReels} dossier(s) réel(s))`
                : `appris (${refInfo.nCasReels} dossier(s) réel(s))`}
            </p>
          )}
        </div>
      </div>

      {quantite === null && (
        <p className="px-4 pb-4 text-[11px] text-amber-300/90 leading-relaxed">
          Aucune dimension n'est portée par ce dossier dans l'unité du référentiel : la
          comparaison au référentiel n'est pas calculable et la fiabilité technique vaut 0 —
          ce n'est pas un jugement sur le plan du client, c'est une donnée manquante à
          renseigner sur le dossier.
        </p>
      )}
      {quantite !== null && unite && unite !== 'ha' && (
        <p className="px-4 pb-4 text-[11px] text-slate-500 leading-relaxed">
          Cette filière ne se mesure pas en hectares. Le moteur refuse toute conversion : un
          dossier dimensionné dans une autre unité que « {unite} » est rejeté en 422
          <span className="font-mono"> DIMENSION_INCOHERENTE</span> plutôt que scoré sur une
          multiplication qui n'a pas de sens.
        </p>
      )}
    </section>
  );
};

/** Provenance des règles appliquées : ce qui rend l'analyse rejouable. */
const ProvenancePanel: React.FC<{ analyse: CreditAnalyse }> = ({ analyse }) => {
  const poids = analyse.poidsAppliques ?? {};
  const lignage = analyse.lignage;
  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <div>
          <h4 className="font-semibold text-white text-sm">Provenance et rejouabilité</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ce qu'il faut pour refaire ce score à l'identique dans deux ans.
          </p>
        </div>
      </header>

      <dl className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Poids appliqués</dt>
          <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-300 tabular-nums">
            {Object.keys(poids).length === 0
              ? <span className="text-slate-500">{NULL_DISPLAY}</span>
              : Object.entries(poids).map(([cle, valeur]) => (
                <span key={cle} className="text-[11px]">
                  <span className="text-slate-500">{cle}</span> {formatPoids(valeur)}
                </span>
              ))}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Moteur</dt>
          <dd className="mt-1 text-slate-300">
            v{analyse.versionMoteur || NULL_DISPLAY} · exécutée le {formatDateTimeFr(analyse.executeLe)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Feuille de besoins scorée</dt>
          <dd className="mt-1 text-slate-300">
            source #{lignage?.needsSourceId ?? NULL_DISPLAY} · révision {lignage?.revision ?? NULL_DISPLAY}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Empreinte SHA-256</dt>
          <dd className="mt-1 font-mono text-[11px] text-slate-400 break-all">
            {lignage?.sha256 || NULL_DISPLAY}
          </dd>
        </div>
      </dl>

      <p className="px-4 pb-4 text-[11px] text-slate-500 leading-relaxed">
        Une ré-analyse crée une NOUVELLE ligne, elle n'en modifie aucune : l'écart entre deux
        analyses successives est lui-même une donnée. Les barèmes, les poids et la grille de
        tarification appliqués sont figés sur cette analyse — un recalibrage du comité ne
        réécrit pas ce qu'un analyste a lu.
      </p>
    </section>
  );
};

const Scoring: React.FC = () => {
  const { code = '' } = useParams();
  const state = useCreditAnalyse(code, true);
  const {
    loading, error, notAnalysed, forbidden, sessionExpiree, reload,
  } = state;
  const analyse = state.analyse as CreditAnalyse | null;

  const enTete = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Scoring du dossier</h1>
        <p className="text-slate-400 text-sm mt-1">
          Dossier <span className="font-mono text-white">{code || NULL_DISPLAY}</span> — comment le
          score est obtenu, et comment le taux en découle.
        </p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {code && (
          <Link to={`/credit/dossiers/${code}`} className="text-primary underline">
            ← Retour au dossier
          </Link>
        )}
        <button
          type="button"
          className="flex items-center h-8 px-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualiser
        </button>
      </div>
    </div>
  );

  const corps = () => {
    if (!code) {
      return (
        <Empty
          title="Aucun dossier désigné"
          hint="Cette page se lit depuis un dossier d'instruction : ouvrez-le, puis « Comment ce score est-il obtenu ? »."
        />
      );
    }
    if (loading && !analyse) return <Loading label="Chargement de l'analyse…" />;
    if (sessionExpiree) {
      return (
        <Empty
          title="Session expirée"
          hint="Votre authentification n'est plus valide. Reconnectez-vous, puis rouvrez cette page. Le moteur n'est pas en cause et rien n'a été perdu."
        />
      );
    }
    if (forbidden) {
      return (
        <Forbidden
          message="Scoring réservé au personnel habilité."
          detail="Cette page expose les barèmes, les poids et la grille de tarification ; le serveur en réserve l'accès aux rôles staff. Le demandeur, lui, voit sa lettre et ses pistes d'amélioration."
        />
      );
    }
    if (notAnalysed) {
      return (
        <div className="space-y-4">
          <Empty
            title="Aucune analyse exécutée sur ce dossier"
            hint="Le score est produit par le moteur, à partir de la feuille de besoins ingérée et des paramètres de crédit choisis par l'analyste. Tant qu'aucune analyse n'a tourné, il n'y a ni score, ni taux, ni bande — et rien n'est deviné ici."
          />
          <div className="text-center">
            <button
              type="button"
              className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-600 text-sm text-slate-200 hover:bg-slate-700"
              onClick={reload}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
              Vérifier à nouveau
            </button>
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="space-y-3">
          <ErrorPanel errors={toFieldErrors(error)} title="Analyse indisponible" />
          <p className="text-[11px] text-slate-500">
            Chaque cause est affichée avec son code serveur : un refus de dimension
            (<span className="font-mono">DIMENSION_INCOHERENTE</span>), un barème absent
            (<span className="font-mono">BAREME_ABSENT</span>) ou un référentiel manquant
            (<span className="font-mono">REFERENTIEL_ABSENT</span>) n'appellent pas la même
            correction.
          </p>
          <div className="text-center">
            <button
              type="button"
              className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-600 text-sm text-slate-200 hover:bg-slate-700"
              onClick={reload}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
              Réessayer
            </button>
          </div>
        </div>
      );
    }
    if (!analyse) {
      return (
        <Empty
          title="Aucune analyse à afficher"
          hint="Le serveur n'a renvoyé aucun contenu pour ce dossier."
        />
      );
    }

    return (
      <div className="space-y-4">
        <RecommendationBanner
          recommandation={analyse.recommandation}
          scoreGlobal={analyse.scoreGlobal}
          scoreLettre={analyse.scoreLettre}
          executeLe={analyse.executeLe}
          versionMoteur={analyse.versionMoteur}
          referentiel={analyse.referentielInfo?.code || analyse.referentiel}
          referentielInfo={analyse.referentielInfo}
        />

        <CriteriaTable criteres={analyse.criteres} scoreGlobal={analyse.scoreGlobal} />

        <TarificationPanel tarification={analyse.tarification} scoreGlobal={analyse.scoreGlobal} />

        <DimensionPanel analyse={analyse} />

        <ProvenancePanel analyse={analyse} />

        <p className="text-[11px] text-slate-500 leading-relaxed">
          Les écarts par module, le DSCR et son levier, le stress test et l'échéancier sont sur
          l'onglet « Analyse de crédit » du dossier — cette page reste centrée sur la formation
          du score et du taux.
        </p>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5 text-white">
      <Helmet><title>Scoring {code} — AGRICAP FINTECH</title></Helmet>
      {enTete}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Lock className="w-3 h-3" aria-hidden="true" />
        Vue analyste — barèmes, poids, bandes de tarification et plages du référentiel. Ne jamais
        restituer au client.
      </p>
      {corps()}
    </div>
  );
};

export default Scoring;
