/**
 * Recommandation du moteur — et ce qu'elle n'est pas.
 *
 * PRINCIPE 2, tenu jusque dans le vocabulaire : le moteur RECOMMANDE, l'humain
 * DÉCIDE. Ce panneau n'offre aucun bouton d'approbation, de rejet ou
 * d'ajournement — non par oubli, mais parce que la décision se prend sur l'écran
 * du dossier, avec son motif obligatoire, son plafond de délégation vérifié
 * serveur et sa journalisation. Un bouton « Approuver » posé à côté d'un score
 * de 78 transformerait une recommandation en verdict.
 *
 * La décomposition du score est servie telle quelle : `points = score × poids / 100`
 * est arrondi critère par critère PAR LE MOTEUR, et le score global est la somme
 * des points arrondis — pas l'arrondi de la somme. Refaire l'opération ici
 * donnerait 29,3 là où le moteur a écrit 29,2.
 */
import React from 'react';
import type { CreditAnalyse, CreditRecommandation } from '@/types/api';
import { Card, CardHead, Grandeur, Note, Pill, type Tone } from './Bits';
import {
  NULL_DISPLAY, abregerSha, formatDateTimeFr, formatEntier, formatMontant, formatPoids,
  formatPoints, formatScore, formatTaux,
} from './format';

/** Libellés des quatre niveaux de `AnalyseCredit.Recommandation`. */
const RECOMMANDATIONS: Record<CreditRecommandation, { label: string; tone: Tone }> = {
  approbation: { label: 'Recommandation : approbation', tone: 'ok' },
  approbation_cond: { label: 'Recommandation : approbation conditionnelle', tone: 'info' },
  revue: { label: 'Recommandation : revue approfondie', tone: 'attention' },
  refus: { label: 'Recommandation : refus', tone: 'alerte' },
};

const LIBELLES_CRITERES: Record<string, string> = {
  technique: 'Fiabilité technique du plan',
  dscr: 'Capacité de remboursement (DSCR)',
  stress: 'Résilience au stress',
  comportemental: 'Historique comportemental',
  garanties: 'Garanties et couverture',
};

const ORDRE = ['technique', 'dscr', 'stress', 'comportemental', 'garanties'] as const;

const RecommandationMoteur: React.FC<{ analyse: CreditAnalyse }> = ({ analyse }) => {
  const reco = RECOMMANDATIONS[analyse.recommandation]
    ?? { label: `Recommandation : ${analyse.recommandation}`, tone: 'neutre' as Tone };
  const devise = analyse.devise || analyse.parametres?.devise || '';
  const tarif = analyse.tarification;

  return (
    <Card>
      <CardHead
        title="Ce que le moteur conclut"
        subtitle={
          "Une recommandation, pas une décision : aucun bouton d'approbation ne figure sur cet "
          + "écran. La décision se prend sur le dossier, avec son motif, son plafond de "
          + "délégation et sa trace."
        }
        right={<Pill label={reco.label} tone={reco.tone} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        <Grandeur
          label="Score global"
          valeur={formatScore(analyse.scoreGlobal)}
          base={`Sur 100 — lettre ${analyse.scoreLettre ?? NULL_DISPLAY}, servie par le moteur`}
        />
        <Grandeur
          label="Capital analysé"
          valeur={formatMontant(analyse.parametres?.capital, devise)}
          base="Montant approuvé, à défaut montant demandé"
        />
        <Grandeur
          label="Taux proposé"
          valeur={tarif ? formatTaux(tarif.tauxPropose) : NULL_DISPLAY}
          base={tarif
            ? <>Base {formatTaux(tarif.tauxBase)} · bande de score {tarif.bandeScoreMin ?? NULL_DISPLAY} · ajustement {formatTaux(tarif.ajustement)}{tarif.plancherApplique ? ' · plancher appliqué' : ''}</>
            : 'Analyse antérieure à la grille unique : non tarifée, et non re-tarifée après coup'}
        />
        <Grandeur
          label="Exécutée le"
          valeur={formatDateTimeFr(analyse.executeLe)}
          base={`Moteur v${analyse.versionMoteur ?? NULL_DISPLAY} · analyse n° ${formatEntier(analyse.id)}`}
        />
      </div>

      <div className="px-4 pb-4">
        <Note tone="info">
          Lignage de cette analyse : feuille de besoins n°{' '}
          {formatEntier(analyse.lignage?.needsSourceId)}, révision{' '}
          {formatEntier(analyse.lignage?.revision)}, empreinte{' '}
          <span className="font-mono">{abregerSha(analyse.lignage?.sha256)}</span>. Deux analyses
          successives se comparent par ces trois valeurs — un changement d'empreinte entre deux
          exécutions signifie que le classeur scoré n'est plus le même.
        </Note>
      </div>

      <div className="overflow-x-auto border-t border-white/10">
        <table className="w-full text-sm">
          <caption className="sr-only">Décomposition du score global par critère</caption>
          <thead className="text-slate-400 border-b border-white/10">
            <tr>
              <th scope="col" className="text-left p-3">Critère</th>
              <th scope="col" className="text-right p-3">Score</th>
              <th scope="col" className="text-right p-3">Poids</th>
              <th scope="col" className="text-right p-3">Points</th>
              <th scope="col" className="text-left p-3">Lecture du moteur</th>
            </tr>
          </thead>
          <tbody>
            {ORDRE.map((cle) => {
              const c = analyse.criteres?.[cle];
              if (!c) return null;
              const commentaire = typeof c.details?.commentaire === 'string' ? c.details.commentaire : '';
              return (
                <tr key={cle} className="border-t border-white/5 align-top">
                  <td className="p-3 text-white">{LIBELLES_CRITERES[cle] ?? cle}</td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">{formatScore(c.score)}</td>
                  <td className="p-3 text-right text-slate-400 tabular-nums">{formatPoids(c.poids)}</td>
                  <td className="p-3 text-right text-white font-medium tabular-nums">{formatPoints(c.points)}</td>
                  <td className="p-3 text-xs text-slate-400 max-w-xl leading-relaxed">
                    {commentaire || NULL_DISPLAY}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 bg-white/5">
              <td className="p-3 text-slate-300 font-medium" colSpan={3}>Score global</td>
              <td className="p-3 text-right text-white font-bold tabular-nums">
                {formatScore(analyse.scoreGlobal)}
              </td>
              <td className="p-3 text-[11px] text-slate-500">
                Somme des points arrondis par le moteur, jamais recalculée à l'écran.
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
};

export default RecommandationMoteur;
