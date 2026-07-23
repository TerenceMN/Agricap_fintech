/**
 * Agenda global des remboursements (gap #5) — la vue calendrier des prochaines
 * échéances, servie par `GET /portfolio/calendar` (dossiers actifs, triés par
 * date). Ouverte depuis le bouton « Vue Échéances » du tableau de bord crédit.
 *
 * Groupée par mois puis par jour. Chaque échéance renvoie au besoin à
 * l'échéancier complet de SON dossier (réutilise `LoanScheduleModal`, gap #4).
 *
 * ⚠ Principe front « zéro chiffre métier calculé côté client » : l'écran ne
 * SOMME jamais les montants d'une journée ni d'un mois (ce serait un agrégat
 * financier fabriqué au navigateur). Il regroupe, il COMPTE des échéances, et
 * affiche pour chaque ligne les montants tels que servis par le serveur.
 *
 * NB : composant en `.jsx` (et non `.tsx`) parce qu'il consomme les primitives
 * UI `.jsx` (Dialog) non typées — convention du projet, cf. les autres écrans.
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  referentielApi, isForbidden, groupCalendarByMonth, monthLabel, fmtDate,
} from '@/services/referentielApi';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors,
} from '@/components/backoffice/States';
import { formatCurrency } from '@/lib/utils';
import LoanScheduleModal from './LoanScheduleModal';

const RepaymentCalendar = ({ open, onClose }) => {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [forbidden, setForbidden] = useState(null);
  const [scheduleRef, setScheduleRef] = useState(null);
  const [scheduleOperator, setScheduleOperator] = useState(undefined);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    referentielApi.calendar()
      .then((res) => { if (alive) setEntries(res); })
      .catch((e) => {
        if (!alive) return;
        if (isForbidden(e)) setForbidden(e.message);
        else setErrors(toFieldErrors(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  const months = groupCalendarByMonth(entries ?? []);
  const totalEntries = entries?.length ?? 0;

  const openSchedule = (e) => {
    setScheduleOperator(e.operator);
    setScheduleRef(e.reference);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl bg-slate-900 border-slate-700 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agenda des remboursements</DialogTitle>
            <DialogDescription className="text-slate-400">
              Prochaines échéances des dossiers actifs, servies par le serveur et triées par date.
              Les montants ne sont pas agrégés au navigateur — chaque ligne affiche la valeur du
              serveur.
            </DialogDescription>
          </DialogHeader>

          {loading && <Loading label="Chargement de l'agenda…" />}

          {forbidden && (
            <Forbidden message="Agenda réservé au personnel." detail={forbidden} />
          )}

          <ErrorPanel errors={errors} title="Agenda indisponible" />

          {!loading && !forbidden && errors.length === 0 && totalEntries === 0 && (
            <Empty
              title="Aucune échéance à venir."
              hint="Aucun dossier actif (en cours ou approuvé) ne porte d'échéance : rien à programmer pour l'instant."
            />
          )}

          {!loading && totalEntries > 0 && (
            <div className="space-y-5">
              <p className="text-xs text-slate-500">
                {totalEntries} échéance(s) sur {months.length} mois.
              </p>
              {months.map((m) => (
                <section key={m.key}>
                  <h4 className="text-sm font-semibold text-emerald-200 capitalize mb-2">
                    {monthLabel(m.key)}
                  </h4>
                  <div className="space-y-3">
                    {m.days.map((d) => (
                      <div key={d.date} className="rounded-lg border border-white/10 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-white/5">
                          <span className="text-sm text-slate-200">{fmtDate(d.date)}</span>
                          <span className="text-xs text-slate-500">{d.entries.length} échéance(s)</span>
                        </div>
                        <ul className="divide-y divide-white/5">
                          {d.entries.map((e, i) => (
                            <li key={`${e.reference}-${e.number}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-sm text-white truncate">
                                  <span className="font-mono text-xs text-slate-400 mr-2">{e.reference}</span>
                                  {e.operator}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Échéance n° {e.number} · principal {formatCurrency(e.principal, e.currency)} ·
                                  intérêts {formatCurrency(e.interest, e.currency)}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-sm text-white font-medium">{formatCurrency(e.total, e.currency)}</span>
                                <button
                                  type="button"
                                  onClick={() => openSchedule(e)}
                                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs"
                                >
                                  Échéancier
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <LoanScheduleModal
        loanRef={scheduleRef}
        operator={scheduleOperator}
        onClose={() => setScheduleRef(null)}
      />
    </>
  );
};

export default RepaymentCalendar;
