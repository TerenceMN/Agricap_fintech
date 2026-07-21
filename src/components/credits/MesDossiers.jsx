/**
 * « Mes demandes de crédit » — la trace complète des démarches du client,
 * présentée en TABLEAU.
 *
 * Avant cet écran, le parcours client ne chargeait que le dossier `active` : un
 * demandeur déposait une demande et ne la revoyait plus jamais. Ni le refus et
 * son motif, ni l'accord en attente de décaissement, ni la demande d'un
 * complément d'information n'avaient de surface.
 *
 * Rien n'est masqué ici, et surtout pas les refus : le motif d'un refus
 * appartient au demandeur. Dans un tableau, une colonne est trop étroite pour
 * le porter — il s'affiche donc en ligne dépliée sous le dossier concerné,
 * jamais tronqué.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FileText, AlertCircle, ChevronRight } from 'lucide-react';
import { formatMontant } from '@/components/guarantees/format';
import { statutClient, EN_COURS } from './dossierStatus';

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : '—';

function LigneDossier({ dossier, onOpen }) {
  const statut = statutClient(dossier.status);
  // Le montant accordé prime sur le montant demandé dès qu'il existe : c'est
  // celui qui engage le client, et il peut différer de ce qu'il avait demandé.
  const accorde = dossier.amountApproved != null;
  const montant = accorde ? dossier.amountApproved : dossier.amountRequested;
  const ecartMontant = accorde && dossier.amountRequested != null
    && dossier.amountRequested !== dossier.amountApproved;
  // Un refus n'est utile que rendu avec son motif. Le message serveur est
  // rédigé pour le client : on le relaie tel quel, sur sa propre ligne.
  const motifRefus = dossier.status === 'rejected'
    && (dossier.rejectionComment || dossier.rejectionReasonCode);

  const open = () => onOpen(dossier.code);

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-label={`Voir l'analyse du dossier ${dossier.code}`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        }}
        className="border-t border-white/5 hover:bg-white/[0.05] cursor-pointer transition-colors focus:outline-none focus:bg-white/[0.06]"
      >
        <td className="py-3 px-3">
          <p className="font-semibold text-white">
            {dossier.valueChain?.label || 'Filière non précisée'}
          </p>
        </td>
        <td className="py-3 px-3 text-slate-300 whitespace-nowrap">{dossier.code}</td>
        <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
          {formatDate(dossier.submittedAt || dossier.createdAt)}
        </td>
        <td className="py-3 px-3">
          {/* Le libellé d'aide (« Aucune action de votre part ») reste
              accessible en survol pour ne pas alourdir la ligne. */}
          <span
            title={dossier.status !== 'rejected' ? (statut.aide || '') : ''}
            className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${statut.couleur}`}
          >
            {statut.label}
          </span>
        </td>
        <td className="py-3 px-3 text-right whitespace-nowrap">
          <p className="font-bold text-white">
            {montant != null ? formatMontant(montant, dossier.currency) : '—'}
          </p>
          {ecartMontant && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              demandé&nbsp;: {formatMontant(dossier.amountRequested, dossier.currency)}
            </p>
          )}
        </td>
        <td className="py-3 px-2 text-right">
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300/90 whitespace-nowrap">
            Analyse <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </span>
        </td>
      </tr>
      {motifRefus && (
        <tr className="bg-red-500/[0.04]">
          <td colSpan={6} className="px-3 pb-3">
            <div className="flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3">
              <AlertCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
              <div className="text-sm text-red-100 whitespace-pre-line">
                {dossier.rejectionComment || dossier.rejectionReasonCode}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Tableau({ titre, dossiers, onOpen }) {
  if (!dossiers.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-white">
        {titre} <span className="text-slate-500 font-normal">({dossiers.length})</span>
      </h3>
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-2.5 px-3 font-medium">Filière</th>
              <th className="py-2.5 px-3 font-medium">Dossier</th>
              <th className="py-2.5 px-3 font-medium">Déposé le</th>
              <th className="py-2.5 px-3 font-medium">Statut</th>
              <th className="py-2.5 px-3 font-medium text-right">Montant</th>
              <th className="py-2.5 px-2 font-medium" aria-label="Ouvrir l'analyse" />
            </tr>
          </thead>
          <tbody>
            {dossiers.map((d) => <LigneDossier key={d.code} dossier={d} onOpen={onOpen} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function MesDossiers({ dossiers, chargement }) {
  const navigate = useNavigate();
  // Chaque dossier ouvre SA sous-page d'analyse client (score-lettre + pistes,
  // jamais les barèmes du moteur — principe 7). La route vit sous `/credits/…`
  // (le client) ; `/credit/*` au singulier est réservé au staff.
  const ouvrirAnalyse = (code) => navigate(`/credits/analyse/${code}`);

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
      <p className="text-xs text-slate-500">
        Cliquez sur une demande pour voir son analyse (votre note et des pistes d'amélioration).
      </p>
      <Tableau titre="Demandes en cours" dossiers={enCours} onOpen={ouvrirAnalyse} />
      <Tableau titre="Historique" dossiers={historique} onOpen={ouvrirAnalyse} />
    </motion.div>
  );
}
