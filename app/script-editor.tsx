"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MAX_CHARS, MAX_PDF_BYTES, MAX_PDF_LABEL } from "@/lib/limits";
import { ScriptSchema, type Line, type Script } from "@/lib/script-schema";
import Rehearsal from "./rehearsal";

const STORAGE_KEY = "scene-partner:editor";

const formatMB = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;

type Saved = { source: string; script: Script | null; warnings: string[] };
const EMPTY: Saved = { source: "", script: null, warnings: [] };

// Reads the saved editor state, ignoring anything missing or corrupted.
function loadSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const script = ScriptSchema.safeParse(raw?.script);
    return {
      source: typeof raw?.source === "string" ? raw.source : "",
      script: script.success ? script.data : null,
      warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    };
  } catch {
    return EMPTY;
  }
}

// localStorage only exists in the browser, not on the server that first renders the page.
// This wrapper waits until it's running in the browser before showing the editor.
const noSubscribe = () => () => {};
export default function ScriptEditor() {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!inBrowser) return <p className="text-zinc-500">Loading…</p>;
  return <Editor />;
}

function Editor() {
  const [state, setState] = useState<Saved>(loadSaved);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rehearsing, setRehearsing] = useState(false);
  // The chosen PDF lives only in memory; files can't be saved to localStorage.
  const [pdf, setPdf] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { source, script, warnings } = state;

  // Save after every change so a refresh keeps your work.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be full or blocked (e.g. private browsing); the editor still works.
    }
  }, [state]);

  async function handleParse() {
    setParsing(true);
    setError(null);
    try {
      let res: Response;
      if (pdf) {
        // FormData sends the file as raw bytes; the browser sets the Content-Type itself.
        const form = new FormData();
        form.append("file", pdf);
        res = await fetch("/api/parse", { method: "POST", body: form });
      } else {
        res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: source }),
        });
      }
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setError("Your login has expired. Refresh the page to log in again.");
      } else if (!res.ok || !data) {
        setError(data?.error ?? "Something went wrong. Please try again.");
      } else {
        const { warnings = [], ...rest } = data;
        setState({ source, script: rest, warnings });
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setParsing(false);
    }
  }

  // Checks the file right away so the user doesn't wait for an upload that will be rejected.
  // The server checks again, since browser checks can be bypassed.
  function choosePdf(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError(`"${file.name}" isn't a PDF. Choose a .pdf file, or copy the text and paste it in.`);
    } else if (file.size > MAX_PDF_BYTES) {
      setError(`"${file.name}" is ${formatMB(file.size)}. The limit is ${MAX_PDF_LABEL}; try uploading just your sides.`);
    } else {
      setPdf(file);
      return;
    }
    clearPdf();
  }

  function clearPdf() {
    setPdf(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function updateLine(index: number, changes: Partial<Line>) {
    if (!script) return;
    const lines = script.lines.map((line, i) => (i === index ? { ...line, ...changes } : line));
    setState({ ...state, script: { ...script, lines } });
  }

  function deleteLine(index: number) {
    if (!script) return;
    const lines = script.lines.filter((_, i) => i !== index);
    setState({ ...state, script: { ...script, lines } });
  }

  // Switching type keeps the data valid: dialogue needs a speaker, directions have none.
  function changeType(index: number, type: Line["type"]) {
    if (type === "direction") {
      updateLine(index, { type, speaker: null, parenthetical: null });
    } else {
      updateLine(index, { type, speaker: script?.characters[0] ?? null });
    }
  }

  function startOver() {
    if (!window.confirm("Clear the script and all your edits?")) return;
    setState(EMPTY);
    setError(null);
    clearPdf();
  }

  const tooLong = source.length > MAX_CHARS;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label htmlFor="source" className="font-medium">
          Paste your sides
        </label>
        <textarea
          id="source"
          value={source}
          onChange={(e) => setState({ ...state, source: e.target.value })}
          rows={10}
          disabled={pdf !== null}
          placeholder="INT. COFFEE SHOP - DAY..."
          className="rounded border border-zinc-300 p-3 font-mono text-sm disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="pdf" className="text-zinc-600 dark:text-zinc-400">
            Or upload a PDF (up to {MAX_PDF_LABEL}):
          </label>
          <input
            id="pdf"
            ref={fileInput}
            type="file"
            accept=".pdf,application/pdf"
            disabled={parsing}
            onChange={(e) => choosePdf(e.target.files?.[0])}
            className="text-sm file:mr-2 file:rounded file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1 dark:file:border-zinc-700"
          />
          {pdf && (
            <button onClick={clearPdf} disabled={parsing} className="text-red-600 disabled:opacity-50">
              Remove PDF
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleParse}
            disabled={parsing || (pdf === null && (source.trim() === "" || tooLong))}
            className="rounded bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            {parsing ? "Parsing..." : pdf ? "Parse PDF" : "Parse"}
          </button>
          <button
            onClick={startOver}
            disabled={parsing}
            className="rounded border border-zinc-300 px-4 py-2 disabled:opacity-50 dark:border-zinc-700"
          >
            Start over
          </button>
          <span className={`ml-auto text-sm ${tooLong && !pdf ? "text-red-600" : "text-zinc-500"}`}>
            {pdf
              ? `${pdf.name} (${formatMB(pdf.size)})`
              : `${source.length.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`}
          </span>
        </div>
        {error && (
          <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="rounded bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {script && (
        <>
          <section>
            <h2 className="mb-2 font-medium">Characters</h2>
            <div className="flex flex-wrap gap-2">
              {script.characters.map((name) => (
                <span key={name} className="rounded-full bg-zinc-200 px-3 py-1 text-sm dark:bg-zinc-800">
                  {name}
                </span>
              ))}
            </div>
          </section>

          <Rehearsal script={script} onRehearsingChange={setRehearsing} />

          {/* Hidden while rehearsing, so lines can't change mid-scene. */}
          <section className={`flex flex-col gap-3 ${rehearsing ? "hidden" : ""}`}>
            <h2 className="font-medium">Lines ({script.lines.length})</h2>
            {script.lines.map((line, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-6 text-zinc-400">{i + 1}</span>
                  <select
                    aria-label="Line type"
                    value={line.type}
                    onChange={(e) => changeType(i, e.target.value as Line["type"])}
                    className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="dialogue">Dialogue</option>
                    <option value="direction">Direction</option>
                  </select>
                  {line.type === "dialogue" && (
                    <>
                      <select
                        aria-label="Speaker"
                        value={line.speaker ?? ""}
                        onChange={(e) => updateLine(i, { speaker: e.target.value })}
                        className="rounded border border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        {script.characters.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Parenthetical"
                        value={line.parenthetical ?? ""}
                        onChange={(e) => updateLine(i, { parenthetical: e.target.value || null })}
                        placeholder="(parenthetical)"
                        className="w-40 rounded border border-zinc-300 px-2 py-1 italic dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </>
                  )}
                  <button
                    onClick={() => deleteLine(i)}
                    className="ml-auto rounded px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    Delete
                  </button>
                </div>
                <textarea
                  aria-label="Line text"
                  value={line.text}
                  onChange={(e) => updateLine(i, { text: e.target.value })}
                  rows={1}
                  className={`field-sizing-content rounded border border-transparent p-1 hover:border-zinc-300 dark:hover:border-zinc-700 ${
                    line.type === "direction" ? "italic text-zinc-500" : ""
                  }`}
                />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
