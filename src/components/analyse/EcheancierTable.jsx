import React, { useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CalendarDays } from 'lucide-react';
import { formatMontant } from './analyseFormat';

/** Au-delà de ce nombre de lignes, l'affichage est tronqué et l'annonce (SPEC §A.4). */
const APERCU = 24;

const PHASE_CLASS = {
  'différé': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  franchise: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  amortissement: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

/**
 * Échéancier prévisionnel produit par le moteur.
 *
 * **Aucun montant n'est recalculé ni totalisé ici** : le serveur les a arrêtés
 * en `Decimal` avec `ROUND_HALF_UP` et la dernière échéance ajustée au solde
 * exact (principe 4). Refaire la somme en JavaScript, c'est fabriquer une
 * seconde vérité financière en `float` — précisément ce que le projet interdit.
 *
 * Les totaux (coût du crédit, service de la dette) ne figurent pas dans le
 * contrat `CreditAnalyse` ; tant que le backend ne les sert pas, ils ne sont
 * pas affichés plutôt qu'estimés.
 *
 * @param {{lignes: import('@/types/api').CreditEcheancierLigne[], currency?: string}} props
 */
const EcheancierTable = ({ lignes = [], currency = '' }) => {
  const [tout, setTout] = useState(false);

  if (!Array.isArray(lignes) || lignes.length === 0) {
    return (
      <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 text-center">
        <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-400" aria-hidden="true" />
        <p className="text-sm text-slate-400">
          Aucun échéancier prévisionnel joint à cette analyse.
        </p>
      </section>
    );
  }

  const avecCapitalises = lignes.some(
    (l) => l?.interetsCapitalises !== undefined && l?.interetsCapitalises !== null,
  );
  const visibles = tout ? lignes : lignes.slice(0, APERCU);
  const restantes = lignes.length - visibles.length;

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-white text-sm">Échéancier prévisionnel</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {lignes.length} échéance(s) — montants arrêtés par le moteur, affichés tels quels
            {currency ? '' : ' (devise non portée par la réponse d’analyse)'}.
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700 hover:bg-transparent">
              <TableHead className="text-slate-400 w-12">Mois</TableHead>
              <TableHead className="text-slate-400">Phase</TableHead>
              <TableHead className="text-right text-slate-400">Capital</TableHead>
              <TableHead className="text-right text-slate-400">Intérêts</TableHead>
              {avecCapitalises && (
                <TableHead className="text-right text-slate-400">Int. capitalisés</TableHead>
              )}
              <TableHead className="text-right text-slate-400">Échéance</TableHead>
              <TableHead className="text-right text-slate-400">Capital restant dû</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((l, i) => (
              <TableRow
                key={l?.mois ?? i}
                className="border-slate-800 hover:bg-slate-800/40 text-sm tabular-nums"
              >
                <TableCell className="text-slate-500">{l?.mois ?? '—'}</TableCell>
                <TableCell>
                  <span
                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                      PHASE_CLASS[l?.phase] || 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                    }`}
                  >
                    {l?.phase ?? '—'}
                  </span>
                </TableCell>
                <TableCell className="text-right text-blue-300">
                  {formatMontant(l?.capital, currency)}
                </TableCell>
                <TableCell className="text-right text-amber-300">
                  {formatMontant(l?.interets, currency)}
                </TableCell>
                {avecCapitalises && (
                  <TableCell className="text-right text-orange-300">
                    {formatMontant(l?.interetsCapitalises, currency)}
                  </TableCell>
                )}
                <TableCell className="text-right font-semibold text-white">
                  {formatMontant(l?.echeance, currency)}
                </TableCell>
                <TableCell className="text-right text-slate-300">
                  {formatMontant(l?.crd, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {restantes > 0 && (
        <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-300/90">
            … {restantes} échéance(s) supplémentaire(s) non affichée(s).
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 hover:bg-slate-700"
            onClick={() => setTout(true)}
          >
            Tout afficher
          </Button>
        </div>
      )}
      {tout && lignes.length > APERCU && (
        <div className="px-4 py-3 border-t border-slate-700 text-right">
          <Button
            size="sm"
            variant="ghost"
            className="text-slate-300 hover:bg-slate-700"
            onClick={() => setTout(false)}
          >
            Réduire
          </Button>
        </div>
      )}
    </section>
  );
};

export default EcheancierTable;
