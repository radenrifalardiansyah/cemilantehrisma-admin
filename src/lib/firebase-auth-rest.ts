import jwt from 'jsonwebtoken';

// Firebase Auth via plain REST calls to identitytoolkit.googleapis.com — deliberately NOT
// firebase-admin/auth. That module pulls in jwks-rsa -> jose (ESM) and has already broken
// production once on this exact Next.js/Turbopack setup (see git history: "Fix production 500
// on login caused by firebase-admin/auth bundling" / "Actually fix the login 500 by dropping
// firebase-admin/auth entirely"). REST calls to identitytoolkit.googleapis.com are a completely
// separate Google API from Firestore — none of this counts against the Firestore daily quota,
// which is the whole point: login stays up even when Firestore itself is fully exhausted.

interface ServiceAccount { client_email: string; private_key: string; project_id: string }

function getServiceAccount(): ServiceAccount {
  return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}') as ServiceAccount;
}

function apiKey(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '';
}

// OAuth2 access tokens last 1h — cached per serverless instance (module-level) with a safety
// margin, so admin-only operations (set claims, create/delete/reset-password) don't mint a
// fresh token on every call. Login itself (signInWithPassword) never needs this — only the
// admin-side calls below do.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/identitytoolkit',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' },
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Gagal mendapatkan Google access token: ${JSON.stringify(data)}`);

  cachedToken = { token: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return data.access_token;
}

// Firebase Auth's email/password provider requires an email-shaped identifier. The admin panel
// only ever logs in by username (see src/app/page.tsx's login form), so this derives a stable,
// deterministic address per username — never needs a Firestore lookup to resolve.
export function deriveLoginEmail(username: string): string {
  const projectId = getServiceAccount().project_id || 'cemilantehrisma';
  return `${username}@${projectId}.local`;
}

export interface AuthClaims { role: string; username: string; mustChangePassword: boolean }

export function decodeIdTokenClaims(idToken: string): Partial<AuthClaims> & { localId?: string } {
  const [, payload] = idToken.split('.');
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AuthClaims> & { localId?: string };
  } catch {
    return {};
  }
}

type SignInResult =
  | { ok: true; idToken: string; localId: string; claims: Partial<AuthClaims> }
  | { ok: false; reason: 'not-found' | 'invalid-credentials' | 'error'; message: string };

// Direct server-to-server HTTPS call to Google's own endpoint — the idToken it returns is
// trusted without a separate signature-verification step (that's what verifyIdToken from
// firebase-admin/auth would normally do, but we deliberately avoid that module; there is no
// untrusted client in between here to defend against).
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json() as { idToken?: string; localId?: string; error?: { message?: string } };
  if (res.ok && data.idToken && data.localId) {
    return { ok: true, idToken: data.idToken, localId: data.localId, claims: decodeIdTokenClaims(data.idToken) };
  }
  const message = data.error?.message ?? 'unknown_error';
  if (message === 'EMAIL_NOT_FOUND') return { ok: false, reason: 'not-found', message };
  if (message === 'INVALID_LOGIN_CREDENTIALS' || message === 'INVALID_PASSWORD') {
    return { ok: false, reason: 'invalid-credentials', message };
  }
  return { ok: false, reason: 'error', message };
}

export async function createFirebaseAuthUser(email: string, password: string): Promise<{ localId: string } | { error: string }> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  const data = await res.json() as { localId?: string; error?: { message?: string } };
  if (res.ok && data.localId) return { localId: data.localId };
  return { error: data.error?.message ?? 'unknown_error' };
}

async function adminAccountsUpdate(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const accessToken = await getGoogleAccessToken();
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { error?: { message?: string } };
  if (res.ok) return { ok: true };
  return { ok: false, error: data.error?.message ?? 'unknown_error' };
}

export function setFirebaseAuthClaims(localId: string, claims: AuthClaims) {
  return adminAccountsUpdate({ localId, customAttributes: JSON.stringify(claims) });
}

// Admin-forced password reset — uses localId + an OAuth2 admin token, NOT the user's own
// idToken, so this works even outside of an active user session (e.g. an admin resetting a
// forgotten password for someone else).
export function adminSetPassword(localId: string, password: string, claims: AuthClaims) {
  return adminAccountsUpdate({ localId, password, customAttributes: JSON.stringify(claims) });
}

export async function deleteFirebaseAuthUser(localId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const accessToken = await getGoogleAccessToken();
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ localId }),
  });
  const data = await res.json() as { error?: { message?: string } };
  if (res.ok) return { ok: true };
  return { ok: false, error: data.error?.message ?? 'unknown_error' };
}
