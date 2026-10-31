import { describe, expect, it } from "vitest";
import { gateDecision } from "./gate";

const allow = { action: "allow" };
const to = (path: string) => ({ action: "redirect", to: path });

describe("gateDecision", () => {
  it("logged-out visitors to the home page get the demo when the public demo is on", () => {
    expect(gateDecision("/", null, true)).toEqual(to("/try"));
  });

  it("…and the login page when it's off", () => {
    expect(gateDecision("/", null, false)).toEqual(to("/login"));
  });

  it("other pages always need a login, even with the public demo on", () => {
    expect(gateDecision("/anything", null, true)).toEqual(to("/login"));
  });

  it("logged-out API calls get a JSON 401, never a redirect", () => {
    expect(gateDecision("/api/tts", null, true)).toEqual({ action: "unauthorized" });
    expect(gateDecision("/api/parse", null, false)).toEqual({ action: "unauthorized" });
  });

  it("/try and /login are always reachable when logged out", () => {
    expect(gateDecision("/try", null, false)).toEqual(allow);
    expect(gateDecision("/login", null, false)).toEqual(allow);
  });

  it("guests can still open /login, so the owner can sign in on a demo device", () => {
    expect(gateDecision("/login", "guest", true)).toEqual(allow);
  });

  it("the owner is sent home from /login", () => {
    expect(gateDecision("/login", "owner", true)).toEqual(to("/"));
  });

  it("logged-in users (owner or guest) can open pages and API routes", () => {
    for (const role of ["owner", "guest"] as const) {
      expect(gateDecision("/", role, true)).toEqual(allow);
      expect(gateDecision("/api/tts", role, true)).toEqual(allow); // the route itself refuses guests
    }
  });
});
