import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Lock } from 'lucide-react';
import { Loading, Empty, ErrorPanel, Forbidden, toFieldErrors } from '@/components/backoffice/States';
import RecommendationBanner from './RecommendationBanner';
import CriteriaTable from './CriteriaTable';
import DscrPanel from './DscrPanel';
import ModuleGaps, { listerEcartsHorsPlage } from './ModuleGaps';
import EcheancierTable from './EcheancierTable';
import JustifyIndicatorDialog from './JustifyIndicatorDialog';

/**
 * Onglet « Analyse » du dossier de crédit (SPEC Moteur §8b, CLAUDE.md §7.1.3).
 *
 * ⚠ **Staff uniquement.** Cet écran expose les barèmes, les tolérances par
 * module et les plages du référentiel : servi à un client, il lui apprendrait
 * à fabriquer un dossier qui passe (principe 7, anti-gaming). La vue destinée
 * au client est `analyse-resume`, volontairement pauvre — aucun composant de ce
 * dossier ne doit être monté dans un écran client.
 *
 * L'écran ne recalcule rien : score, DSCR, points et montants de l'échéancier
 * viennent du moteur et sont affichés tels quels.
 *
 * La devise affichée est **celle de l'analyse** (`devise`), pas celle du prêt
 * portefeuille : ce sont deux agrégats distincts, et étiqueter des montants du
 * moteur avec la devise d'un autre objet serait une erreur de lignage, pas un
 * repli acceptable. Si le moteur ne la porte pas, les montants s'affichent sans
 * devise plutôt qu'avec une devise devinée.
 *
 * @param {{
 *   code: string,
 *   state: ReturnType<typeof import('./useCreditAnalyse').useCreditAnalyse>,
 * }} props
 */
const AnalyseTab = ({ code, state }) => {
  const { analyse, loading, error, notAnalysed, forbidden, reload, setAnalyse } = state;
  const [justifyOpen, setJustifyOpen] = useState(false);
  const [justifyCible, setJustifyCible] = useState(null);

  const ouvrirJustification = (indicateur) => {
    setJustifyCible(indicateur);
    setJustifyOpen(true);
  };

  if (loading && !analyse) return <Loading label="Chargement de l'analyse…" />;

  if (forbidden) {
    return (
      <Forbidden
        message="Analyse réservée au personnel habilité."
        detail="Cet écran expose les barèmes et les plages du référentiel ; le serveur en réserve l'accès aux rôles staff."
      />
    );
  }

  if (notAnalysed) {
    return (
      <div className="space-y-4">
        <Empty
          title="Analyse non encore exécutée"
          hint="Le moteur n'a pas encore produit d'analyse pour ce dossier. Elle est générée après la validation du plan financier (étape 2bis du pipeline)."
        />
        <div className="text-center">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 hover:bg-slate-700"
            onClick={reload}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            Vérifier à nouveau
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorPanel errors={toFieldErrors(error)} title="Analyse indisponible" />
        <div className="text-center">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 hover:bg-slate-700"
            onClick={reload}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            Réessayer
          </Button>
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

  const ecarts = listerEcartsHorsPlage(analyse);
  const devise = analyse.devise || analyse.parametres?.devise || '';

  return (
    <div className="max-h-[62vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800 space-y-4 pr-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Lock className="w-3 h-3" aria-hidden="true" />
          Vue analyste — barèmes, tolérances et plages du référentiel. Ne jamais restituer au client.
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-slate-300 hover:bg-slate-700"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualiser
        </Button>
      </div>

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

      <DscrPanel analyse={analyse} />

      <ModuleGaps analyse={analyse} currency={devise} onJustify={ouvrirJustification} />

      <EcheancierTable
        lignes={analyse.echeancier}
        currency={devise}
        totaux={analyse.totaux}
      />

      <JustifyIndicatorDialog
        open={justifyOpen}
        onOpenChange={setJustifyOpen}
        code={code}
        indicateurs={ecarts}
        defaultIndicateur={justifyCible}
        onJustified={setAnalyse}
      />
    </div>
  );
};

export default AnalyseTab;
