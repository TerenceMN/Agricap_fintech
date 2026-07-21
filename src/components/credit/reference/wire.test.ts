/**
 * Colle de l'écran « Données de référence » (admin).
 *
 * Deux choses sont testées ici, pour des raisons opposées :
 *
 *   - les troncateurs d'affichage (`shortSub`, `shortHash`) et les formateurs :
 *     un `sha256` raccourci dans un tableau est acceptable, un `sub` tronqué
 *     dans un message d'audit ne l'est pas — la frontière doit rester nette ;
 *   - `refDataErrors`, qui est un CONTOURNEMENT devenu obsolète. Il a été écrit
 *     quand `api.ts` perdait le texte des erreurs-chaînes de `reference_data`.
 *     `api.ts` les normalise désormais : le contournement ne se déclenche plus
 *     sur le cas pour lequel il a été écrit, et son propre commentaire décrit un
 *     état du monde révolu. Les tests ci-dessous constatent le comportement réel
 *     plutôt que celui annoncé — c'est signalé en fin de fichier.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/services/api';
import {
  BAREME_PORTEE,
  GOLDEN_SET_CAP,
  REFERENCE_FILE_TYPES,
  REFERENCE_UPLOADS_CAP,
  TEMPLATES_CAP,
  TEMPLATE_STATUS_LABELS,
  fmtNum,
  fmtRaw,
  fmtSigned,
  isForbidden,
  labelOf,
  refDataErrors,
  shortHash,
  shortSub,
} from '@/components/credit/reference/wire';

describe('shortSub', () => {
  it('laisse intact un identifiant déjà court', () => {
    expect(shortSub('abc')).toBe('abc');
    expect(shortSub('12345678901234')).toBe('12345678901234'); // 14 = limite incluse
  });

  it('tronque au milieu en gardant début ET fin', () => {
    // La fin est ce qui distingue deux `sub` issus du même IdP : la couper
    // rendrait deux acteurs différents indiscernables dans un tableau.
    const sub = '9f8c2a1b-4d5e-6f70-8a9b-0c1d2e3f4a5b';
    const court = shortSub(sub);

    expect(court.startsWith('9f8c2a1b')).toBe(true);
    expect(court.endsWith('4a5b')).toBe(true);
    expect(court).toContain('…');
    expect(court.length).toBeLessThan(sub.length);
  });

  it('affiche « — » sur un acteur absent', () => {
    expect(shortSub(null)).toBe('—');
    expect(shortSub(undefined)).toBe('—');
    expect(shortSub('')).toBe('—');
  });
});

describe('shortHash', () => {
  it('coupe une empreinte longue à 12 caractères significatifs', () => {
    const sha = 'a'.repeat(64);

    expect(shortHash(sha)).toBe(`${'a'.repeat(12)}…`);
  });

  it('laisse intacte une empreinte courte', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef0123456789');
  });

  it('affiche « — » quand aucune empreinte n’est servie', () => {
    expect(shortHash(null)).toBe('—');
    expect(shortHash('')).toBe('—');
  });
});

describe('fmtNum / fmtSigned / fmtRaw', () => {
  it('distingue zéro d’une absence de valeur', () => {
    expect(fmtNum(0)).toBe('0,0');
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
  });

  it('respecte le nombre de décimales demandé', () => {
    expect(fmtNum(3.14159, 2)).toBe('3,14');
    expect(fmtNum(3, 0)).toBe('3');
  });

  it('préfixe d’un « + » les seuls deltas positifs', () => {
    expect(fmtSigned(2.5)).toBe('+2,5');
    expect(fmtSigned(-2.5)).toBe('-2,5');
    // Un delta nul n'est ni un gain ni une perte : pas de signe inventé.
    expect(fmtSigned(0)).toBe('0,0');
    expect(fmtSigned(null)).toBe('—');
  });

  it('affiche un `Decimal` sérialisé sans jamais le reconvertir', () => {
    // Le serveur envoie « 1.250 » : l'écran l'affiche tel quel. Passer par
    // `Number()` afficherait « 1.25 » et laisserait croire à une autre précision.
    expect(fmtRaw('1.250')).toBe('1.250');
    expect(fmtRaw(0)).toBe('0');
    expect(fmtRaw(null)).toBe('—');
    expect(fmtRaw('')).toBe('—');
  });
});

describe('labelOf', () => {
  it('traduit une clé connue', () => {
    expect(labelOf(TEMPLATE_STATUS_LABELS, 'active').label).toBe('Actif');
  });

  it('affiche une clé inconnue telle quelle', () => {
    expect(labelOf(TEMPLATE_STATUS_LABELS, 'superseded').label).toBe('superseded');
  });
});

describe('constantes miroir du backend', () => {
  it('fige les plafonds de troncature annoncés à l’écran', () => {
    expect(TEMPLATES_CAP).toBe(100);
    expect(REFERENCE_UPLOADS_CAP).toBe(50);
    expect(GOLDEN_SET_CAP).toBe(200);
  });

  it('n’annonce comme pris en charge que le type de fichier réellement validé', () => {
    const supportes = REFERENCE_FILE_TYPES.filter((t) => t.supported).map((t) => t.code);

    // `services.process_upload` n'a de validateur que pour `value_chains` ;
    // annoncer les deux autres comme utilisables ferait perdre son temps à un admin.
    expect(supportes).toEqual(['value_chains']);
  });

  it('décrit la portée des quatre barèmes, dont celui qui ne touche aucun critère', () => {
    expect(Object.keys(BAREME_PORTEE).sort()).toEqual([
      'COUVERTURE_GARANTIES', 'DECISION', 'DSCR', 'ECART_TECHNIQUE',
    ]);
    expect(BAREME_PORTEE.DECISION).toContain('Aucun critère');
  });
});

describe('isForbidden', () => {
  it('reconnaît un refus d’autorisation', () => {
    expect(isForbidden(new ApiError(403, 'Interdit', 'FORBIDDEN'))).toBe(true);
  });

  it('ne confond pas un 403 avec une panne ou un autre refus', () => {
    expect(isForbidden(new ApiError(404, 'Introuvable'))).toBe(false);
    expect(isForbidden(new ApiError(500, 'Erreur serveur'))).toBe(false);
    expect(isForbidden(new Error('réseau'))).toBe(false);
    expect(isForbidden(null)).toBe(false);
    expect(isForbidden('403')).toBe(false);
  });
});

describe('refDataErrors', () => {
  it('laisse passer intactes des erreurs qui parlent', () => {
    const err = new ApiError(422, 'Refusé', 'VALIDATION', [
      { code: 'LIGNE_4', message: 'Code filière inconnu.' },
      { code: 'LIGNE_7', message: 'cycle_mois doit être un entier.' },
    ]);

    expect(refDataErrors(err)).toEqual([
      { code: 'LIGNE_4', message: 'Code filière inconnu.' },
      { code: 'LIGNE_7', message: 'cycle_mois doit être un entier.' },
    ]);
  });

  it('remplace un lot d’erreurs muettes par une ligne qui dit la vérité', () => {
    // Cas résiduel : le serveur envoie des objets `{code}` SANS `message`.
    // `api.ts` les normalise en `message: ''` → des puces qui n'expliquent rien.
    const err = new ApiError(422, 'Refusé', 'VALIDATION', [
      { code: 'E1', message: '' },
      { code: 'E2', message: '' },
      { code: 'E3', message: 'Celle-ci parle.' },
    ]);

    const affichables = refDataErrors(err);

    expect(affichables).toHaveLength(2);
    expect(affichables[0]).toEqual({ code: 'E3', message: 'Celle-ci parle.' });
    expect(affichables[1].code).toBe('ERREURS_NON_RELAYEES');
    expect(affichables[1].message).toContain('2 erreur(s)');
  });

  it('replie sur le message unique quand le serveur n’envoie pas de liste', () => {
    const err = new ApiError(403, 'Réservé au checker', 'MAKER_EQ_CHECKER');

    expect(refDataErrors(err)).toEqual([
      { code: 'MAKER_EQ_CHECKER', message: 'Réservé au checker' },
    ]);
  });

  it('accepte une exception qui n’est pas une ApiError', () => {
    expect(refDataErrors(new Error('Réseau indisponible'))).toEqual([
      { message: 'Réseau indisponible' },
    ]);
    expect(refDataErrors('boum')).toEqual([{ message: 'boum' }]);
  });

  /**
   * CONTOURNEMENT DEVENU OBSOLÈTE — signalé, pas corrigé (hors périmètre).
   *
   * Le commentaire de `refDataErrors` affirme que `api.ts` « n'attend que des
   * {code, message} » et produit « autant de lignes vides que d'erreurs » sur un
   * refus de `reference_data`. Ce n'est plus vrai : `request()` normalise
   * désormais les erreurs-chaînes en `{code:'ERREUR', message: <la chaîne>}`.
   * Le contournement ne se déclenche donc plus sur son cas d'origine — ce test
   * le prouve — et la documentation qui l'entoure induit en erreur.
   *
   * À faire, dans un lot qui possède ces fichiers : mettre le commentaire à jour
   * et décider si `refDataErrors` garde une raison d'être (elle en garde une,
   * étroite : les objets `{code}` sans `message`, cf. test ci-dessus).
   */
  it('CONSTAT : les erreurs-chaînes ne passent plus par le contournement', () => {
    const normaliseesParApiTs = [
      { code: 'ERREUR', message: 'Ligne 4 : code filière « MAIS2 » inconnu.' },
      { code: 'ERREUR', message: 'Ligne 7 : cycle_mois doit être un entier.' },
    ];
    const err = new ApiError(422, 'Feuille « filieres » introuvable.', null, normaliseesParApiTs);

    const affichables = refDataErrors(err);

    expect(affichables).toEqual(normaliseesParApiTs);
    expect(affichables.some((e) => e.code === 'ERREURS_NON_RELAYEES')).toBe(false);
  });
});
