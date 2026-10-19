import { afterEach, describe, expect, it, vi } from "vitest";
import { expectedToken, getGuestPasscode, isValidToken, roleForPasscode, sessionRole } from "./auth";

// Fake passcodes for the tests only (the real ones live in .env.local and Vercel).
const OWNER = "owner-test-pass";
const GUEST = "guest-test-pass";

function setEnv(owner?: string, guest?: string) {
  vi.stubEnv("APP_PASSCODE", owner);
  vi.stubEnv("APP_GUEST_PASSCODE", guest);
}
afterEach(() => vi.unstubAllEnvs());

describe("passcodes", () => {
  it("the owner and guest passcodes each log in with their own role", () => {
    setEnv(OWNER, GUEST);
    expect(roleForPasscode(OWNER)).toBe("owner");
    expect(roleForPasscode(GUEST)).toBe("guest");
    expect(roleForPasscode("wrong")).toBeNull();
    expect(roleForPasscode("")).toBeNull();
  });

  it("guest login is off when APP_GUEST_PASSCODE isn't set (or is blank)", () => {
    setEnv(OWNER, undefined);
    expect(getGuestPasscode()).toBeNull();
    expect(roleForPasscode(GUEST)).toBeNull();
    setEnv(OWNER, "   ");
    expect(getGuestPasscode()).toBeNull();
  });

  it("if APP_PASSCODE is missing, everyone is locked out, guests included", () => {
    setEnv(undefined, GUEST);
    expect(roleForPasscode(GUEST)).toBeNull();
    expect(getGuestPasscode()).toBeNull();
  });

  it("a guest passcode identical to the owner's is ignored (it logs in as owner only)", () => {
    setEnv(OWNER, OWNER);
    expect(getGuestPasscode()).toBeNull();
    expect(roleForPasscode(OWNER)).toBe("owner");
  });
});

describe("login cookies", () => {
  it("owner and guest cookies are different, and each is recognised", async () => {
    setEnv(OWNER, GUEST);
    const owner = (await expectedToken("owner"))!;
    const guest = (await expectedToken("guest"))!;
    expect(owner).not.toBe(guest);
    expect(owner).not.toContain(OWNER); // the cookie never contains the passcode
    expect(await sessionRole(owner)).toBe("owner");
    expect(await sessionRole(guest)).toBe("guest");
    expect(await isValidToken(guest)).toBe(true);
  });

  it("rejects missing, forged and old cookies", async () => {
    setEnv(OWNER, GUEST);
    const guest = (await expectedToken("guest"))!;
    expect(await sessionRole(undefined)).toBeNull();
    expect(await sessionRole("abc")).toBeNull();
    setEnv(OWNER, "a-new-guest-passcode"); // changing the guest passcode logs old guests out
    expect(await sessionRole(guest)).toBeNull();
  });

  it("removing APP_GUEST_PASSCODE logs guests out, but not the owner", async () => {
    setEnv(OWNER, GUEST);
    const owner = (await expectedToken("owner"))!;
    const guest = (await expectedToken("guest"))!;
    setEnv(OWNER, undefined);
    expect(await sessionRole(guest)).toBeNull();
    expect(await sessionRole(owner)).toBe("owner");
  });

  it("removing APP_PASSCODE logs everyone out", async () => {
    setEnv(OWNER, GUEST);
    const owner = (await expectedToken("owner"))!;
    const guest = (await expectedToken("guest"))!;
    setEnv(undefined, GUEST);
    expect(await sessionRole(owner)).toBeNull();
    expect(await sessionRole(guest)).toBeNull();
  });
});
