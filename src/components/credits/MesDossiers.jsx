/**
 * « Mes demandes de crédit » — la trace complète des démarches du client.
 *
 * Avant cet écran, le parcours client ne chargeait que le dossier `active` : un
 * demandeur déposait une demande et ne la revoyait plus jamais. Ni le refus et
 * son motif, ni l'accord en attente de décaissement, ni la demande d'un
 * complément d'information n'avaient de surface. Le client devait appeler son
 * agence pour savoir où il en était.
 *
 * Rien n'est masqué ici, et surtout pas les refus : le motif d'un refus
 * appartient au demandeur, et le lui cacher ne le fait pas disparaître — ça
 * l'oblige seulement à le demander.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { FileText, AlertCircle } from 'lucide-react';
import { formatMontant } from '@/components/guarantees/format';
import { statutClient, EN_COURS } from './dossierStatus';

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  }) : '—';

function CarteDossier({ dossier }) {
  const statut = statutClient(dossier.status);
  // Le montant accordé prime sur le montant demandé dès qu'il existe : c'est
  // celui qui engage le client, et il peut différer de ce qu'il avait demandé.
  const accorde = dossier.amountApproved != null;
  const montant = accorde ? dossier.amountApproved : dossier.amountRequested;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">
            {dossier.valueChain?.label || 'Filière non précisée'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Dossier {dossier.code} · déposé le {formatDate(dossier.submittedAt || dossier.createdAt)}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${statut.couleur}`}>
          {statut.label}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            {accorde ? 'Montant accordé' : 'Montant demandé'}
          </p>
          <p className="text-lg font-bold text-white">
            {montant != null ? formatMontant(montant, dossier.currency) : '—'}
          </p>
        </div>
        {/* N'afficher le demandé à côté de l'accordé que s'ils diffèrent :
            sinon c'est du bruit, et l'écart est justement ce qui mérite d'être vu. */}
        {accorde && dossier.amountRequested != null
          && dossier.amountRequested !== dossier.amountApproved && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Vous aviez demandé</p>
            <p className="text-sm text-slate-300">
              {formatMontant(dossier.amountRequested, dossier.currency)}
            </p>
          </div>
        )}
      </div>

      {/* Un refus sans motif est une décision qu'on ne peut pas comprendre.
          Le message du serveur est rédigé pour le client : on le relaie tel quel. */}
      {dossier.status === 'rejected' && (dossier.rejectionComment || dossier.rejectionReasonCode) && (
        <div className="mt-3 flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3">
          <AlertCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
          <div className="text-sm text-red-100 whitespace-pre-line">
            {dossier.rejectionComment || dossier.rejectionReasonCode}
          </div>
        </div>
      )}

      {statut.aide && dossier.status !== 'rejected' && (
        <p className="mt-3 text-xs text-slate-400">{statut.aide}</p>
      )}
    </div>
  );
}

export default function MesDossiers({ dossiers, chargement }) {
  if (chargement) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
        Chargement de vos demandes…
      </div>
    );
  }

  if (!dossiers?.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
        <FileText className="w-8 h-8 text-slate-500 mx-auto mb-2" />
        <p className="text-sm text-slate-300">Vous n'avez encore déposé aucune demande.</p>
        <p className="text-xs text-slate-500 mt-1">
          Utilisez l'onglet « Demander un crédit » pour commencer.
        </p>
      </div>
    );
  }

  const enCours = dossiers.filter((d) => EN_COURS.has(d.status));
  const historique = dossiers.filter((d) => !EN_COURS.has(d.status));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {enCours.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">
            Demandes en cours <span className="text-slate-500 font-normal">({enCours.length})</span>
          </h3>
          {enCours.map((d) => <CarteDossier key={d.code} dossier={d} />)}
        </section>
      )}

      {historique.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">
            Historique <span className="text-slate-500 font-normal">({historique.length})</span>
          </h3>
          {historique.map((d) => <CarteDossier key={d.code} dossier={d} />)}
        </section>
      )}
    </motion.div>
  );
}
