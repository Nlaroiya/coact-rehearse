// Server-only helpers for the passcode gate.
// APP_PASSCODE has no NEXT_PUBLIC_ prefix, so Next.js never sends it to the browser.

export const AUTH_COOKIE = "scene_partner_auth";

// Returns the passcode, or null if it's missing or blank.
// Callers treat null as "lock everyone out" so a missing setting fails closed.
export function getPasscode(): string | null {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode || passcode.trim() === "") return null;
  return passcode;
}

// The cookie stores a signature derived from the passcode, never the passcode itself.
// Changing APP_PASSCODE automatically invalidates every existing cookie.
export async function expectedToken(): Promise<string | null> {
  const passcode = getPasscode();
  if (!passcode) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("scene-partner-session"),
  );
  return Buffer.from(signature).toString("hex");
}

// Compares two strings without leaking, through timing, how many characters matched.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function isValidToken(token: string | undefined): Promise<boolean> {
  const expected = await expectedToken();
  if (!expected || !token) return false;
  return safeEqual(token, expected);
}
