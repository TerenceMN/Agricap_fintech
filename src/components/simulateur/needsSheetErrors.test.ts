import { describe, it, expect } from 'vitest';
import {
  isFileValidationError,
  isBusinessBlockingError,
  transportErrorMessage,
} from './needsSheetErrors';

/**
 * Un refus de gouvernance ne doit JAMAIS s'afficher comme un défaut de classeur.
 *
 * Origine : `POST /credits/applications/` refusait en 422 `BENEFICIAIRE_INTERNE`
 * (« un membre du personnel ne peut pas être bénéficiaire d'un crédit — il serait
 * juge et partie »). Le front, qui classe tout 422 comme un refus de fichier,
 * affichait « Un point à corriger dans votre fichier » puis « Corrigez tous ces
 * points dans le classeur, puis téléversez-le à nouveau ».
 *
 * Le classeur était irréprochable. Aucun re-téléversement n'aurait jamais levé
 * ce refus : l'action réelle est d'assigner le dossier à un client. L'écran
 * envoyait donc le client corriger, en boucle, un document sans défaut — c'est
 * précisément le « se tromper de coupable » que ce module dit vouloir éviter.
 */
describe('refus de gouvernance vs défaut de classeur', () => {
  const refusMetier = {
    status: 422,
    code: 'BENEFICIAIRE_INTERNE',
    message:
      '« Utilisateur Test » est un membre interne (rôle « admin ») : un membre du '
      + "personnel ne peut pas être bénéficiaire d'un crédit AGRICAP.",
  };

  it('reconnaît le refus métier, malgré son statut 422', () => {
    expect(isBusinessBlockingError(refusMetier)).toBe(true);
  });

  it('ne le classe PAS comme un défaut de fichier', () => {
    expect(isFileValidationError(refusMetier)).toBe(false);
  });

  it('le reconnaît aussi quand le code arrive dans le détail d’un 422 structuré', () => {
    const structure = {
      status: 422,
      errors: [{ code: 'BENEFICIAIRE_INTERNE', message: 'Membre interne.' }],
    };
    expect(isBusinessBlockingError(structure)).toBe(true);
    expect(isFileValidationError(structure)).toBe(false);
  });

  it('dit l’action réelle et disculpe explicitement le classeur', () => {
    const { titre, message } = transportErrorMessage(refusMetier);
    expect(titre).toContain('assigné à un client');
    // Le motif du serveur est relayé : il nomme la personne et son rôle.
    expect(message).toContain('membre interne');
    // Et surtout : on ne l’envoie pas modifier un fichier sans défaut.
    expect(message).toMatch(/n'est pas en cause|n’est pas en cause/);
    expect(message).not.toMatch(/Corrigez tous ces points/);
  });

  it('laisse un VRAI refus de classeur dans le cadre « à corriger »', () => {
    // Non-régression : la correction ne doit pas disculper le fichier à tort.
    const refusFichier = {
      status: 422,
      errors: [{ code: 'TOTAL_INCOHERENT', message: 'Feuille 5 ≠ somme feuille 4.' }],
    };
    expect(isBusinessBlockingError(refusFichier)).toBe(false);
    expect(isFileValidationError(refusFichier)).toBe(true);
  });

  it('laisse une panne de transport hors du cadre « à corriger »', () => {
    expect(isFileValidationError({ status: 500 })).toBe(false);
    expect(transportErrorMessage({ status: 500 }).message).toContain('pas dans votre fichier');
  });
});
