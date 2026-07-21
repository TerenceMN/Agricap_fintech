/**
 * Libellés client des statuts de dossier.
 *
 * L'enjeu n'est pas cosmétique : ces libellés sont ce qu'un demandeur lit pour
 * savoir s'il doit attendre, refaire son dossier ou appeler son agence. La règle
 * la plus importante du module est le REFUS DE DEVINER — un statut inconnu
 * (backend qui en ajoute un, front pas encore déployé) s'affiche tel quel, il
 * n'est jamais rattaché au plus proche. Un « rattachement au plus proche »
 * afficherait « Accordée » sur un dossier qui ne l'est pas.
 */
import { describe, expect, it } from 'vitest';
import { EN_COURS, STATUTS_CLIENT, statutClient } from '@/components/credits/dossierStatus';

describe('statutClient — statuts connus', () => {
  it('traduit chaque code du backend en libellé client', () => {
    expect(statutClient('draft').label).toBe('Brouillon');
    expect(statutClient('submitted').label).toBe('Envoyée');
    expect(statutClient('in_analysis').label).toBe('En cours d’examen');
    expect(statutClient('adjourned').label).toBe('En attente d’informations');
    expect(statutClient('approved').label).toBe('Accordée');
    expect(statutClient('pending_disbursement').label).toBe('Décaissement en cours');
    expect(statutClient('active').label).toBe('En cours de remboursement');
    expect(statutClient('closed').label).toBe('Soldée');
    expect(statutClient('rejected').label).toBe('Refusée');
  });

  it('n’expose aucun vocabulaire de backoffice au client', () => {
    // « En analyse » / « Ajourné » décrivent le travail de l'institution ;
    // le client doit lire ce qui le concerne, lui.
    expect(statutClient('in_analysis').label).not.toBe('En analyse');
    expect(statutClient('adjourned').label).not.toBe('Ajourné');
  });

  it('donne une aide actionnable sur chaque statut, sauf le refus', () => {
    for (const [code, meta] of Object.entries(STATUTS_CLIENT)) {
      if (code === 'rejected') continue;
      expect(meta.aide, `aide manquante sur « ${code} »`).toBeTruthy();
    }
    // Sur un refus, le motif servi par le backend prime : pas de texte générique
    // qui viendrait le contredire ou le noyer.
    expect(statutClient('rejected').aide).toBeNull();
  });

  it('porte une classe de couleur sur chaque statut', () => {
    for (const [code, meta] of Object.entries(STATUTS_CLIENT)) {
      expect(meta.couleur, `couleur manquante sur « ${code} »`).toBeTruthy();
    }
  });
});

describe('statutClient — statut inconnu', () => {
  it('affiche le code tel quel plutôt que de le rattacher au plus proche', () => {
    const inconnu = statutClient('escalated_to_committee');

    expect(inconnu.label).toBe('escalated_to_committee');
    expect(inconnu.aide).toBeNull();
    expect(inconnu.couleur).toBeTruthy();
  });

  it('ne se rabat jamais sur un statut favorable', () => {
    const inconnu = statutClient('approved_pending_signature');

    expect(inconnu.label).not.toBe('Accordée');
    expect(inconnu.label).toBe('approved_pending_signature');
  });

  it('affiche un tiret cadratin sur un code vide ou absent', () => {
    expect(statutClient('').label).toBe('—');
    expect(statutClient(undefined).label).toBe('—');
    expect(statutClient(null).label).toBe('—');
  });
});

describe('EN_COURS — dossiers vivants vs historique', () => {
  it('range les statuts actifs dans « en cours »', () => {
    for (const code of ['draft', 'submitted', 'in_analysis', 'adjourned',
      'approved', 'pending_disbursement', 'active']) {
      expect(EN_COURS.has(code), `« ${code} » devrait être en cours`).toBe(true);
    }
  });

  it('exclut les statuts terminaux', () => {
    expect(EN_COURS.has('closed')).toBe(false);
    expect(EN_COURS.has('rejected')).toBe(false);
  });

  it('invariant : tout statut « en cours » a un libellé client', () => {
    // Sans quoi un dossier vivant s'afficherait avec son code technique brut.
    for (const code of EN_COURS) {
      expect(Object.prototype.hasOwnProperty.call(STATUTS_CLIENT, code),
        `« ${code} » est dans EN_COURS mais absent de STATUTS_CLIENT`).toBe(true);
    }
  });

  it('invariant : un statut inconnu n’est pas « en cours » par défaut', () => {
    // L'onglet « historique » est le repli sûr : un dossier au statut inattendu
    // y apparaît, il ne disparaît pas.
    expect(EN_COURS.has('escalated_to_committee')).toBe(false);
  });
});
