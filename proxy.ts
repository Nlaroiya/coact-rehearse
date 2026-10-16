import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isValidToken } from "@/lib/auth";

// Next.js 16 runs this before every matching request (it replaces middleware.ts).
export async function proxy(request: NextRequest) {
  const isLoginPage = request.nextUrl.pathname === "/login";
  const loggedIn = await isValidToken(request.cookies.get(AUTH_COOKIE)?.value);

  if (!loggedIn && request.nextUrl.pathname.startsWith("/api/")) {
    // Code calling an API expects JSON, not a redirect to an HTML page.
    return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  }
  if (!loggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (loggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next.js internals and files with an extension (images, favicon, etc.)
  // so CSS/JS still load on the login page.
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
