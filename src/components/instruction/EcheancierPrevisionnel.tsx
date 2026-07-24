/**
 * Échéancier prévisionnel — servi ligne à ligne par le moteur.
 *
 * Chaque montant vient de `credits/echeancier.py` (`Decimal`, quantize 0,01,
 * dernière échéance ajustée au solde exact). Le front n'additionne AUCUNE
 * colonne : les totaux viennent de `analyse.totaux`, calculés serveur. Sommer
 * ici une colonne de `number` produirait un total qui diffère de celui du moteur
 * au centime — et c'est justement ce total-là qu'un analyste compare.
 *
 * `crdFinal` est affiché comme ce qu'il est : un INVARIANT (§5). Un capital
 * restant dû non nul en fin d'échéancier est un défaut du moteur ; l'écran le
 * signale au lieu de l'arrondir à zéro pour faire joli.
 */
import React from 'react';
import type { CreditAnalyse } from '@/types/api';
import { Card, CardHead, Grandeur, Note, Pill } from './Bits';
import { NULL_DISPLAY, estNombre, formatEntier, formatMontant, formatMois, formatTaux } from './format';
import { libelleMode } from './parametres';

const TONE_PHASE: Record<string, 'info' | 'neutre' | 'attention'> = {
  'différé': 'info',
  franchise: 'attention',
  amortissement: 'neutre',
};

const EcheancierPrevisionnel: React.FC<{ analyse: CreditAnalyse }> = ({ analyse }) => {
  const lignes = Array.isArray(analyse.echeancier) ? analyse.echeancier : [];
  const totaux = analyse.totaux;
  const devise = analyse.devise || analyse.parametres?.devise || '';
  const crdNonNul = estNombre(totaux?.crdFinal) && totaux.crdFinal !== 0;

  return (
    <Card>
      <CardHead
        title="Échéancier prévisionnel"
        subtitle={
          `Construit par le moteur pour ${formatMois(analyse.parametres?.dureeMois)} `
          + `dont ${formatMois(analyse.parametres?.differeMois)} de différé `
          + `(${libelleMode(analyse.parametres?.modeDiffere)}), au taux de `
          + `${formatTaux(analyse.parametres?.tauxAnnuel)} par an sur un capital de `
          + `${formatMontant(analyse.parametres?.capital, devise)}. Aucun de ces montants n'est `
          + `recalculé à l'écran.`
        }
      />

      {lignes.length === 0 ? (
        <div className="p-6">
          <Note tone="attention">
            Cette analyse ne porte aucun échéancier. Rien n'est reconstitué ici : un échéancier
            calculé au navigateur ne serait pas celui contre lequel le DSCR a été jugé.
          </Note>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-4 border-b border-white/10">
            <Grandeur
              label="Service de la dette"
              valeur={formatMontant(totaux?.serviceDette, devise)}
              base={`Sur ${formatEntier(totaux?.nbEcheances)} échéance(s)`}
            />
            <Grandeur label="Capital remboursé" valeur={formatMontant(totaux?.totalCapital, devise)} />
            <Grandeur label="Intérêts payés" valeur={formatMontant(totaux?.totalInterets, devise)} />
            <Grandeur
              label="Intérêts capitalisés"
              valeur={formatMontant(totaux?.totalInteretsCapitalises, devise)}
              base="Non nuls en franchise totale uniquement"
            />
            <Grandeur
              label="CRD final"
              valeur={formatMontant(totaux?.crdFinal, devise)}
              tone={crdNonNul ? 'rouge' : 'vert'}
              base="Invariant : doit valoir zéro"
            />
          </div>

          {crdNonNul && (
            <div className="px-4 pt-4">
              <Note tone="alerte" title="Capital restant dû non nul en fin d'échéancier">
                Le moteur devrait solder le capital à la dernière échéance. Cet écart n'est pas
                affiché comme une approximation : il signale un défaut de calcul serveur à
                remonter avant toute décision sur ce dossier.
              </Note>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <caption className="sr-only">
                Échéancier prévisionnel du dossier {analyse.reference}
              </caption>
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th scope="col" className="text-left p-3">Mois</th>
                  <th scope="col" className="text-left p-3">Phase</th>
                  <th scope="col" className="text-right p-3">Capital</th>
                  <th scope="col" className="text-right p-3">Intérêts</th>
                  <th scope="col" className="text-right p-3">Int. capitalisés</th>
                  <th scope="col" className="text-right p-3">Échéance</th>
                  <th scope="col" className="text-right p-3">CRD</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.mois} className="border-t border-white/5 hover:bg-white/5">
                    <td className="p-3 text-slate-300 tabular-nums">{formatEntier(l.mois)}</td>
                    <td className="p-3">
                      <Pill label={l.phase ?? NULL_DISPLAY} tone={TONE_PHASE[l.phase] ?? 'neutre'} />
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">
                      {formatMontant(l.capital, '')}
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">
                      {formatMontant(l.interets, '')}
                    </td>
                    <td className="p-3 text-right text-slate-400 tabular-nums">
                      {formatMontant(l.interetsCapitalises, '')}
                    </td>
                    <td className="p-3 text-right text-white font-medium tabular-nums">
                      {formatMontant(l.echeance, '')}
                    </td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">
                      {formatMontant(l.crd, '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="px-4 py-3 text-[11px] text-slate-500 border-t border-white/10">
            Montants en {devise || NULL_DISPLAY}. Totaux calculés par le moteur, pas par
            l'addition des lignes affichées.
          </p>
        </>
      )}
    </Card>
  );
};

export default EcheancierPrevisionnel;
