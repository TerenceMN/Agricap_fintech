import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import {
  RefreshCw, AlertTriangle, Search, ListChecks, ArrowDownCircle, ArrowUpCircle,
  Clock, ScrollText, Loader2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';
import { paymentsApi } from '@/services/paymentsApi';
import OrderActions from '@/components/payments/OrderActions';
import {
  paymentStatusMeta, directionLabel,
} from '@/components/treasury/depositOutcome';
import {
  Loading, Empty, ErrorPanel, Forbidden, toFieldErrors,
} from '@/components/backoffice/States';

/**
 * BACK-OFFICE DES ORDRES DE PAIEMENT (fournisseur Makuta) — la face CAISSE du
 * circuit. Le client n'a qu'une vue lecture seule de SES ordres ; ici, un agent
 * supervise TOUS les ordres, relit ceux dont l'issue est inconnue, et tranche.
 *
 * Trois convictions se lisent à l'écran :
 *   1. La file de réconciliation (`payments/indeterminate`) est l'outil du
 *      principe 2 : un humain regarde, décide ; RIEN ne se résout seul. Le
 *      bandeau serveur (« les relire, jamais les rejouer ») est affiché tel quel,
 *      et aucun bouton n'y « relance » un ordre.
 *   2. Toute action est une permission vérifiée serveur (§7.2). Les capacités de
 *      l'agent (`GET /rbac/me`) gouvernent l'AFFICHAGE des boutons ; le serveur
 *      re-vérifie à l'appel.
 *   3. Aucun chiffre inventé : les montants sont les CHAÎNES servies par le
 *      serveur (jamais reparsées en float), les libellés de statut sont ses phrases.
 *
 * Volontairement SANS garde `roles` côté route : l'autorisation est décidée par
 * le serveur (403 sur la liste staff), et l'écran restitue ce refus tel quel.
 */

const fmtAmount = (o) => `${o.amount} ${o.currency}`;
const fmtDate = (s) =>
  s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const STATUS_FILTER_OPTIONS = [
  ['', 'Tous les statuts'],
  ['PENDING', 'En préparation'],
  ['SENT', 'Transmis'],
  ['AWAITING_CONFIRMATION', 'Attente de confirmation'],
  ['INDETERMINATE', 'Issue à vérifier'],
  ['CONFIRMED', 'Confirmé'],
  ['REFUSED', 'Refusé'],
  ['CANCELLED', 'Annulé'],
];

const DIRECTION_FILTER_OPTIONS = [
  ['', 'Tous les sens'],
  ['COLLECTION', 'Encaissement (dépôt)'],
  ['PAYOUT', 'Décaissement (retrait)'],
];

// Libellés d'affichage des codes stables du journal (`PaymentOrderEvent`). Le
// front MAPPE pour lire ; il retombe sur le code brut s'il ne le connaît pas —
// jamais un libellé deviné, jamais un événement masqué.
const EVENT_KIND_LABEL = {
  CREATED: 'Ordre créé',
  SENT: 'Requête envoyée',
  RESPONSE: 'Réponse enregistrée',
  TRANSPORT_ERROR: 'Erreur de transport — issue inconnue',
  CONFIRMED: 'Issue confirmée',
  REFUSED: 'Issue refusée',
  UNCLASSIFIED: 'Réponse non classable',
  WALLET_POSTED: 'Mouvement de portefeuille posté',
  WALLET_REVERSED: 'Mouvement contre-passé',
  CANCELLED: 'Ordre annulé',
  CALLBACK_REJECTED: 'Rappel entrant refusé',
};
const EVENT_SOURCE_LABEL = {
  SYSTEM: 'Système',
  PROVIDER_RESPONSE: 'Réponse fournisseur',
  RECONCILIATION: 'Réconciliation',
  CALLBACK: 'Rappel entrant',
};

const StatusBadge = ({ status }) => {
  const meta = paymentStatusMeta(status);
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${meta.badgeClass}`}>
      {meta.label}
    </span>
  );
};

const DirectionIcon = ({ direction }) =>
  direction === 'PAYOUT'
    ? <ArrowUpCircle className="w-4 h-4 text-orange-400" />
    : <ArrowDownCircle className="w-4 h-4 text-emerald-400" />;

/** Dialogue de saisie du motif (et de l'issue pour un règlement forcé). */
const ActionDialog = ({ open, spec, order, submitting, onClose, onConfirm }) => {
  const [motive, setMotive] = useState('');
  const [outcome, setOutcome] = useState('CONFIRMED');

  useEffect(() => {
    if (open) { setMotive(''); setOutcome('CONFIRMED'); }
  }, [open, spec]);

  if (!spec || !order) return null;
  const motiveTooShort = spec.requiresOutcome && motive.trim().length < 10;
  const motiveMissing = spec.requiresMotive && !motive.trim();
  const blocked = submitting || motiveMissing || motiveTooShort;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle>{spec.label} — {order.reference}</DialogTitle>
          <DialogDescription className="text-slate-400">{spec.hint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {spec.requiresOutcome && (
            <div className="space-y-2">
              <Label>Issue imposée (sur preuve externe)</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="bg-slate-800 border-slate-600" aria-label="Issue">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONFIRMED">Confirmé (l’argent a bougé)</SelectItem>
                  <SelectItem value="REFUSED">Refusé (aucun mouvement)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {spec.requiresMotive && (
            <div className="space-y-2">
              <Label>
                Motif {spec.requiresOutcome ? 'circonstancié (référence du relevé / de la confirmation)' : 'obligatoire'}
              </Label>
              <Textarea
                value={motive}
                onChange={(e) => setMotive(e.target.value)}
                rows={3}
                className="bg-slate-800 border-slate-700"
                placeholder={spec.requiresOutcome
                  ? 'Ex. : relevé opérateur n°… du …, transaction confirmée.'
                  : 'Qui demande, pourquoi maintenant.'}
              />
              {motiveTooShort && (
                <p className="text-xs text-amber-300">
                  Un motif circonstancié est requis (au moins 10 caractères).
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Annuler</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={blocked}
            onClick={() => onConfirm({ motive: motive.trim(), outcome })}
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Journal d'événements append-only d'un ordre. */
const EventTimeline = ({ events }) => {
  if (!events || events.length === 0) {
    return <p className="text-xs text-slate-500">Aucun événement journalisé.</p>;
  }
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 border-white/10 pl-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">
              {EVENT_KIND_LABEL[e.kind] || e.kind}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
              {EVENT_SOURCE_LABEL[e.source] || e.source}
            </span>
            {(e.fromStatus || e.toStatus) && (
              <span className="text-[11px] text-slate-500">
                {e.fromStatus || '—'} → {e.toStatus || '—'}
              </span>
            )}
          </div>
          {e.motive && <p className="text-xs text-slate-300 mt-1">{e.motive}</p>}
          <p className="text-[11px] text-slate-500 mt-1">
            {fmtDate(e.at)}{e.actor ? ` · ${e.actor}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
};

/** Panneau de détail d'un ordre : champs, statut serveur, journal, actions. */
const OrderDetailDialog = ({ open, detail, loading, caps, submitting, onClose, onAct }) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
      {loading || !detail ? (
        <div className="py-10"><Loading label="Chargement de l’ordre…" /></div>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DirectionIcon direction={detail.direction} />
              <span className="font-mono text-base">{detail.reference}</span>
              <StatusBadge status={detail.status} />
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {/* La phrase de statut vient du serveur : affichée telle quelle. */}
              {detail.detail}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm py-2">
            <Field label="Sens" value={directionLabel(detail.direction)} />
            <Field label="Montant" value={fmtAmount(detail)} mono />
            <Field label="Opération" value={detail.operation} mono />
            <Field label="Contrepartie" value={detail.counterparty || '—'} mono />
            <Field label="Réf. fournisseur" value={detail.providerReference || '—'} mono />
            <Field label="Compte de trésorerie" value={detail.treasuryAccountCode || '—'} mono />
            <Field label="Créé le" value={fmtDate(detail.createdAt)} />
            <Field label="Envoyé le" value={fmtDate(detail.sentAt)} />
            <Field label="Réglé le" value={fmtDate(detail.settledAt)} />
            <Field label="Créé par" value={detail.createdBy || '—'} mono />
          </div>

          {detail.failureDetail && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-xs">
              {detail.failureDetail}
            </div>
          )}

          {detail.awaitingReconciliation && (
            <div className="bg-orange-500/10 border border-orange-500/30 text-orange-200 rounded-lg p-3 text-xs flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Issue non close : cet ordre a peut-être abouti chez le fournisseur. Le relire
                (réconciliation) ; ne jamais le rejouer.
              </span>
            </div>
          )}

          <div className="pt-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
              <ScrollText className="w-3 h-3" /> Journal
            </p>
            <EventTimeline events={detail.events} />
          </div>

          <DialogFooter className="pt-3">
            <OrderActions
              status={detail.status}
              caps={caps}
              busy={submitting}
              onAct={(spec) => onAct(detail, spec)}
            />
          </DialogFooter>
        </>
      )}
    </DialogContent>
  </Dialog>
);

