/**
 * Briques d'état partagées par les écrans du backoffice crédit.
 *
 * Chaque écran de données doit exposer trois états explicites : chargement,
 * erreur, vide (CLAUDE.md §5 « Frontend »). Les centraliser ici évite qu'un
 * écran oublie le cas vide ou affiche un spinner éternel sur une 403.
 *
 * `api.ts::ApiError` porte désormais `code` (code métier du backend) et
 * `errors[]` (422 multi-erreurs du pipeline de validation), en plus de `status`
 * et `message`. `toFieldErrors` les restitue tels quels : une ligne par erreur
 * serveur, avec son propre code — le principe 5 (« réponse 422 structurée
 * {code, message} par erreur, jamais un message générique ») est donc tenu de
 * bout en bout.
 *
 * Règle : ne JAMAIS présenter le statut HTTP comme un code métier. « 422 » dit à
 * l'utilisateur que sa requête a été refusée, pas pourquoi. Quand le backend
 * n'envoie pas de `code`, on n'en invente pas — on affiche le seul message.
 */
import React from 'react';
import { ApiError } from '@/services/api';

export const Loading: React.FC<{ label?: string }> = ({ label = 'Chargement…' }) => (
  <div className="p-8 text-center text-slate-400 text-sm">{label}</div>
);

export const Empty: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="p-10 text-center">
    <p className="text-slate-300 font-medium">{title}</p>
    {hint && <p className="text-slate-500 text-sm mt-1">{hint}</p>}
  </div>
);

export interface FieldError {
  code?: string;
  message: string;
}

/**
 * Extrait la liste d'erreurs affichables d'une exception.
 *
 * Ordre de préférence, du plus précis au plus pauvre :
 *   1. `errors[]` — une ligne par erreur de validation, chacune avec son code ;
 *   2. `code` + `message` — erreur métier unitaire (ex. `ASSET_VERIFY_REFUSED`) ;
 *   3. `message` seul — le backend n'a pas envoyé de code : on n'en fabrique pas.
 */
export function toFieldErrors(err: unknown): FieldError[] {
  if (err instanceof ApiError) {
    if (err.errors.length > 0) {
      return err.errors.map((e) => ({ code: e.code, message: e.message }));
    }
    return [{ code: err.code ?? undefined, message: err.message }];
  }
  if (err instanceof Error) return [{ message: err.message }];
  return [{ message: String(err) }];
}

export const ErrorPanel: React.FC<{ errors: FieldError[]; title?: string }> = ({
  errors,
  title,
}) => {
  if (errors.length === 0) return null;
  return (
    <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">
      {title && <p className="font-semibold mb-2">{title}</p>}
      <ul className="space-y-1">
        {errors.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>
              {e.code && <span className="font-mono text-xs text-red-400/80 mr-2">{e.code}</span>}
              {e.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Écran de refus serveur (403). Traité à part d'une erreur technique : ce n'est
 * pas une panne, c'est une décision d'autorisation — et le front ne la contourne
 * ni ne la devine.
 */
export const Forbidden: React.FC<{ message?: string; detail?: string }> = ({
  message = 'Accès refusé.',
  detail,
}) => (
  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 text-center">
    <p className="text-amber-200 font-semibold">{message}</p>
    {detail && <p className="text-amber-200/70 text-sm mt-2">{detail}</p>}
    <p className="text-slate-500 text-xs mt-3">
      L'autorisation est décidée par le serveur. Si vous pensez devoir y accéder,
      demandez la mise à jour de votre rôle plutôt qu'un contournement.
    </p>
  </div>
);

/**
 * Carte de KPI honnête : un chiffre ne s'affiche jamais seul. `scope` (périmètre)
 * et `period` (période) sont requis — c'est la contrainte du §7.2 rendue
 * structurelle plutôt que laissée à la discipline de chaque écran.
 */
export const KpiCard: React.FC<{
  label: string;
  value: string;
  scope: string;
  period: string;
  note?: string;
}> = ({ label, value, scope, period, note }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
    <p className="text-xs text-slate-400">{label}</p>
    <p className="text-2xl font-bold text-white mt-1">{value}</p>
    <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
      Périmètre : {scope}
      <br />
      Période : {period}
    </p>
    {note && <p className="text-[11px] text-amber-300/80 mt-1">{note}</p>}
  </div>
);

/** Bandeau de troncature — toute liste coupée par le serveur l'annonce. */
export const TruncationNotice: React.FC<{ shown: number; total: number; cap: number }> = ({
  shown,
  total,
  cap,
}) => {
  if (shown >= total) return null;
  return (
    <p className="text-xs text-amber-300/90 px-4 py-3 border-t border-white/10">
      Liste tronquée par le serveur : {shown} ligne(s) affichée(s) sur {total}
      {' '}(plafond {cap}). Affinez les filtres pour voir le reste.
    </p>
  );
};
