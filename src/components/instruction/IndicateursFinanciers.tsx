/**
 * DSCR, stress test, mois le plus tendu, levier chiffré.
 *
 * §4.6 — « un DSCR de 0,64 est livré avec son facteur dominant et son levier
 * chiffré ». Les trois viennent du serveur : `facteurDominant` et `levier` sont
 * des phrases produites par `analyse.py`, et `alternativesDiffere` est une
 * COURBE calculée en reconstruisant l'échéancier à différé réduit sur les mêmes
 * cash-flows. Rien de tout cela n'est approché à l'écran.
 *
 * L'hypothèse de cash-flows est affichée en premier plan, pas en note de bas de
 * page : le classeur ingéré ne comporte pas de trésorerie prévisionnelle, le
 * moteur la PROJETTE depuis le rendement du référentiel. Un DSCR dont le
 * numérateur est une hypothèse ne se lit pas comme un DSCR déclaré, et
 * l'analyste doit pouvoir contester l'hypothèse plutôt que le ratio.
 */
import React from 'react';
import type { CreditAnalyse } from '@/types/api';
import { Card, CardHead, Grandeur, Note } from './Bits';
import {
  NULL_DISPLAY, formatDscr, formatEntier, formatMontant, formatPourcent,
} from './format';

function nombre(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function chaine(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const IndicateursFinanciers: React.FC<{ analyse: CreditAnalyse }> = ({ analyse }) => {
  const devise = analyse.devise || analyse.parametres?.devise || '';
  const dDscr = analyse.criteres?.dscr?.details ?? {};
  const dStress = analyse.criteres?.stress?.details ?? {};
  const diag = dDscr.diagnostic ?? {};
  const hypothese = diag.hypotheseCashFlows;
  const tendu = diag.moisLePlusTendu;
  const alternatives = Array.isArray(diag.alternativesDiffere) ? diag.alternativesDiffere : [];
  const chocPct = nombre((dStress as Record<string, unknown>).chocPct);
  const projete = hypothese?.origine === 'projection_referentiel';

  return (
    <Card>
      <CardHead
        title="Capacité de remboursement"
        subtitle={
          "DSCR global, DSCR sous choc de revenus et mois le plus tendu — tous calculés par le "
          + "moteur sur l'échéancier ci-dessus. Un DSCR global sain peut masquer un mois à 0,2 : "
          + "c'est le mois tendu qui fait défaut, pas la moyenne."
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        <Grandeur
          label="DSCR global"
          valeur={formatDscr(analyse.dscr)}
          tone={analyse.dscr !== null && analyse.dscr < 1 ? 'rouge' : 'vert'}
          base={`Σ cash-flows ÷ service de la dette (${formatMontant(nombre(diag.serviceDette), devise)})`}
        />
        <Grandeur
          label="DSCR sous stress"
          valeur={formatDscr(analyse.dscrStress)}
          tone={analyse.dscrStress !== null && analyse.dscrStress < 1 ? 'ambre' : 'vert'}
          base={chocPct === null
            ? 'Amplitude du choc non servie'
            : <>Choc de revenus appliqué : {formatPourcent(chocPct)}</>}
        />
        <Grandeur
          label="Cash-flows retenus"
          valeur={formatMontant(nombre(diag.cashFlowTotal), devise)}
          base={projete ? 'Projetés depuis le référentiel — hypothèse' : 'Fournis au moteur'}
        />
        <Grandeur
          label="Mois le plus tendu"
          valeur={tendu?.mois === undefined ? NULL_DISPLAY : `Mois ${formatEntier(tendu.mois)}`}
          tone="ambre"
          base={tendu?.dscr === undefined
            ? 'Aucune échéance exigible'
            : <>DSCR du mois : {formatDscr(tendu.dscr)} — échéance {formatMontant(tendu.echeance, devise)}, disponible {formatMontant(tendu.cashFlow, devise)}</>}
        />
      </div>

      {projete && (
        <div className="px-4 pb-4">
          <Note tone="attention" title="Le numérateur du DSCR est une hypothèse, pas une déclaration">
            {chaine(hypothese?.commentaire) || 'Cash-flows projetés depuis le référentiel filière.'}
            {' '}
            Revenu brut projeté {formatMontant(hypothese?.revenuBrut, devise)}, charges du plan{' '}
            {formatMontant(hypothese?.chargesPlan, devise)}, marge nette du cycle{' '}
            {formatMontant(hypothese?.margeNetteCycle, devise)}. À valider avec le demandeur
            avant de conclure sur ce critère.
          </Note>
        </div>
      )}

      {(dDscr.facteurDominant || dDscr.levier) && (
        <div className="px-4 pb-4 space-y-2">
          {dDscr.facteurDominant && (
            <Note tone="info" title="Facteur dominant">{dDscr.facteurDominant}</Note>
          )}
          {dDscr.levier && <Note tone="ok" title="Levier chiffré">{dDscr.levier}</Note>}
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="border-t border-white/10">
          <p className="px-4 pt-3 text-xs text-slate-400">
            Ce que donnerait un autre différé, à cash-flows inchangés — courbe calculée par le
            moteur en reconstruisant l'échéancier, pas une extrapolation d'écran.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th scope="col" className="text-left p-3">Différé simulé</th>
                  <th scope="col" className="text-right p-3">DSCR obtenu</th>
                  <th scope="col" className="text-right p-3">Service de la dette</th>
                </tr>
              </thead>
              <tbody>
                {alternatives.map((a) => (
                  <tr key={a.differeMois} className="border-t border-white/5">
                    <td className="p-3 text-slate-300">
                      {a.differeMois === 0 ? 'Aucun différé' : `${formatEntier(a.differeMois)} mois`}
                    </td>
                    <td className="p-3 text-right text-white tabular-nums">{formatDscr(a.dscr)}</td>
                    <td className="p-3 text-right text-slate-300 tabular-nums">
                      {formatMontant(a.serviceDette, devise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-slate-500 border-t border-white/10">
            Une ligne de ce tableau ne devient réelle qu'en relançant le moteur avec ce différé :
            l'écran ne substitue pas une projection à une analyse.
          </p>
        </div>
      )}
    </Card>
  );
};

export default IndicateursFinanciers;
