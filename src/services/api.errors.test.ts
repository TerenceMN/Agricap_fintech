
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/services/api';

/** Réponse HTTP JSON minimale, telle que `request()` la consomme. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function respondWith(res: Response): void {
  vi.stubGlobal('fetch', vi.fn(async () => res));
}

/** Récupère l'exception d'une promesse censée échouer, pour l'inspecter. */
async function capture(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw new Error(`exception inattendue : ${String(err)}`);
  }
  throw new Error('la requête aurait dû échouer');
}

beforeEach(() => {
  // `request()` journalise chaque échec ; on ne veut pas polluer la sortie.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Pas de jeton de rafraîchissement → un 401 ne déclenche aucun aller-retour IdP.
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiError', () => {
  it('porte le statut, le message, le code et la liste d’erreurs', async () => {
    respondWith(jsonResponse(409, { detail: 'Transition interdite', code: 'ETAT_INVALIDE' }));
    const err = await capture(api.me());

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(409);
    expect(err.message).toBe('Transition interdite');
    expect(err.code).toBe('ETAT_INVALIDE');
    expect(err.errors).toEqual([]);
  });

  it('laisse `code` à null quand le serveur n’en envoie pas — jamais de code inventé', async () => {
    respondWith(jsonResponse(400, { detail: 'Requête invalide' }));
    const err = await capture(api.me());

    expect(err.code).toBeNull();
  });

  it('n’utilise JAMAIS le statut HTTP comme code métier', async () => {
    respondWith(jsonResponse(422, { detail: 'Fichier refusé' }));
    const err = await capture(api.me());

    // « 422 » dit que la requête a été refusée, pas pourquoi.
    expect(err.code).not.toBe('422');
    expect(err.code).toBeNull();
  });
});

describe('errors[] servi en objets {code, message} (pipeline feuille de besoins)', () => {
  it('restitue chaque erreur avec son propre code et son texte', async () => {
    respondWith(jsonResponse(422, {
      detail: 'Le classeur comporte 2 erreurs.',
      code: 'VALIDATION_FEUILLE',
      errors: [
        { code: 'SOMME_F4_F5', message: 'Feuille 5 (1 200) ≠ somme feuille 4 (1 410).' },
        { code: 'TOTAL_RUBRIQUE', message: 'Rubrique « semences » : TOTAL ≠ Σ lignes.' },
      ],
    }));
    const err = await capture(api.me());

    expect(err.errors).toEqual([
      { code: 'SOMME_F4_F5', message: 'Feuille 5 (1 200) ≠ somme feuille 4 (1 410).' },
      { code: 'TOTAL_RUBRIQUE', message: 'Rubrique « semences » : TOTAL ≠ Σ lignes.' },
    ]);
  });

  it('replie sur le code générique ERREUR quand l’objet n’en porte pas', async () => {
    respondWith(jsonResponse(422, { detail: 'Refusé', errors: [{ message: 'Colonne D absente.' }] }));
    const err = await capture(api.me());

    expect(err.errors).toEqual([{ code: 'ERREUR', message: 'Colonne D absente.' }]);
  });
});

describe('errors[] servi en CHAÎNES (reference_data/validators.py)', () => {
  it('conserve le texte de chaque chaîne — c’est LA régression à ne jamais revoir', async () => {
    respondWith(jsonResponse(422, {
      valid: false,
      structureError: 'Le classeur ne comporte pas la feuille « filieres ».',
      errors: [
        'Ligne 4 : code filière « MAIS2 » inconnu.',
        'Ligne 7 : cycle_mois doit être un entier.',
        'Ligne 9 : poids des modules ≠ 100.',
      ],
    }));
    const err = await capture(api.me());

    expect(err.errors).toHaveLength(3);
    // Le défaut historique : `e.message` sur une chaîne → `undefined` → puce muette.
    for (const e of err.errors) {
      expect(e.message).not.toBe('');
      expect(e.message).toBeTypeOf('string');
    }
    expect(err.errors[0]).toEqual({
      code: 'ERREUR',
      message: 'Ligne 4 : code filière « MAIS2 » inconnu.',
    });
    expect(err.errors[2].message).toBe('Ligne 9 : poids des modules ≠ 100.');
  });

  it('normalise un mélange chaînes / objets dans le même tableau', async () => {
    respondWith(jsonResponse(422, {
      errors: ['Erreur en chaîne.', { code: 'X1', message: 'Erreur en objet.' }],
    }));
    const err = await capture(api.me());

    expect(err.errors).toEqual([
      { code: 'ERREUR', message: 'Erreur en chaîne.' },
      { code: 'X1', message: 'Erreur en objet.' },
    ]);
  });

  it('ignore un `errors` qui n’est pas un tableau plutôt que de planter', async () => {
    respondWith(jsonResponse(422, { detail: 'Refusé', errors: { champ: 'valeur' } }));
    const err = await capture(api.me());

    expect(err.errors).toEqual([]);
    expect(err.message).toBe('Refusé');
  });
});

