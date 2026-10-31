// Who may open which page, as a pure function (used by proxy.ts, and easy to test).
import type { Role } from "./auth";

export type GateDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" }; // API calls get JSON, not a redirect

export function gateDecision(pathname: string, role: Role | null, publicDemo: boolean): GateDecision {
  // /try is the public demo link; it decides for itself (see app/try/route.ts).
  if (pathname === "/try") return { action: "allow" };

  if (pathname === "/login") {
    // The owner is already in. Guests may still open it, so the owner can sign in on a
    // device that has been used for the demo.
    return role === "owner" ? { action: "redirect", to: "/" } : { action: "allow" };
  }

  if (role) return { action: "allow" };

  // Logged out from here on.
  if (pathname.startsWith("/api/")) return { action: "unauthorized" };
  // With the public demo on, the home page opens the demo (e.g. from the GitHub link).
  if (pathname === "/" && publicDemo) return { action: "redirect", to: "/try" };
  return { action: "redirect", to: "/login" };
}
