"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, expectedToken, getPasscode, roleForPasscode } from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!getPasscode()) {
    // Shown only in the server terminal, so visitors don't learn about the misconfiguration.
    console.error("APP_PASSCODE is not set (or is blank). Everyone is locked out.");
    return { error: "Login is unavailable right now." };
  }

  // The owner passcode, or the guest passcode for demo mode.
  const role = roleForPasscode(String(formData.get("passcode") ?? ""));
  if (!role) {
    return { error: "Incorrect passcode." };
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, (await expectedToken(role))!, {
    httpOnly: true, // JavaScript in the browser can't read it
    secure: process.env.NODE_ENV === "production", // HTTPS-only once deployed
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect("/");
}
