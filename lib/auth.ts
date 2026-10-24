// Password protection, active only when PORTAL_PASSWORD is set (e.g. on Vercel).
// Runs in middleware (edge runtime), so it uses Web Crypto rather than Node's crypto.

export const SESSION_COOKIE = "lpc_session";

export function portalPassword() {
  return process.env.PORTAL_PASSWORD || "";
}

// What the extension must send as X-Ingest-Token: a dedicated token, or the portal password
export function ingestToken() {
  return process.env.INGEST_TOKEN || portalPassword();
}

// Cookie value proving the password was entered (changes if the password changes)
export async function sessionValue(password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lpc-session:${password}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
