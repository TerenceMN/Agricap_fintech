import React from 'react';
import { Check, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateFr, formatMontant } from './format';
import ConsentCountdown from './ConsentCountdown';
import SolidarityCommitment from './SolidarityCommitment';
import { displayStatusMeta, isActionable } from './guaranteeRequestShape';

/**
 * Une demande de caution, telle qu'elle se présente au garant.
 *
 * ── Hiérarchie visuelle, et pourquoi elle est ainsi ────────────────────────
 * L'ordre de lecture est délibéré : qui demande → pourquoi vous → **ce à quoi
 * vous vous engagez** → combien de temps il vous reste → répondre. Le montant
 * couvert n'est pas rangé dans la grille d'information avec la filière et le
 * montant du crédit : il occupe son propre bloc, en typographie de titre
 * (`SolidarityCommitment`). Un garant doit pouvoir survoler cette carte et
 * n'avoir *aucune* chance de cliquer « Accepter » sans avoir lu ce qu'il doit.
 *
 * ── Les deux actions sont de poids égal ────────────────────────────────────
 * Accepter et Refuser sont deux boutons de même taille, côte à côte, à parts
 * égales de la largeur. Le refus n'est pas un lien discret à côté d'un gros
 * bouton vert : c'est une réponse légitime, souvent la bonne, et la mettre en
 * retrait serait une pression à s'engager. Le seul déséquilibre assumé est
 * dans la confirmation : accepter exige une case à cocher, refuser non — parce
 * que c'est accepter qui engage un patrimoine.
 *
 * ── Ce qui n'est pas calculé ───────────────────────────────────────────────
 * Rien. Montants, devises, statut, expiration : tout vient du serveur. Le seul
 * calcul de l'écran est le décompte du temps restant, qui est un affichage et
 * ne décide de rien (cf. `ConsentCountdown`).
 *
 * @param {{
 *   request: object,
 *   onAccept: (request: object) => void,
 *   onDecline: (request: object) => void,
 *   busy?: boolean,
 * }} props
 */
const GuaranteeRequestCard = ({ request, onAccept, onDecline, busy = false }) => {
  // `displayStatusMeta` et non `statusMeta` : une demande périmée est servie
  // avec `status: "pending_consent"` tant que personne ne l'a relue côté serveur
  // (pas d'ordonnanceur, cf. `guaranteeRequestShape.js`). Router le badge sur
  // `status` seul affichait « En attente de votre réponse » sur une demande
  // morte, sans bouton, rangée dans l'historique.
  const meta = displayStatusMeta(request);
  const actionable = isActionable(request);

  return (
    <article
      className={`glass-effect rounded-2xl p-5 sm:p-6 space-y-5 border ${
        actionable ? 'border-amber-500/30' : 'border-white/10 opacity-90'
      }`}
    >
      {/* ── Identité du demandeur et statut ─────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">
            Demande de caution solidaire
          </p>
          <h3 className="mt-1 truncate text-xl font-bold text-white">
            {request.applicantName || 'Demandeur non communiqué'}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {request.valueChainLabel
              ? <>Filière {request.valueChainLabel}</>
              : <span className="text-amber-300/70">Filière non communiquée</span>}
            {request.applicationCode && (
              <> · Dossier <span className="font-mono">{request.applicationCode}</span></>
            )}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${meta.badge}`}
        >
          {meta.label}
        </span>
      </header>

      {/* ── Le lien qui justifie la sollicitation ───────────────────────── */}
      {request.sharedGroups.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span>Vous partagez avec {request.applicantName || 'le demandeur'} :</span>
          {request.sharedGroups.map((g, i) => (
            <span
              key={g.id ?? i}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300"
            >
              {g.name || 'Groupe sans nom'}{g.type ? ` · ${g.type}` : ''}
            </span>
          ))}
        </p>
      )}

      {/* ── Contexte chiffré ─────────────────────────────────────────────
          Le montant du crédit est du contexte, PAS l'engagement du garant. Le
          libellé le dit, et la mise en forme le range délibérément en second
          plan par rapport au bloc d'engagement qui suit. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Crédit demandé par {request.applicantName || 'le demandeur'}
          </p>
          <p className="mt-1 text-lg font-semibold text-white">
            {formatMontant(request.loanAmount, request.loanCurrency)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Ce n'est pas le montant de votre engagement.
          </p>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Demande reçue le
          </p>
          <p className="mt-1 text-lg font-semibold text-white">
            {formatDateFr(request.createdAt)}
          </p>
          {request.consentedAt && (
            <p className="mt-1 text-[11px] text-emerald-300/80">
              Accepté le {formatDateFr(request.consentedAt)}
            </p>
          )}
          {request.declinedAt && (
            <p className="mt-1 text-[11px] text-slate-400">
              Refusé le {formatDateFr(request.declinedAt)}
            </p>
          )}
        </div>
      </div>

      {/* ── L'engagement, en clair — le cœur de l'écran (SPEC §2.5) ─────── */}
      <SolidarityCommitment
        applicantName={request.applicantName}
        coveredAmount={request.coveredAmount}
        currency={request.coveredCurrency}
        emphasis={actionable}
      />

      {/* ── Délai et actions ────────────────────────────────────────────── */}
      {actionable ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ConsentCountdown expiresAt={request.consentExpiresAt} />
            <p className="text-xs text-slate-500">
              Passé ce délai, la demande devient caduque.
            </p>
          </div>

          {/* Deux actions de poids égal — `flex-1` sur chacune. */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={() => onDecline(request)}
              disabled={busy}
              variant="outline"
              className="flex-1 border-2 border-red-500/60 bg-red-500/10 py-6 text-base font-semibold text-red-200 hover:bg-red-500/20 hover:text-red-100"
            >
              <X className="mr-2 h-5 w-5" aria-hidden="true" />
              Refuser cette caution
            </Button>
            <Button
              onClick={() => onAccept(request)}
              disabled={busy}
              className="flex-1 border-2 border-emerald-500/60 bg-emerald-600 py-6 text-base font-semibold text-white hover:bg-emerald-500"
            >
              <Check className="mr-2 h-5 w-5" aria-hidden="true" />
              Accepter et m'engager
            </Button>
          </div>

          <p className="text-center text-xs text-slate-500">
            Refuser est une réponse légitime et sans conséquence sur vos propres
            crédits. Ne vous engagez que si vous pourriez réellement payer cette somme.
          </p>
        </div>
      ) : (
        /* Demande close ou caduque : aucune action, et la raison est écrite.
           Une demande expirée n'est pas une demande en attente — elle ne doit
           pas offrir de bouton qui échouerait, ni laisser croire qu'elle vit
           encore. */
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
          {request.status === 'expired' || request.isExpired
            ? "Le délai de réponse est écoulé : cette demande est caduque. Si vous souhaitez toujours vous porter garant, le demandeur doit vous solliciter à nouveau depuis son dossier."
            : `Aucune action ne vous est demandée sur cette ligne — ${meta.label.toLowerCase()}.`}
        </p>
      )}
    </article>
  );
};

export default GuaranteeRequestCard;
