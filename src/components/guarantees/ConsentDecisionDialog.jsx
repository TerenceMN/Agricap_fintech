import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorPanel } from '@/components/backoffice/States';
import SolidarityCommitment from './SolidarityCommitment';
import ConsentCountdown from './ConsentCountdown';

/**
 * Confirmation d'une réponse du garant — accepter ou refuser.
 *
 * ── Pourquoi une confirmation, et pourquoi asymétrique ─────────────────────
 * Le principe posé par la SPEC est qu'accepter une caution est un acte
 * juridique. Un acte juridique ne se conclut pas au premier clic d'une liste :
 * l'engagement est donc **répété intégralement** ici, hors du contexte de la
 * carte, avec une case à cocher qui oblige à le reconnaître explicitement. Le
 * bouton de confirmation reste inerte tant qu'elle n'est pas cochée — même
 * mécanique que l'avertissement avant modification d'un actif vérifié dans
 * `AssetFormDialog`, pour la même raison : rendre l'irréversible délibéré.
 *
 * Le refus, lui, ne demande **pas** de case à cocher. Il n'engage aucun
 * patrimoine, et alourdir le chemin du refus au même niveau que celui de
 * l'acceptation créerait exactement la pression que cet écran doit éviter. Il
 * garde toutefois sa confirmation, parce qu'il est définitif côté serveur
 * (`GUARANTOR_ALREADY_ANSWERED` sur toute seconde tentative) — et c'est écrit.
 *
 * ── Les refus serveur s'affichent ici, pas ailleurs ────────────────────────
 * Un refus (`GUARANTOR_OVEREXTENDED`, `GUARANTOR_CONSENT_EXPIRED`…) arrive en
 * réponse à *cette* décision : il s'affiche dans le dialogue qui l'a provoquée,
 * à côté du bouton qui vient d'échouer. Le renvoyer en toast le ferait
 * disparaître avant lecture, sur des messages qui expliquent une situation
 * financière en plusieurs phrases.
 *
 * @param {{
 *   open: boolean,
 *   decision: 'accept' | 'decline' | null,
 *   request: object|null,
 *   submitting: boolean,
 *   errors: Array<{code?: string, message: string}>,
 *   onCancel: () => void,
 *   onConfirm: () => void,
 * }} props
 */
const ConsentDecisionDialog = ({
  open, decision, request, submitting, errors, onCancel, onConfirm,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);

  // La case se décoche à chaque ouverture : une reconnaissance ne se reporte pas
  // d'une demande à l'autre, ni d'une tentative à la suivante.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open, request?.id, decision]);

  if (!request || !decision) return null;

  const isAccept = decision === 'accept';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isAccept
              ? 'Confirmer votre engagement de caution'
              : 'Confirmer votre refus'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isAccept ? (
              <>
                Relisez l'engagement ci-dessous. Une fois confirmé, il est
                enregistré, horodaté et <strong className="text-slate-300">ne peut
                plus être repris</strong> depuis cet écran.
              </>
            ) : (
              <>
                Vous vous apprêtez à refuser de garantir le crédit de{' '}
                {request.applicantName || 'ce demandeur'}. Ce refus est définitif :
                vous ne pourrez pas revenir sur cette demande.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isAccept ? (
            <>
              <SolidarityCommitment
                applicantName={request.applicantName}
                coveredAmount={request.coveredAmount}
                currency={request.coveredCurrency}
              />

              <div className="flex items-center justify-between gap-3">
                <ConsentCountdown expiresAt={request.consentExpiresAt} />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                  disabled={submitting}
                  className="mt-0.5 border-amber-400 data-[state=checked]:bg-amber-500"
                />
                <span className="text-sm leading-relaxed text-slate-200">
                  J'ai lu et je comprends que je m'engage solidairement, et
                  qu'AGRICAP pourra me réclamer cette somme directement si{' '}
                  {request.applicantName || 'le demandeur'} ne rembourse pas.
                </span>
              </label>
            </>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-slate-300">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>
                  Refuser est une réponse légitime. Cela n'a aucune conséquence sur
                  vos propres crédits ou votre épargne, et n'est pas communiqué comme
                  un incident. Le demandeur sera informé qu'il doit trouver un autre
                  garant.
                </span>
              </p>
            </div>
          )}

          {/* Une ligne par cause, avec son code — principe 5. */}
          <ErrorPanel
            errors={errors}
            title={
              errors.length > 1
                ? `${errors.length} raisons empêchent d'enregistrer votre réponse`
                : "Votre réponse n'a pas pu être enregistrée"
            }
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="border-white/20 bg-transparent hover:bg-white/10"
          >
            Annuler
          </Button>
          <Button
            onClick={onConfirm}
            // Le seul verrou côté front : la case de reconnaissance. Tout le
            // reste (capacité, délai, désignation) est re-vérifié par le serveur
            // à cet instant — le front ne présume d'aucune de ces règles.
            disabled={submitting || (isAccept && !acknowledged)}
            className={
              isAccept
                ? 'bg-emerald-600 font-semibold text-white hover:bg-emerald-500'
                : 'bg-red-600 font-semibold text-white hover:bg-red-500'
            }
          >
            {submitting
              ? 'Enregistrement…'
              : isAccept
                ? "Je m'engage"
                : 'Confirmer le refus'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConsentDecisionDialog;
