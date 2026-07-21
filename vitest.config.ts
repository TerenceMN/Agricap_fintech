/**
 * Configuration Vitest — outillage de test du front AGRICAP FINTECH.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE SUITE PROTÈGE — ET, SURTOUT, CE QU'ELLE NE PROTÈGE PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CE QU'ELLE ATTRAPE : les régressions de LOGIQUE FRONT. Un parseur d'erreurs
 * qui perd un message, une bande de score déplacée d'un point, une fonction de
 * tri inversée, un libellé de statut qui se met à deviner au lieu d'afficher le
 * code inconnu, un formateur de montant qui transforme `0` en « — ». Ce sont des
 * fonctions pures, déterministes, dont le contrat vit ENTIÈREMENT côté front :
 * là, un test rouge veut dire quelque chose.
 *
 * CE QU'ELLE N'ATTRAPE PAS — et c'est la classe de défaut qui a réellement
 * atteint l'utilisateur SIX FOIS ce mois-ci (crash `criterion`, crash `PROMPTS`,
 * bandeau cash-flow vide, …) : le DÉSACCORD entre la forme qu'un module front
 * DÉCLARE et la forme que le serveur SERT réellement. Aucun test de cette suite
 * ne parle au backend. Tous les payloads y sont écrits à la main, donc écrits
 * D'APRÈS LA MÊME LECTURE DU CONTRAT que le code testé.
 *
 * La conséquence est désagréable et doit être dite : **un test écrit sur une
 * forme mal lue CIMENTE l'erreur au lieu de l'attraper.** Si un écran croit que
 * le serveur envoie `criterion` alors qu'il envoie `criteres`, le test écrit par
 * la même main croira la même chose, passera au vert, et rendra la correction
 * plus difficile — il faudra désormais changer le test aussi. Le vert de
 * `vitest run` ne dit RIEN sur la fidélité au backend.
 *
 * Ce qui attraperait cette classe-là, et qui reste à faire :
 *   - des types générés depuis le backend (schéma OpenAPI/DRF) plutôt que
 *     recopiés à la main dans `src/types/api.ts` ;
 *   - des tests de contrat qui rejouent des réponses CAPTURÉES du vrai serveur
 *     (fixtures produites par les tests Django), et non rédigées côté front ;
 *   - un smoke E2E sur un backend réel.
 *
 * Tant que ces trois-là n'existent pas, personne ne doit lire « suite verte »
 * comme « le front et le back sont d'accord ». Ils ne le sont pas plus qu'hier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Note d'implémentation : cette configuration est autonome et ne réutilise PAS
 * `vite.config.js`. Ce dernier charge, hors production, les plugins de l'éditeur
 * visuel Horizons (transformation de source, injection de scripts dans
 * `index.html`) qui n'ont aucun sens sous test et qui parasiteraient les
 * modules chargés. Seuls l'alias `@/` et l'ordre de résolution des extensions
 * sont repris — ils doivent rester alignés avec `vite.config.js` et `tsconfig`.
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Identique à `vite.config.js` : un composant `.tsx` prime sur un `.jsx` de même nom.
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // Pas de globales implicites : chaque test importe `describe`/`it`/`expect`
    // de `vitest`. Un fichier de test se lit alors sans deviner d'où vient quoi.
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx,js,jsx}'],
    // Les mocks (notamment `globalThis.fetch`) sont rendus après chaque test :
    // un test qui oublie de nettoyer ne contamine pas le suivant.
    restoreMocks: true,
    unstubGlobals: true,
    clearMocks: true,
  },
});
