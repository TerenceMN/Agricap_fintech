/**
 * Échéancier **gestionnaire** d'un dossier décaissé (gap #4). Remplace le toast
 * « ouvrez l'onglet Échéancier » par le vrai tableau servi par
 * `GET /portfolio/loans/<ref>/schedule` : numéro, date, principal, intérêts,
 * total de l'échéance, capital restant dû.
 *
 * ⚠ Principe front « zéro chiffre métier calculé côté client » : AUCUNE cellule
 * n'est recalculée. Le CRD, le principal, les intérêts et les totaux (dont l'APR)
 * viennent du serveur, qui seul tient les `Decimal` et l'arrondi de la dernière
 * échéance (CRD final rigoureusement nul, principe 4). L'écran affiche, il ne
 * calcule pas.
 *
 * NB : composant en `.jsx` (et non `.tsx`) parce qu'il consomme les primitives
 * UI `.jsx` (Dialog) non typées — convention du projet, cf. les autres écrans.
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { referentielApi, isForbidden } from '@/services/referentielApi';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors,
} from '@/components/backoffice/States';
import { formatCurrency } from '@/lib/utils';

const LoanScheduleModal = ({ loanRef, operator, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [forbidden, setForbidden] = useState(null);

  useEffect(() => {
    if (!loanRef) return undefined;
    let alive = true;
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    setData(null);
    referentielApi.loanSchedule(loanRef)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => {
        if (!alive) return;
        if (isForbidden(e)) setForbidden(e.message);
        else setErrors(toFieldErrors(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loanRef]);

  const currency = data?.currency || 'USD';
  const rows = data?.schedule ?? [];
  const totals = data?.totals;

  return (
    <Dialog open={loanRef !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl bg-slate-900 border-slate-700 text-white max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Échéancier — {loanRef}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {operator ? `${operator} · ` : ''}Montants servis par le serveur (Decimal, arrondi
            réglementaire). Aucune valeur n'est recalculée à l'écran.
          </DialogDescription>
        </DialogHeader>

        {loading && <Loading label="Chargement de l'échéancier…" />}

        {forbidden && (
          <Forbidden message="Échéancier réservé au personnel." detail={forbidden} />
        )}

        <ErrorPanel errors={errors} title="Échéancier indisponible" />

        {!loading && !forbidden && errors.length === 0 && rows.length === 0 && (
          <Empty
            title="Aucune échéance à afficher."
            hint="Ce dossier n'a pas d'échéancier : il n'est peut-être pas encore décaissé, ou la configuration de taux/durée reste à saisir."
          />
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-slate-400 bg-white/5">
                <tr>
                  <th className="text-center p-3">#</th>
                  <th className="text-left p-3">Date</th>
                  <th className="text-right p-3">Principal</th>
                  <th className="text-right p-3">Intérêts</th>
                  <th className="text-right p-3">Échéance</th>
                  <th className="text-right p-3">Capital restant dû</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.number} className="border-t border-white/5 hover:bg-white/5">
                    <td className="p-3 text-center text-slate-400">{r.number}</td>
                    <td className="p-3 text-slate-300">{r.date}</td>
                    <td className="p-3 text-right text-slate-200">{formatCurrency(r.principal, currency)}</td>
                    <td className="p-3 text-right text-slate-200">{formatCurrency(r.interest, currency)}</td>
                    <td className="p-3 text-right text-white font-medium">{formatCurrency(r.total, currency)}</td>
                    <td className="p-3 text-right text-slate-300">{formatCurrency(r.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="border-t border-white/10 bg-white/5">
                  <tr>
                    <td className="p-3 text-slate-400" colSpan={2}>Totaux (serveur)</td>
                    <td className="p-3 text-right text-slate-200">{formatCurrency(totals.total_principal, currency)}</td>
                    <td className="p-3 text-right text-slate-200">{formatCurrency(totals.total_interest, currency)}</td>
                    <td className="p-3 text-right text-white font-semibold">{formatCurrency(totals.total_payments, currency)}</td>
                    <td className="p-3 text-right text-slate-400 text-xs">
                      TAEG {typeof totals.apr === 'number' ? `${totals.apr.toFixed(2)} %` : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LoanScheduleModal;
