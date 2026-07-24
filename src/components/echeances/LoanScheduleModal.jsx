/**
 * Échéancier **gestionnaire** d'un dossier décaissé (gap #4). Remplace le toast
 * « ouvrez l'onglet Échéancier » par le vrai tableau servi par
 * `GET /portfolio/loans/<ref>/schedule` : numéro, date, principal, intérêts,
 * total de l'échéance, capital restant dû.
 *
 * ⚠ Principe front « zéro chiffre métier calculé côté client » : AUCUNE cellule
 * n'est recalculée. Le CRD, le principal, les intérêts et les totaux viennent du
 * serveur, qui seul tient les `Decimal` et l'arrondi de la dernière échéance
 * (CRD final rigoureusement nul, principe 4). L'écran affiche, il ne calcule pas.
 *
 * ⚠ `totals.apr` N'EST PAS UN TAEG — et n'est plus libellé ainsi.
 * `backend/portfolio/schedule.py::schedule_totals` le calcule comme
 * `intérêts totaux ÷ capital ÷ durée en années × 100` : un coût d'intérêts
 * rapporté au capital emprunté, ramené à l'année. Sur le cas de référence du
 * backend (1 330 USD, 18 %/an, 8 mois) il vaut 10,13 %, soit nettement MOINS que
 * le taux nominal du prêt — mécanique, puisque le capital s'amortit et que
 * l'encours moyen vaut environ la moitié du capital. Or un TAEG ne peut jamais
 * être inférieur au taux nominal, et celui-ci n'intègre ni frais de dossier ni
 * commissions ni actualisation des flux. Afficher « TAEG 10,13 % » sur un crédit
 * à 18 % annonçait donc à l'emprunteur un coût deux fois moindre que le sien.
 * Le libellé dit désormais ce que la valeur mesure, et le dit à l'écran ;
 * un vrai TAEG ne pourra venir que du serveur (cf. rapport de lot).
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

/**
 * Met en forme un ratio SERVI par le serveur (séparateur décimal fr-FR).
 *
 * Mise en forme seulement : rien n'est dérivé, combiné ni arrondi métier ici.
 * Renvoie `null` quand le serveur n'a pas servi de valeur exploitable — l'écran
 * dit alors « non servi », jamais « 0 % », qui se lirait comme une mesure.
 */
const fmtRatio = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

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
  const coutInterets = totals ? fmtRatio(totals.apr) : null;

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
          <div className="space-y-3">
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
                    {/* Colonne « Capital restant dû » : pas de total — la dernière
                        ligne porte déjà le solde final, qui doit être nul. C'est
                        ici que se logeait le prétendu « TAEG ». */}
                    <td className="p-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Coût du crédit — nommé pour ce qu'il est, pas pour ce qu'on
              aimerait afficher. Voir l'en-tête du fichier. */}
          {totals && (
            <div className="text-[11px] leading-relaxed text-slate-500 space-y-1 px-1">
              {coutInterets === null ? (
                <p className="text-slate-300">
                  Coût des intérêts rapporté au capital :{' '}
                  <span className="text-amber-300/90">non servi par le serveur</span> pour ce
                  prêt. Aucune valeur n'est reconstituée à l'écran.
                </p>
              ) : (
                <p className="text-slate-300">
                  Coût des intérêts :{' '}
                  <span className="font-semibold text-white">
                    {coutInterets} % du capital par an
                  </span>
                  {' '}— <span className="text-amber-300/90">ce n'est pas un TAEG</span>.
                </p>
              )}
              <p>
                Le serveur rapporte les intérêts totaux au capital emprunté et ramène le
                résultat à l'année (intérêts ÷ capital ÷ durée). Ce ratio exclut les frais de
                dossier et les commissions, et il est mécaniquement inférieur au taux nominal
                du prêt puisque le capital s'amortit — alors qu'un TAEG ne peut jamais être
                inférieur au taux nominal. Il ne doit donc pas être communiqué à l'emprunteur
                comme un taux. Le TAEG (frais et commissions inclus, flux actualisés) sera
                affiché ici lorsque le serveur le calculera.
              </p>
            </div>
          )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LoanScheduleModal;
