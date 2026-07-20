import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { HeartHandshake, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { ErrorPanel, toFieldErrors } from '@/components/backoffice/States';
import GuaranteeRequestCard from '@/components/guarantees/GuaranteeRequestCard';
import ConsentDecisionDialog from '@/components/guarantees/ConsentDecisionDialog';
import {
  isActionable, normalizeRequest, normalizeRequestList,
} from '@/components/guarantees/guaranteeRequestShape';
import { guarantorErrorList } from '@/components/guarantees/guarantorErrors';

/**
 * « Mes demandes de caution » — l'écran du garant (SPEC §2.5, lot 6).
 *
 * Un membre d'un groupe a été désigné comme garant solidaire du crédit d'un
 * autre membre. Cet écran lui montre ce qu'on lui demande, ce que ça l'engage à
 * payer, combien de temps il lui reste, et lui permet d'accepter ou de refuser.
 *
 * Contrat d'API : `docs/status-fragments/lot6-backend.md` §1.
 * Toutes les clés du serveur sont lues dans `guaranteeRequestShape.js` — cet
 * écran ne manipule que la forme canonique.
 *
 * ── Trois partis pris qui structurent la page ──────────────────────────────
 *
 * 1. **Le cas vide est le cas normal.** Un membre reçoit quelques demandes par
 *    an, pas par semaine. L'écran vide n'est donc pas un état d'échec à expédier
 *    en une ligne grise : c'est ce que la plupart des visiteurs verront, et il
 *    doit expliquer à quoi sert cette page et ce qui la remplira.
 *
 * 2. **En attente et clôturées sont deux sections, pas une liste triée.** Une
 *    demande expirée n'est pas une demande en attente : elle ne demande rien,
 *    elle ne peut plus rien recevoir. Les mêler ferait chercher parmi des
 *    lignes mortes la seule qui appelle une décision — et laisserait croire
 *    qu'une caduque est encore rattrapable.
 *
 * 3. **Aucun chiffre n'est calculé.** Montants, devises, statuts, expiration :
 *    tout vient de l'API. La seule chose que le front dérive du temps est
 *    l'affichage du décompte, qui ne décide de rien — le serveur reste seul
 *    juge de la validité d'une réponse (§1.2, il re-vérifie les cinq règles au
 *    moment du clic).
 */

/** Squelettes de chargement — même densité que les cartes réelles. */
const LoadingCards = () => (
  <div className="space-y-4">
    {[0, 1].map((i) => (
      <div key={i} className="glass-effect space-y-4 rounded-2xl border border-white/10 p-6">
        <Skeleton className="h-6 w-1/3 bg-white/10" />
        <Skeleton className="h-4 w-1/2 bg-white/10" />
        <Skeleton className="h-24 w-full bg-white/10" />
        <Skeleton className="h-12 w-full bg-white/10" />
      </div>
    ))}
  </div>
);

/**
 * Écran vide — soigné parce que c'est l'état le plus fréquent.
 * Il répond à trois questions : où suis-je, pourquoi c'est vide, qu'est-ce qui
 * remplira cette page.
 */
const NoRequests = ({ windowHours }) => (
  <div className="glass-effect rounded-2xl border border-white/10 p-10 text-center">
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
      <ShieldCheck className="h-7 w-7 text-emerald-400" aria-hidden="true" />
    </div>
    <h2 className="mt-4 text-lg font-semibold text-white">
      Aucune demande de caution en attente
    </h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
      Personne ne vous a désigné comme garant pour le moment. Vous n'avez rien à
      faire ici — et rien ne vous engage.
    </p>
    <div className="mx-auto mt-6 max-w-lg rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span>
          Une demande apparaîtra ici lorsqu'un membre de l'un de vos groupes ou de
          votre coopérative vous désignera comme garant solidaire de son crédit.
          Vous serez notifié, et vous aurez{' '}
          {windowHours
            ? <strong className="text-slate-300">{windowHours} heures</strong>
            : 'un délai limité'}{' '}
          pour accepter ou refuser. Sans réponse de votre part dans ce délai, la
          demande devient caduque — et vous n'êtes engagé à rien.
        </span>
      </p>
    </div>
  </div>
);

const GuaranteeRequests = () => {
  const { toast } = useToast();

  const [requests, setRequests] = useState([]);
  const [totalRows, setTotalRows] = useState(null);
  const [windowHours, setWindowHours] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState([]);

  // Décision en cours de confirmation.
  const [decision, setDecision] = useState(null);      // 'accept' | 'decline' | null
  const [target, setTarget] = useState(null);          // la demande concernée
  const [submitting, setSubmitting] = useState(false);
  const [decisionErrors, setDecisionErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    try {
      // Pas de `?status=pending_consent` : on demande **tout**. Le contrat sert
      // les expirées et les clôturées, et l'écran doit pouvoir montrer « votre
      // délai est passé » plutôt que de faire disparaître silencieusement une
      // demande à laquelle le garant n'a pas répondu. Une ligne qui s'évapore
      // est indiscernable d'une ligne qui n'a jamais existé.
      const res = await api.credits.guaranteeRequests();
      const { items, totalRows: total, consentWindowHours } = normalizeRequestList(res);
      setRequests(items);
      setTotalRows(total);
      setWindowHours(consentWindowHours);
    } catch (err) {
      setRequests([]);
      setLoadErrors(toFieldErrors(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { pending, closed } = useMemo(() => {
    const p = [];
    const c = [];
    requests.forEach((r) => (isActionable(r) ? p : c).push(r));
    return { pending: p, closed: c };
  }, [requests]);

  const openDecision = (kind) => (request) => {
    setTarget(request);
    setDecision(kind);
    setDecisionErrors([]);
  };

  const closeDecision = () => {
    if (submitting) return;
    setDecision(null);
    setTarget(null);
    setDecisionErrors([]);
  };

  const confirmDecision = async () => {
    if (!target || !decision) return;
    setSubmitting(true);
    setDecisionErrors([]);
    const accept = decision === 'accept';
    try {
      const res = await api.credits.consentGuaranteeRequest(target.id, accept);

      // Le serveur renvoie l'item mis à jour (§1.2) : on le substitue en place
      // plutôt que de recharger. La ligne reste visible, avec son nouveau statut
      // — le garant voit le résultat de son acte au lieu de le voir disparaître.
      const updated = res?.item ? normalizeRequest(res.item) : null;
      if (updated && updated.id != null) {
        setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      } else {
        // Contrat non tenu sur la forme de la réponse : on ne devine pas le
        // nouvel état, on recharge depuis la source.
        console.warn('[caution] réponse de consentement sans `item` — rechargement.', res);
        await load();
      }

      setDecision(null);
      setTarget(null);
      toast(
        accept
          ? {
            title: 'Engagement enregistré',
            description:
              "Votre consentement est horodaté et conservé comme preuve. Vous êtes désormais "
              + 'garant solidaire de ce crédit.',
          }
          : {
            title: 'Refus enregistré',
            description:
              'Le demandeur sera informé qu’il doit trouver un autre garant. '
              + "Vous n'êtes engagé à rien.",
          },
      );
    } catch (err) {
      // Le refus s'affiche dans le dialogue qui l'a provoqué, pas en toast :
      // ces messages expliquent une situation en plusieurs phrases et doivent
      // rester lisibles (cf. `ConsentDecisionDialog`).
      setDecisionErrors(guarantorErrorList(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <Helmet>
        <title>Mes demandes de caution — AGRICAP</title>
      </Helmet>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6"
      >
        {/* ── En-tête ─────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
              <HeartHandshake className="h-6 w-6 text-emerald-400" aria-hidden="true" />
              Mes demandes de caution
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Se porter caution solidaire, c'est accepter de payer à la place de
              quelqu'un d'autre s'il ne rembourse pas. Lisez chaque demande
              entièrement avant de répondre.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={load}
            disabled={loading}
            className="border-white/20 bg-transparent hover:bg-white/10"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Actualiser
          </Button>
        </header>

        {/* ── Erreur de chargement ────────────────────────────────────── */}
        {!loading && loadErrors.length > 0 && (
          <div className="space-y-3">
            <ErrorPanel
              errors={loadErrors}
              title="Vos demandes de caution n'ont pas pu être chargées"
            />
            <p className="text-xs text-slate-500">
              Tant que cette liste ne se charge pas, aucune demande en attente
              n'est visible — mais le délai de réponse, lui, continue de courir.
              Réessayez, ou contactez votre agence si le problème persiste.
            </p>
            <Button
              variant="outline"
              onClick={load}
              className="border-white/20 bg-transparent hover:bg-white/10"
            >
              Réessayer
            </Button>
          </div>
        )}

        {/* ── Chargement ──────────────────────────────────────────────── */}
        {loading && <LoadingCards />}

        {/* ── Contenu ─────────────────────────────────────────────────── */}
        {!loading && loadErrors.length === 0 && (
          <>
            {requests.length === 0 ? (
              <NoRequests windowHours={windowHours} />
            ) : (
              <div className="space-y-8">
                {/* En attente — ce qui appelle une décision. */}
                <section className="space-y-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
                    {pending.length > 0
                      ? `${pending.length} demande${pending.length > 1 ? 's' : ''} en attente de votre réponse`
                      : 'Aucune demande en attente'}
                  </h2>

                  {pending.length === 0 ? (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
                      Vous avez répondu à toutes vos demandes, ou leur délai est
                      passé. Rien ne vous est demandé pour le moment.
                    </p>
                  ) : (
                    pending.map((r) => (
                      <GuaranteeRequestCard
                        key={r.id}
                        request={r}
                        onAccept={openDecision('accept')}
                        onDecline={openDecision('decline')}
                        busy={submitting}
                      />
                    ))
                  )}
                </section>

                {/* Clôturées et caduques — visibles, mais séparées et inertes. */}
                {closed.length > 0 && (
                  <section className="space-y-4">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                      Historique — {closed.length} demande{closed.length > 1 ? 's' : ''} close
                      {closed.length > 1 ? 's' : ''} ou caduque{closed.length > 1 ? 's' : ''}
                    </h2>
                    {closed.map((r) => (
                      <GuaranteeRequestCard
                        key={r.id}
                        request={r}
                        onAccept={openDecision('accept')}
                        onDecline={openDecision('decline')}
                        busy={submitting}
                      />
                    ))}
                  </section>
                )}

                {/* Honnêteté d'interface : ce que le serveur dit avoir, vs ce qui
                    est affiché. Un écart signale une troncature ou un filtre. */}
                {totalRows !== null && totalRows !== requests.length && (
                  <p className="text-xs text-amber-300/90">
                    {requests.length} demande(s) affichée(s) sur {totalRows} annoncée(s)
                    par le serveur. Actualisez la page ; si l'écart persiste,
                    signalez-le à votre agence.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Rappel de fond, toujours visible ────────────────────────── */}
        <footer className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Une caution acceptée est un engagement juridique enregistré et
              horodaté. AGRICAP peut vous réclamer directement le montant que vous
              avez garanti si le crédit n'est pas remboursé, et mobiliser votre
              épargne à ce titre. Vous ne pouvez pas retirer un consentement depuis
              cet écran : adressez-vous à votre agence.
            </span>
          </p>
        </footer>
      </motion.div>

      <ConsentDecisionDialog
        open={decision !== null}
        decision={decision}
        request={target}
        submitting={submitting}
        errors={decisionErrors}
        onCancel={closeDecision}
        onConfirm={confirmDecision}
      />
    </Layout>
  );
};

export default GuaranteeRequests;
