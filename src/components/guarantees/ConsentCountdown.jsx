import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * Compte à rebours de la fenêtre de consentement du garant (SPEC §2.5).
 *
 * ── Ce que ce composant est, et ce qu'il n'est pas ─────────────────────────
 * C'est un **affichage**, pas une règle. Il met en forme la distance entre
 * maintenant et `expiresAt`, date arrêtée par le serveur. Il ne décide jamais
 * qu'une demande est expirée : cette qualification appartient au statut servi
 * par l'API (`expired`), pas à l'horloge du navigateur — qui peut être fausse,
 * décalée, ou dans un autre fuseau.
 *
 * La distinction n'est pas théorique. Si le front déclarait l'expiration
 * lui-même, un garant dont la machine avance de deux heures verrait sa demande
 * grisée alors que le serveur l'accepte encore ; l'inverse est pire encore. Le
 * composant signale donc « délai écoulé » quand son décompte atteint zéro, mais
 * l'écran continue de traiter la demande selon le statut serveur, et c'est le
 * serveur qui refusera si elle est réellement périmée.
 *
 * ── Pourquoi aucune durée n'est écrite en dur ──────────────────────────────
 * La SPEC parle de 72 h, mais la fenêtre est paramétrable
 * (`InstitutionConfig`). Afficher « 72 h » figerait dans l'interface une valeur
 * que le comité peut changer sans redéploiement — exactement ce que le
 * principe 8 interdit (« les règles vivent en base, pas dans le code »). On
 * affiche donc le temps **restant réel**, jamais la durée nominale de la
 * fenêtre.
 *
 * ── `audience` : à qui l'on parle ─────────────────────────────────────────
 * Le décompte est le même ; la phrase qui l'introduit ne peut pas l'être. Dire
 * « il vous reste » à l'agent qui SUIT la caution d'un tiers (écran
 * `/credit/garanties`) lui attribue un délai qui n'est pas le sien. Le défaut
 * reste `guarantor` : le parcours du garant est inchangé, au mot près.
 *
 * @param {{expiresAt: string|null|undefined, audience?: 'guarantor'|'staff'}} props
 *   `expiresAt` — ISO 8601 servi par l'API.
 */

/** Décompose un nombre de millisecondes en jours / heures / minutes / secondes. */
function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/**
 * Texte du décompte. Sous une heure, les secondes s'affichent : c'est le moment
 * où elles comptent vraiment pour la personne qui hésite.
 */
function formatRemaining(ms) {
  const { days, hours, minutes, seconds } = splitDuration(ms);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

/** Palier d'urgence — purement visuel, aucun effet sur ce qui est autorisé. */
function urgency(ms) {
  if (ms <= 0) return 'elapsed';
  if (ms <= 6 * 3600 * 1000) return 'critical';
  if (ms <= 24 * 3600 * 1000) return 'warning';
  return 'calm';
}

const TONE = {
  calm: 'bg-sky-500/10 text-sky-200 border-sky-500/30',
  warning: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  critical: 'bg-orange-500/20 text-orange-200 border-orange-500/50',
  elapsed: 'bg-red-500/15 text-red-200 border-red-500/40',
};

const ConsentCountdown = ({ expiresAt, audience = 'guarantor' }) => {
  const target = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const valid = Number.isFinite(target);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return undefined;
    // 1 s : le décompte est un élément de pression légitime sur un acte qui
    // engage financièrement — il doit être vivant, pas figé au chargement.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [valid]);

  // Pas de date d'échéance servie : on le dit, on n'invente pas de délai.
  if (!valid) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        Échéance non communiquée
      </span>
    );
  }

  const remaining = target - now;
  const level = urgency(remaining);
  const absolute = new Date(target).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold ${TONE[level]}`}
      // La date absolue reste accessible : un décompte relatif seul empêche de
      // s'organiser (« je réponds ce soir » n'est décidable qu'avec l'heure).
      title={`Échéance : ${absolute}`}
    >
      <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
      {level === 'elapsed' ? (
        <span>Délai écoulé</span>
      ) : (
        <span>
          <span className="font-normal opacity-80">
            {audience === 'staff' ? 'Réponse du garant attendue sous' : 'Il vous reste'}
          </span>{' '}
          <span className="tabular-nums">{formatRemaining(remaining)}</span>
        </span>
      )}
    </span>
  );
};

export { formatRemaining, splitDuration };
export default ConsentCountdown;