describe('repli sur `structureError`', () => {
  it('affiche `structureError` quand le serveur n’envoie pas de `detail`', async () => {
    respondWith(jsonResponse(422, {
      valid: false,
      structureError: 'Feuille « filieres » introuvable dans le classeur.',
    }));
    const err = await capture(api.me());

    // Sans ce repli, l'écran affichait « Erreur 422 » alors que le serveur
    // disait précisément quoi corriger.
    expect(err.message).toBe('Feuille « filieres » introuvable dans le classeur.');
  });

  it('donne la priorité à `detail` quand les deux sont présents', async () => {
    respondWith(jsonResponse(422, { detail: 'Message principal', structureError: 'Message de repli' }));
    const err = await capture(api.me());

    expect(err.message).toBe('Message principal');
  });
});

describe('corps de réponse non exploitable', () => {
  it('retombe sur « Erreur <statut> » si le corps n’est pas du JSON', async () => {
    respondWith(textResponse(500, '<html><body>502 Bad Gateway</body></html>'));
    const err = await capture(api.me());

    expect(err.status).toBe(500);
    expect(err.message).toBe('Erreur 500');
    expect(err.code).toBeNull();
    expect(err.errors).toEqual([]);
  });

  it('propage un 401 tel quel quand aucun jeton de rafraîchissement n’est en session', async () => {
    respondWith(jsonResponse(401, { detail: 'Jeton expiré', code: 'TOKEN_EXPIRED' }));
    const err = await capture(api.me());

    expect(err.status).toBe(401);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });
});

describe('DÉFAUT CONSTATÉ — le repli `detail = errors[0].message` est inatteignable', () => {
  /**
   * `request()` initialise `detail = \`Erreur ${res.status}\`` AVANT de lire le
   * corps, puis exécute plus bas :
   *
   *     if (!detail && errors.length) detail = errors[0].message;
   *
   * `detail` étant déjà « Erreur 422 », donc TRUTHY, la condition n'est jamais
   * vraie : ce repli est du code mort. Un 422 qui ne porte que `errors[]` — la
   * forme la plus courante d'un refus multi-erreurs — s'affiche donc
   * « Erreur 422 » là où le serveur avait fourni un texte utilisable.
   *
   * Conséquence visible : tout écran qui rend `err.message` seul (bandeau, toast)
   * affiche un nombre au lieu d'une explication ; seuls les écrans qui déplient
   * `err.errors` s'en sortent.
   *
   * Correctif hors périmètre (`api.ts` est en lecture seule pour cet agent) :
   * initialiser `detail` à `''` et ne composer « Erreur <statut> » qu'en tout
   * dernier recours, APRÈS la lecture de `errors[]`.
   */
  it('reprend le premier message quand le serveur ne donne pas de `detail`', async () => {
    respondWith(jsonResponse(422, {
      errors: [{ code: 'SOMME_F4_F5', message: 'Feuille 5 ≠ somme feuille 4.' }],
    }));
    const err = await capture(api.me());

    // CORRIGÉ : `detail` part désormais de `''`, donc le repli sur `errors[0]`
    // s'exécute réellement. Un bandeau qui ne rend que `err.message` affiche
    // l'explication du serveur, plus un numéro de statut.
    expect(err.message).toBe('Feuille 5 ≠ somme feuille 4.');
    expect(err.errors[0].message).toBe('Feuille 5 ≠ somme feuille 4.');
  });

  it('compose « Erreur <statut> » SEULEMENT quand le serveur n’a rien dit', async () => {
    // Le repli doit rester : sans corps exploitable, l'utilisateur a quand même
    // besoin d'un message. Ce test empêche de supprimer le repli en croyant
    // supprimer le bug.
    respondWith(jsonResponse(500, {}));
    const err = await capture(api.me());

    expect(err.message).toBe('Erreur 500');
  });

  /**
   * Même cause, forme la plus dommageable : un objet `{code}` SANS `message` est
   * normalisé en `message: ''`. La puce affichée par `ErrorPanel` porte alors son
   * code et rien d'autre. `refDataErrors` (écran Référence) a été écrit pour
   * rattraper exactement ce cas côté écran — preuve que le trou est connu, mais
   * il est rattrapé à un seul endroit sur les quatre écrans concernés.
   */
  it('constate qu’un objet sans `message` produit une puce muette', async () => {
    respondWith(jsonResponse(422, { errors: [{ code: 'SANS_TEXTE' }] }));
    const err = await capture(api.me());

    expect(err.errors).toEqual([{ code: 'SANS_TEXTE', message: '' }]);
  });
});
