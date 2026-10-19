import { cookies } from "next/headers";
import { Suspense } from "react";
import { AUTH_COOKIE, sessionRole } from "@/lib/auth";
import DemoWorkspace from "./demo-workspace";
import ScriptEditor from "./script-editor";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 font-sans">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Scene Partner</h1>
      {/* Reading the login cookie happens at request time, so it streams in here. */}
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Workspace />
      </Suspense>
    </main>
  );
}

// Guests (the demo passcode) get the pre-loaded demo scene; the owner gets the full editor.
async function Workspace() {
  const role = await sessionRole((await cookies()).get(AUTH_COOKIE)?.value);
  return role === "guest" ? <DemoWorkspace /> : <ScriptEditor />;
}
