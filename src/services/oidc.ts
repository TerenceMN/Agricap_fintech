// Client OIDC (Authorization Code + PKCE) contre l'IdP AGRICAP.
// Login ET register sont gérés par l'IdP : `beginLogin` redirige vers /authorize
// (l'écran IdP propose « se connecter » et « créer un compte »). `beginRegister`
// ajoute un indice pour ouvrir directement l'inscription.

const ISSUER = (import.meta.env.VITE_IDP_ISSUER || 'http://localhost:8001').replace(/\/+$/, '');
const CLIENT_ID = import.meta.env.VITE_IDP_CLIENT_ID || 'agricap-fintech';
const REDIRECT_URI = import.meta.env.VITE_IDP_REDIRECT_URI || `${window.location.origin}/auth/callback`;
const SCOPE = 'openid profile email offline_access mobile_money business';

const EP = {
  authorize: `${ISSUER}/authorize`,
  token: `${ISSUER}/token`,
  logout: `${ISSUER}/logout`,
};

const KEY = { access: 'agricap_at', refresh: 'agricap_rt', verifier: 'agricap_pkce', state: 'agricap_state', nonce: 'agricap_nonce' };

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function random(n = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)).buffer);
}
async function sha256(str: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
}

export const tokens = {
  get access(): string | null { return sessionStorage.getItem(KEY.access); },
  get refresh(): string | null { return sessionStorage.getItem(KEY.refresh); },
  set(data: TokenResponse): void {
    if (data.access_token) sessionStorage.setItem(KEY.access, data.access_token);
    if (data.refresh_token) sessionStorage.setItem(KEY.refresh, data.refresh_token);
  },
  clear(): void { Object.values(KEY).forEach((k) => sessionStorage.removeItem(k)); },
};

async function redirectToAuthorize(extra: Record<string, string> = {}): Promise<void> {
  const verifier = random(48);
  const state = random(16);
  const nonce = random(16);              // exigé par l'IdP (anti-rejeu de l'id_token)
  sessionStorage.setItem(KEY.verifier, verifier);
  sessionStorage.setItem(KEY.state, state);
  sessionStorage.setItem(KEY.nonce, nonce);
  const challenge = await sha256(verifier);
  const params = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    scope: SCOPE, state, nonce, code_challenge: challenge, code_challenge_method: 'S256', ...extra,
  });
  window.location.assign(`${EP.authorize}?${params.toString()}`);
}

/** Connexion (l'écran IdP propose aussi la création de compte). */
export function beginLogin(): Promise<void> {
  return redirectToAuthorize();
}

/** Inscription : ouvre le flux IdP en suggérant l'écran de création de compte. */
export function beginRegister(): Promise<void> {
  return redirectToAuthorize({ prompt: 'create', screen: 'register' });
}

/** Callback : échange le code contre les jetons (PKCE). */
export async function handleCallback(): Promise<TokenResponse> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (error) throw new Error(url.searchParams.get('error_description') || error);
  if (!code) throw new Error('Code d’autorisation absent.');
  if (state !== sessionStorage.getItem(KEY.state)) throw new Error('State invalide (anti-CSRF).');

  const verifier = sessionStorage.getItem(KEY.verifier) || '';
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID, code_verifier: verifier,
  });
  const res = await fetch(EP.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) throw new Error('Échec de l’échange du code contre un jeton.');
  const data: TokenResponse = await res.json();
  tokens.set(data);
  sessionStorage.removeItem(KEY.verifier);
  sessionStorage.removeItem(KEY.state);
  return data;
}

export async function refresh(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return false;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID });
  const res = await fetch(EP.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) { tokens.clear(); return false; }
  tokens.set(await res.json());
  return true;
}

export function logout(): void {
  tokens.clear();
  const params = new URLSearchParams({ client_id: CLIENT_ID, post_logout_redirect_uri: window.location.origin });
  window.location.assign(`${EP.logout}?${params.toString()}`);
}
