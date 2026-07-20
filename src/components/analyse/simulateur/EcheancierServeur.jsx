import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatMontant } from './format';

/**
 * Échéancier prévisionnel **servi par le moteur** (`CreditAnalyse.echeancier`).
 *
 * Ce composant n'affiche que des lignes reçues : ni mensualité, ni intérêt, ni
 * capital restant dû n'est calculé ici. L'annexe A de la SPEC donne les formules
 * (capital constant, intérêts sur le solde de début de mois, dernière échéance
 * ajustée au solde exact) — elles servent à LIRE ce tableau, pas à le produire.
 *
 * Les totaux (coût du crédit, service de la dette) ne sont volontairement PAS
 * affichés : le contrat `CreditAnalyse` ne les porte pas, et les recomposer par
 * somme des lignes créerait un chiffre du navigateur à côté d'un chiffre serveur
 * — exactement la « double réalité » que ce module élimine. Ils s'afficheront
 * le jour où le moteur les servira.
 */

const PHASE_STYLE = (phase) => {
  const p = (phase || '').toLowerCase();
  if (p.startsWith('amort')) return 'text-emerald-300 border-emerald-500/30';
  if (p.startsWith('franchise')) return 'text-red-300 border-red-500/30';
  return 'text-amber-300 border-amber-500/30'; // différé
};

const EcheancierServeur = ({ lignes, currency = 'USD' }) => {
  if (!lignes || lignes.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-6 text-center text-sm text-slate-400">
        Le moteur n'a renvoyé aucune ligne d'échéancier pour cette analyse.
      </div>
    );
  }

  // Certaines analyses portent des intérêts capitalisés (mode franchise totale) :
  // la colonne n'apparaît que si le serveur l'alimente.
  const avecCapitalises = lignes.some(
    (l) => l.interetsCapitalises !== undefined && l.interetsCapitalises !== null,
  );

  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden flex flex-col">
      <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 flex justify-between items-center">
        <span>Échéancier prévisionnel — calculé et servi par le moteur ({currency})</span>
        <Badge variant="outline" className="text-[10px] h-5">{lignes.length} échéances</Badge>
      </div>
      <div className="overflow-auto max-h-[320px] bg-slate-900/30">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent text-[10px] uppercase">
              <TableHead className="w-12">Mois</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead className="text-right">Capital</TableHead>
              <TableHead className="text-right">Intérêts</TableHead>
              {avecCapitalises && <TableHead className="text-right">Int. capitalisés</TableHead>}
              <TableHead className="text-right text-white">Échéance</TableHead>
              <TableHead className="text-right">CRD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((l) => (
              <TableRow key={l.mois} className="border-slate-800/50 hover:bg-slate-800/30 text-xs">
                <TableCell className="font-mono text-slate-500">{l.mois}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] h-5 ${PHASE_STYLE(l.phase)}`}>
                    {l.phase}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-slate-300">
                  {formatMontant(l.capital, '', { decimals: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono text-emerald-500/80">
                  {formatMontant(l.interets, '', { decimals: 2 })}
                </TableCell>
                {avecCapitalises && (
                  <TableCell className="text-right font-mono text-orange-400/80">
                    {formatMontant(l.interetsCapitalises, '', { decimals: 2 })}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono font-medium text-white">
                  {formatMontant(l.echeance, '', { decimals: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono text-slate-500">
                  {formatMontant(l.crd, '', { decimals: 2 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default EcheancierServeur;
