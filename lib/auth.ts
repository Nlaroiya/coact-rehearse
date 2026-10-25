// Server-only helpers for the passcode gate.
// The passcodes have no NEXT_PUBLIC_ prefix, so Next.js never sends them to the browser.
//
// Two kinds of login:
//  - owner: APP_PASSCODE. Everything works.
//  - guest: APP_GUEST_PASSCODE (optional). Demo mode: a pre-loaded scene, and nothing that
//    spends API credits (no parsing, no new voice audio).
// If APP_PASSCODE is missing, everyone is locked out, guests included.

export const AUTH_COOKIE = "coact_rehearse_auth";

export type Role = "owner" | "guest";

const present = (value: string | undefined) => (value && value.trim() !== "" ? value : null);

// Returns the passcode, or null if it's missing or blank.
// Callers treat null as "lock everyone out" so a missing setting fails closed.
export function getPasscode(): string | null {
  return present(process.env.APP_PASSCODE);
}

// The guest passcode, or null if demo mode is off (not set, or the owner passcode is missing).
export function getGuestPasscode(): string | null {
  const guest = present(process.env.APP_GUEST_PASSCODE);
  const owner = getPasscode();
  if (!guest || !owner || guest === owner) return null;
  return guest;
}

// The cookie stores a signature derived from the passcode, never the passcode itself.
// Changing a passcode automatically invalidates every cookie made with it.
async function sign(passcode: string, label: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(label));
  return Buffer.from(signature).toString("hex");
}

export async function expectedToken(role: Role = "owner"): Promise<string | null> {
  const passcode = role === "owner" ? getPasscode() : getGuestPasscode();
  if (!passcode) return null;
  return sign(passcode, role === "owner" ? "coact-rehearse-session" : "coact-rehearse-guest");
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

// Which login a cookie belongs to, or null if it's missing or invalid.
export async function sessionRole(token: string | undefined): Promise<Role | null> {
  if (!token || !getPasscode()) return null;
  for (const role of ["owner", "guest"] as const) {
    const expected = await expectedToken(role);
    if (expected && safeEqual(token, expected)) return role;
  }
  return null;
}

// Logged in at all (owner or guest).
export async function isValidToken(token: string | undefined): Promise<boolean> {
  return (await sessionRole(token)) !== null;
}

// Which login a typed passcode matches, if any.
export function roleForPasscode(attempt: string): Role | null {
  const owner = getPasscode();
  if (!owner) return null;
  if (safeEqual(attempt, owner)) return "owner";
  const guest = getGuestPasscode();
  if (guest && safeEqual(attempt, guest)) return "guest";
  return null;
}

export const GUEST_BLOCKED_MESSAGE =
  "Demo mode uses a pre-loaded scene, so new scripts and new voice audio aren't available.";
