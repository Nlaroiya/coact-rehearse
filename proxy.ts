import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, publicDemoEnabled, sessionRole } from "@/lib/auth";
import { gateDecision } from "@/lib/gate";

// Next.js 16 runs this before every matching request (it replaces middleware.ts).
// The rules for who may open what live in lib/gate.ts.
export async function proxy(request: NextRequest) {
  const role = await sessionRole(request.cookies.get(AUTH_COOKIE)?.value);
  const decision = gateDecision(request.nextUrl.pathname, role, publicDemoEnabled());

  if (decision.action === "unauthorized") {
    // Code calling an API expects JSON, not a redirect to an HTML page.
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  if (decision.action === "redirect") {
    const target = new URL(decision.to, request.url);
    // Opening the demo from the home page keeps options like ?debug.
    if (decision.to === "/try") target.search = request.nextUrl.search;
    return NextResponse.redirect(target);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next.js internals and files with an extension (images, favicon, etc.)
  // so CSS/JS still load on the login page.
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
