import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS, expectedToken, publicDemoEnabled, sessionRole } from "@/lib/auth";

// GET /try: the public demo link (e.g. for a résumé). Logs the visitor in as a guest, no
// passcode needed, and opens the demo. Guests can't spend API credits. Only works while
// APP_PUBLIC_DEMO=on; otherwise it just shows the login page.
export async function GET(request: NextRequest) {
  const home = new URL("/", request.url);

  // Already logged in (as the owner or a guest): never replace that login.
  if (await sessionRole(request.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.redirect(home);
  }
  if (!publicDemoEnabled()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.redirect(home);
  response.cookies.set(AUTH_COOKIE, (await expectedToken("guest"))!, AUTH_COOKIE_OPTIONS);
  return response;
}
