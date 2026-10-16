"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-8 shadow dark:bg-zinc-900"
      >
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Enter passcode
        </h1>
        <input
          type="password"
          name="passcode"
          required
          autoFocus
          autoComplete="current-password"
          aria-label="Passcode"
          className="rounded border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-black dark:text-zinc-50"
        />
        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
        >
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
