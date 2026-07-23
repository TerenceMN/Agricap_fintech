/**
 * Couche service du BACK-OFFICE des ordres de paiement (fournisseur Makuta).
 *
 * `api.ts` (propriété de l'agent D) porte la face CLIENT du portefeuille : mon
 * dépôt, mes ordres en lecture seule. Ce module-ci porte la face CAISSE — les
 * routes STAFF de `caisses/payments`, par lesquelles un agent supervise, relit
 * et tranche des ordres qui engagent de l'argent réel. Les deux ne se mélangent
 * pas : un client ne réconcilie pas, un agent ne « dépose » pas ici.
 *
 * ── Ce que ce module N'EXPOSE PAS, volontairement ────────────────────────────
 * `POST /caisses/payments/callback` n'est PAS enveloppé ici. C'est le point
 * d'entrée du RAPPEL fournisseur (réseau ouvert, non authentifié par session,
 * vérifié par signature RSA côté serveur) : aucun agent ne l'appelle depuis un
 * écran. L'y exposer laisserait croire qu'un humain « confirme » un ordre à la
 * main — or seule une signature Makuta valide le peut. Trou déclaré, pas oublié.
 *
 * ── Pourquoi un `request` local plutôt que celui d'`api.ts` ──────────────────
 * `api.ts` ne l'exporte pas (fonction de module privée) et je n'ai pas le droit
 * de l'éditer. Je réutilise donc `tokens`/`refresh` d'`oidc` et la MÊME classe
 * `ApiError` qu'`api.ts` : les erreurs de ce module se déplient exactement comme
 * les autres (`toFieldErrors` les reconnaît), et le contrat d'erreur reste unique.
 */
import { ApiError } from '@/services/api';
import { tokens, refresh } from '@/services/oidc';
import type { PaymentOrderRow } from '@/types/api';

interface RequestOpts {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && (await refresh())) {
    return request<T>(path, { ...opts, retry: false });
  }
  if (!res.ok) {
    let detail = '';
    let code: string | null = null;
    let errors: Array<{ code: string; message: string }> = [];
    try {
      const parsed = (await res.json()) as {
        detail?: string;
        code?: string;
        message?: string;
        errors?: Array<string | { code?: string; message?: string }>;
      };
      // `message` en repli : les refus de contrat de paiement (422
      // `counterparty_required`…) nomment leur texte `message`, pas `detail`.
      detail = parsed.detail || parsed.message || detail;
      code = parsed.code ?? null;
      if (Array.isArray(parsed.errors)) {
        errors = parsed.errors.map((e) =>
          typeof e === 'string'
            ? { code: 'ERREUR', message: e }
            : { code: e.code || 'ERREUR', message: e.message || '' });
        if (!detail && errors.length) detail = errors[0].message;
      }
    } catch { /* corps non-JSON : repli ci-dessous */ }
    if (!detail) detail = `Erreur ${res.status}`;
    console.warn(`[PAYMENTS] ${method} ${path} -> ${res.status}${code ? ` [${code}]` : ''} ${detail}`);
    throw new ApiError(res.status, detail, code, errors);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (res as unknown)) as T;
}

/** Sens d'un ordre, tel que servi par le serveur (`PaymentOrder.Direction`). */
export type PaymentDirection = 'COLLECTION' | 'PAYOUT';

/** Issue imposable à la main lors d'un règlement forcé — jamais autre chose. */
export type ForcedOutcome = 'CONFIRMED' | 'REFUSED';

/**
 * Un événement du journal append-only d'un ordre (`PaymentOrderEvent`). Servi
 * uniquement au STAFF (asymétrie d'information, principe 7). `kind`/`source`
 * sont des codes stables ; le front les mappe pour l'affichage, jamais l'inverse.
 */
export interface PaymentEventRow {
  id: number;
  kind: string;
  source: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string | null;
  motive: string | null;
  payload: Record<string, unknown>;
  at: string | null;
}

/** Détail d'un ordre côté staff : la ligne + son journal d'événements. */
export interface PaymentOrderDetail extends PaymentOrderRow {
  events?: PaymentEventRow[];
}

/**
 * La file de réconciliation, telle que le serveur la SERT — `consigne` incluse.
 * On affiche ce bandeau tel quel : c'est le rappel du principe 2 (« les relire,
 * jamais les rejouer »), et il n'appartient pas au front de le reformuler.
 */
export interface IndeterminateQueue {
  count: number;
  orders: PaymentOrderRow[];
  consigne: string;
}

/** Filtres de la liste staff — vides = tout, dans la limite du plafond serveur. */
export interface PaymentListFilters {
  status?: string;
  direction?: PaymentDirection | '';
}

function query(filters?: PaymentListFilters): string {
  const q = new URLSearchParams();
  if (filters?.status) q.set('status', filters.status);
  if (filters?.direction) q.set('direction', filters.direction);
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Routes STAFF des ordres de paiement. Chemins et corps repris À L'IDENTIQUE de
 * `backend/caisses/urls.py` / `views.py` — rien n'est deviné.
 */
export const paymentsApi = {
  /** Liste supervisée (staff : `validate`/`audit`/`config`). 403 sinon. */
  list: (filters?: PaymentListFilters) =>
    request<PaymentOrderRow[]>(`/caisses/payments${query(filters)}`),

  /** File de réconciliation : tout ordre dont l'issue reste inconnue. */
  indeterminate: () =>
    request<IndeterminateQueue>('/caisses/payments/indeterminate'),

  /** Détail d'un ordre + son journal d'événements (staff uniquement). */
  detail: (reference: string) =>
    request<PaymentOrderDetail>(`/caisses/payments/${encodeURIComponent(reference)}`),

  /**
   * Transmet un ordre ENCORE `PENDING` au fournisseur (première expédition).
   * Ce n'est PAS un « rejeu » : le serveur refuse (409) tout ordre déjà envoyé —
   * un ordre indéterminé ne repasse jamais par ici.
   */
  send: (reference: string) =>
    request<PaymentOrderRow>(`/caisses/payments/${encodeURIComponent(reference)}/send`, {
      method: 'POST', body: {},
    }),

  /** Annule un ordre `PENDING` (motif obligatoire). Impossible dès qu'il est parti. */
  cancel: (reference: string, motive: string) =>
    request<PaymentOrderRow>(`/caisses/payments/${encodeURIComponent(reference)}/cancel`, {
      method: 'POST', body: { motive },
    }),

  /**
   * RELIT le statut de l'ordre chez le fournisseur, puis applique l'issue lue.
   * Interroge, n'ordonne pas : c'est toute la différence avec un rejeu. Motif
   * obligatoire (qui demande, pourquoi maintenant). Capacité serveur : `validate`.
   */
  reconcile: (reference: string, motive: string) =>
    request<PaymentOrderRow>(`/caisses/payments/${encodeURIComponent(reference)}/reconcile`, {
      method: 'POST', body: { motive },
    }),

  /**
   * Clôture MANUELLE sur preuve externe (relevé opérateur…), quand la relecture
   * de statut n'est pas disponible. Dernier recours, le plus encadré : issue
   * `CONFIRMED`/`REFUSED` + motif circonstancié. Capacité serveur : `validate`.
   */
  forceSettle: (reference: string, outcome: ForcedOutcome, motive: string) =>
    request<PaymentOrderRow>(`/caisses/payments/${encodeURIComponent(reference)}/force-settle`, {
      method: 'POST', body: { outcome, motive },
    }),
};

export type { PaymentOrderRow };
