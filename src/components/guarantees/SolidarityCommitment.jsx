import React from 'react';
import { Scale } from 'lucide-react';
import { formatMontant } from './format';

/**
 * L'énoncé de l'engagement solidaire — le cœur de l'écran garant.
 *
 * SPEC §2.5, « Front garant » : « engagement en clair (“en cas de défaut de X,
 * vous vous engagez solidairement à hauteur de Y”) […] Le texte d'engagement
 * doit être explicite — c'est un acte juridique, pas un clic social. »
 *
 * ── Pourquoi ce composant existe séparément ────────────────────────────────
 * Parce que la tentation, sur une carte de liste, est de réduire cette phrase à
 * une ligne de métadonnée parmi les autres — « Montant couvert : 400 USD » —
 * alignée avec la filière et le nom du demandeur. Un garant peut parcourir
 * cette carte, cliquer « Accepter » et n'avoir jamais lu qu'il s'engageait.
 * Le montant couvert n'est pas une caractéristique de la demande : c'est ce que
 * le garant devra payer. Il est donc sorti de la grille d'information et rendu
 * comme une déclaration, en typographie de titre, dans un bloc qui lui est
 * propre.
 *
 * ── Ce qui n'est pas calculé ici ───────────────────────────────────────────
 * Rien. `coveredAmount` est le `montant_couvert` arrêté par le serveur ; il
 * n'est ni dérivé du montant du crédit, ni décoté côté client. La décote de
 * 70 % de la SPEC §2.5(5) concerne la **couverture au scoring**, pas ce que le
 * garant doit : les confondre afficherait au garant un engagement inférieur à
 * son engagement réel. C'est l'erreur à ne jamais commettre sur cet écran.
 *
 * @param {{
 *   applicantName?: string|null,
 *   coveredAmount?: number|string|null,
 *   currency?: string|null,
 *   emphasis?: boolean,
 * }} props
 */
const SolidarityCommitment = ({
  applicantName,
  coveredAmount,
  currency,
  emphasis = true,
}) => {
  // Le nom manquant ne se remplace pas par du vide : « en cas de défaut de , »
  // est une phrase cassée sur un acte juridique. On nomme l'inconnue.
  const who = applicantName && String(applicantName).trim()
    ? String(applicantName).trim()
    : 'le demandeur';

  const amountKnown =
    coveredAmount !== null && coveredAmount !== undefined && coveredAmount !== ''
    && Number.isFinite(Number(coveredAmount));

  return (
    <div
      className={
        emphasis
          ? 'rounded-xl border-2 border-amber-500/50 bg-amber-500/[0.07] p-5'
          : 'rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4'
      }
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300/90">
        <Scale className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Ce à quoi vous vous engagez
      </p>

      <p className="mt-3 text-lg leading-relaxed text-white sm:text-xl">
        En cas de défaut de paiement de{' '}
        <strong className="font-bold text-amber-200">{who}</strong>, vous vous engagez{' '}
        <strong className="font-bold text-amber-200">solidairement</strong> à rembourser
        AGRICAP à hauteur de{' '}
        {amountKnown ? (
          <strong className="whitespace-nowrap font-bold text-amber-200">
            {formatMontant(coveredAmount, currency || 'USD')}
          </strong>
        ) : (
          // Montant non servi : on ne met pas 0, on ne met pas « — » au milieu
          // d'une phrase d'engagement. On dit que le chiffre manque.
          <strong className="font-bold text-red-300">
            (montant non communiqué par le serveur)
          </strong>
        )}
        .
      </p>

      <p className="mt-3 text-sm leading-relaxed text-amber-100/70">
        « Solidairement » signifie qu'AGRICAP peut vous réclamer cette somme{' '}
        <strong className="text-amber-100">directement et en totalité</strong>, sans avoir à
        poursuivre d'abord {who}, et sans que la dette soit partagée entre plusieurs garants.
        Votre épargne AGRICAP peut être mobilisée à ce titre.
      </p>
    </div>
  );
};

export default SolidarityCommitment;
