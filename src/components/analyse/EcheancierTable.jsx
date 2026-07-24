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
 * Les totaux viennent du bloc `totaux` servi par le moteur. `totalCommissions`
 * n'est **volontairement pas** au contrat tant que l'écart 25 vs 19,95 de la
 * SPEC §A.3 n'est pas tranché : absence de clé = « non implémenté », pas
 * « zéro ». On n'affiche donc pas de ligne commission à 0, qui laisserait croire
 * qu'il n'y en a pas.
 *
 * @param {{
 *   lignes: import('@/types/api').CreditEcheancierLigne[],
 *   currency?: string,
 *   totaux?: object|null,
 * }} props
 */
const EcheancierTable = ({ lignes = [], currency = '', totaux = null }) => {
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

  // La colonne n'apparaît que si des intérêts ont RÉELLEMENT été capitalisés.
  // En mode `interets_seuls`, le moteur sert `interetsCapitalises: 0.0` sur
  // chaque ligne : tester la seule présence de la clé afficherait une colonne
  // entière de zéros, qui se lit comme une information alors qu'elle n'en est
  // pas. Défaut trouvé en confrontant le branchement au payload observé.
  const avecCapitalises = lignes.some((l) => {
    const v = l?.interetsCapitalises;
    return v !== undefined && v !== null && Number(v) !== 0;
  });
  const visibles = tout ? lignes : lignes.slice(0, APERCU);
  const restantes = lignes.length - visibles.length;

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700">
        <h4 className="font-semibold text-white text-sm">Échéancier prévisionnel</h4>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {totaux?.nbEcheances ?? lignes.length} échéance(s) — montants arrêtés par le moteur,
          affichés tels quels.
        </p>
      </header>

      {totaux && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-slate-700">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Capital</p>
            <p className="font-bold text-blue-300 text-sm mt-0.5">
              {formatMontant(totaux.totalCapital, currency)}
            </p>
          </div>
          {/* « Coût du crédit » était un libellé trop fort pour la valeur servie :
              `totalInterets` ne porte QUE les intérêts. Les commissions ne sont pas
              au contrat du moteur (cf. en-tête), donc ce chiffre ne peut pas prétendre
              au coût total supporté par l'emprunteur. Le libellé dit maintenant ce
              qu'il additionne, et l'écran nomme ce qui manque. */}
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Intérêts totaux</p>
            <p className="font-bold text-amber-300 text-sm mt-0.5">
              {formatMontant(totaux.totalInterets, currency)}
            </p>
            {totaux.totalInteretsCapitalises !== undefined
              && Number(totaux.totalInteretsCapitalises) !== 0 && (
              <p className="text-[11px] text-orange-300/80 mt-1">
                dont {formatMontant(totaux.totalInteretsCapitalises, currency)} capitalisés
              </p>
            )}
            <p className="text-[11px] text-slate-500 mt-1">
              hors commissions et frais de dossier
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Service de la dette</p>
            <p className="font-bold text-white text-sm mt-0.5">
              {formatMontant(totaux.serviceDette, currency)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">dénominateur du DSCR</p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">CRD final</p>
            <p className={`font-bold text-sm mt-0.5 ${
              Number(totaux.crdFinal) === 0 ? 'text-emerald-300' : 'text-red-300'
            }`}>
              {formatMontant(totaux.crdFinal, currency)}
            </p>
            {Number(totaux.crdFinal) !== 0 && (
              <p className="text-[11px] text-red-300/90 mt-1">
                Devrait être nul — à signaler.
              </p>
            )}
          </div>
        </div>
      )}

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
