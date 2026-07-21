/**
 * Amorçage commun des tests.
 *
 * Volontairement minimal : démonter les arbres React entre deux tests, et rien
 * d'autre. Aucun `fetch` global n'est posé ici — un test qui parle au réseau
 * doit le déclarer lui-même (`vi.stubGlobal('fetch', …)`), pour qu'on voie dans
 * le fichier de test ce qu'il croit que le serveur répond.
 *
 * Les matchers `@testing-library/jest-dom` sont chargés pour être disponibles,
 * mais les tests actuels s'en passent : ce fichier vit hors du `include` de
 * `tsconfig.json`, donc son augmentation de types n'est pas visible de
 * `npx tsc --noEmit`. Utiliser `toBeInTheDocument()` dans un test rendrait la
 * vérification de types rouge — assertions sur `textContent` à la place.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
