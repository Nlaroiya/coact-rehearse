"use client";

import { useState, useSyncExternalStore } from "react";
import { DEMO_SCRIPT } from "@/lib/demo";
import Rehearsal from "./rehearsal";

// Demo mode: the study-room scene, already parsed, with pre-generated voices. Nothing here
// calls the paid APIs; recordings stay in the guest's browser.
const noSubscribe = () => () => {};
export default function DemoWorkspace() {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [rehearsing, setRehearsing] = useState(false);
  if (!inBrowser) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div data-testid="demo-banner" className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <p className="font-medium">Demo mode</p>
        <p className="mt-1">
          This short scene, &ldquo;Study Room&rdquo;, is already loaded with AI voices. Pick your role, press{" "}
          <strong>Start</strong>, and read your lines out loud: the AI reads the other part and moves on when you
          finish (or press Space). Recordings stay on your device.
        </p>
      </div>

      <section>
        <h2 className="mb-2 font-medium">Characters</h2>
        <div className="flex flex-wrap gap-2">
          {DEMO_SCRIPT.characters.map((name) => (
            <span key={name} className="rounded-full bg-zinc-200 px-3 py-1 text-sm dark:bg-zinc-800">
              {name}
            </span>
          ))}
        </div>
      </section>

      <Rehearsal script={DEMO_SCRIPT} pdfName={null} demo onRehearsingChange={setRehearsing} />

      {/* The scene, read-only (hidden while rehearsing, which shows its own copy). */}
      <section className={`flex flex-col gap-2 ${rehearsing ? "hidden" : ""}`}>
        <h2 className="font-medium">The scene</h2>
        <ol className="flex flex-col gap-2" data-testid="demo-scene">
          {DEMO_SCRIPT.lines.map((line, i) => (
            <li key={i} className={`rounded p-2 ${line.type === "direction" ? "italic text-zinc-500" : ""}`}>
              {line.type === "dialogue" && (
                <div className="text-sm font-semibold">
                  {line.speaker}
                  {line.parenthetical && <span className="font-normal italic"> ({line.parenthetical})</span>}
                </div>
              )}
              {line.text}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