const Field = ({ label, value, mono }) => (
  <div>
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className={`text-slate-200 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</p>
  </div>
);

/** Une ligne d'ordre dans une liste — cliquable pour ouvrir le détail. */
const OrderRow = ({ order, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(order.reference)}
    className="w-full text-left glass-effect rounded-xl border border-white/10 p-4 hover:border-white/25 transition-colors"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <DirectionIcon direction={order.direction} />
        <div>
          <p className="font-mono text-sm text-white">{order.reference}</p>
          <p className="text-xs text-slate-400">
            {directionLabel(order.direction)} · <span className="font-mono">{fmtAmount(order)}</span>
          </p>
        </div>
      </div>
      <div className="text-right space-y-1">
        <StatusBadge status={order.status} />
        <p className="text-[11px] text-slate-500 flex items-center gap-1 justify-end">
          <Clock className="w-3 h-3" /> {fmtDate(order.createdAt)}
        </p>
      </div>
    </div>
  </button>
);

const PaymentsBackOffice = () => {
  const { toast } = useToast();
  const [caps, setCaps] = useState({ validate: false, staff: false });
  const [forbidden, setForbidden] = useState(false);

  const [queue, setQueue] = useState(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState([]);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState([]);
  const [filters, setFilters] = useState({ status: '', direction: '' });

  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [action, setAction] = useState(null); // { order, spec }
  const [submitting, setSubmitting] = useState(false);

  const handleForbidden = useCallback((e) => {
    if (e instanceof ApiError && e.status === 403) { setForbidden(true); return true; }
    return false;
  }, []);

  const loadCaps = useCallback(() => {
    api.rbac.me()
      .then((me) => {
        const c = me.capabilities || {};
        setCaps({ validate: !!c.validate, staff: !!(c.validate || c.audit || c.config) });
      })
      .catch(() => setCaps({ validate: false, staff: false }));
  }, []);

  const loadQueue = useCallback(() => {
    setQueueLoading(true);
    setQueueError([]);
    paymentsApi.indeterminate()
      .then(setQueue)
      .catch((e) => { if (!handleForbidden(e)) setQueueError(toFieldErrors(e)); })
      .finally(() => setQueueLoading(false));
  }, [handleForbidden]);

  const loadOrders = useCallback(() => {
    setOrdersLoading(true);
    setOrdersError([]);
    paymentsApi.list({ status: filters.status, direction: filters.direction })
      .then(setOrders)
      .catch((e) => { if (!handleForbidden(e)) setOrdersError(toFieldErrors(e)); })
      .finally(() => setOrdersLoading(false));
  }, [filters, handleForbidden]);

  useEffect(() => { loadCaps(); }, [loadCaps]);
  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const openDetail = useCallback((reference) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    paymentsApi.detail(reference)
      .then(setDetail)
      .catch((e) => {
        toast({ variant: 'destructive', title: 'Ordre introuvable', description: toFieldErrors(e).map((c) => c.message).join(' · ') });
        setDetailOpen(false);
      })
      .finally(() => setDetailLoading(false));
  }, [toast]);

  const refreshAll = useCallback((reference) => {
    loadQueue();
    loadOrders();
    if (reference) openDetail(reference);
  }, [loadQueue, loadOrders, openDetail]);

  const runAction = useCallback(async ({ motive, outcome }) => {
    if (!action) return;
    const { order, spec } = action;
    setSubmitting(true);
    try {
      if (spec.id === 'send') await paymentsApi.send(order.reference);
      else if (spec.id === 'cancel') await paymentsApi.cancel(order.reference, motive);
      else if (spec.id === 'reconcile') await paymentsApi.reconcile(order.reference, motive);
      else if (spec.id === 'forceSettle') await paymentsApi.forceSettle(order.reference, outcome, motive);
      toast({ title: `${spec.label} — ${order.reference}`, description: 'Action enregistrée.', className: 'bg-emerald-500 text-white' });
      setAction(null);
      refreshAll(detailOpen ? order.reference : null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: toFieldErrors(e).map((c) => c.message).join(' · ') });
    } finally {
      setSubmitting(false);
    }
  }, [action, toast, refreshAll, detailOpen]);

  if (forbidden) {
    return (
      <>
        <Helmet><title>Ordres de paiement — AGRICAP</title></Helmet>
        <Forbidden
          message="Supervision des paiements réservée au staff."
          detail="Cet écran exige la capacité validate, audit ou config (GET /caisses/payments répond 403 sinon)."
        />
      </>
    );
  }

  const queueCount = queue?.count ?? 0;

  return (
    <>
      <Helmet><title>Ordres de paiement — AGRICAP</title></Helmet>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <ListChecks className="w-6 h-6 text-emerald-400" />
              Ordres de paiement (Makuta)
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              Face caisse du circuit : superviser, réconcilier, trancher. Le client n’a qu’une
              vue lecture seule de ses propres ordres.
            </p>
          </div>
          <Button variant="outline" onClick={() => refreshAll()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Actualiser
          </Button>
        </div>

        <Tabs defaultValue="reconciliation">
          <TabsList className="bg-slate-800/50">
            <TabsTrigger value="reconciliation" className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              File de réconciliation
              {queueCount > 0 && (
                <span className="bg-orange-500 text-white text-[10px] h-4 min-w-4 px-1 rounded-full inline-flex items-center justify-center ml-1">
                  {queueCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-2">
              <Search className="w-4 h-4 text-blue-400" /> Tous les ordres
            </TabsTrigger>
          </TabsList>

          {/* ───────────────── File de réconciliation (principe 2) ─────────── */}
          <TabsContent value="reconciliation" className="mt-4 space-y-4">
            {/* Bandeau SERVEUR, affiché tel quel — la consigne n'est pas reformulée. */}
            <div className="bg-orange-500/10 border border-orange-500/30 text-orange-100 rounded-xl p-4 text-sm flex gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-orange-400" />
              <div className="space-y-1">
                <p className="font-semibold">Ces ordres ont peut-être abouti chez le fournisseur.</p>
                <p className="opacity-90">
                  {queue?.consigne
                    || 'Les relire (réconciliation), jamais les rejouer. Un rejeu à l’aveugle paie deux fois.'}
                </p>
              </div>
            </div>

            <ErrorPanel errors={queueError} title="Chargement de la file impossible" />

            {queueLoading ? (
              <Loading label="Chargement de la file…" />
            ) : queueCount === 0 ? (
              <Empty title="Aucun ordre en attente d’issue." hint="Rien à réconcilier pour le moment." />
            ) : (
              <div className="space-y-3">
                {queue.orders.map((order) => (
                  <div key={order.reference} className="glass-effect rounded-xl border border-white/10 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <DirectionIcon direction={order.direction} />
                        <div>
                          <button
                            type="button"
                            onClick={() => openDetail(order.reference)}
                            className="font-mono text-sm text-white hover:underline"
                          >
                            {order.reference}
                          </button>
                          <p className="text-xs text-slate-400">
                            {directionLabel(order.direction)} · <span className="font-mono">{fmtAmount(order)}</span>
                          </p>
                          {/* Phrase de statut du serveur, telle quelle. */}
                          <p className="text-[11px] text-slate-500 mt-1">{order.detail}</p>
                        </div>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                    {/* Actions : réconcilier / règlement forcé. JAMAIS « relancer ». */}
                    <OrderActions
                      status={order.status}
                      caps={caps}
                      busy={submitting}
                      onAct={(spec) => setAction({ order, spec })}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ───────────────── Suivi de tous les ordres ────────────────────── */}
          <TabsContent value="orders" className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Statut</Label>
                <Select value={filters.status || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'all' ? '' : v }))}>
                  <SelectTrigger className="bg-slate-900/50 w-56" aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTER_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v || 'all'} value={v || 'all'}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Sens</Label>
                <Select value={filters.direction || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, direction: v === 'all' ? '' : v }))}>
                  <SelectTrigger className="bg-slate-900/50 w-56" aria-label="Filtrer par sens"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIRECTION_FILTER_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v || 'all'} value={v || 'all'}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(filters.status || filters.direction) && (
                <div className="flex items-end">
                  <Button variant="ghost" size="sm" onClick={() => setFilters({ status: '', direction: '' })}>
                    <X className="w-3 h-3 mr-1" /> Réinitialiser
                  </Button>
                </div>
              )}
            </div>

            <ErrorPanel errors={ordersError} title="Chargement des ordres impossible" />

            {ordersLoading ? (
              <Loading label="Chargement des ordres…" />
            ) : orders.length === 0 ? (
              <Empty title="Aucun ordre pour ces filtres." hint="Élargissez les filtres pour voir davantage d’ordres." />
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <OrderRow key={order.reference} order={order} onOpen={openDetail} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <OrderDetailDialog
        open={detailOpen}
        detail={detail}
        loading={detailLoading}
        caps={caps}
        submitting={submitting}
        onClose={() => setDetailOpen(false)}
        onAct={(order, spec) => setAction({ order, spec })}
      />

      <ActionDialog
        open={!!action}
        spec={action?.spec}
        order={action?.order}
        submitting={submitting}
        onClose={() => setAction(null)}
        onConfirm={runAction}
      />
    </>
  );
};

export default PaymentsBackOffice;
