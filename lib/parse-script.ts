// Server-only: calls Gemini to turn pasted script text into structured lines.
// GEMINI_API_KEY has no NEXT_PUBLIC_ prefix, so it never reaches the browser.
import { GoogleGenAI } from "@google/genai";
import { scriptJsonSchema, validateScript, type Script } from "./script-schema";

const MODEL = "gemini-3.5-flash-lite";

const INSTRUCTIONS = `You convert pasted screenplay or stage-play text into structured JSON.

Rules:
- Each spoken speech becomes one "dialogue" line. Every other piece of story text (scene headings, action, stage directions, transitions) becomes a "direction" line with speaker null.
- Speaker names: use one canonical UPPERCASE name per character. Strip extensions and suffixes like (CONT'D), (CONT’D), (V.O.), (O.S.), (O.C.) and (OFF), so JOHN, JOHN (CONT'D) and JOHN (V.O.) are all JOHN.
- "characters" lists each canonical speaker name once, in order of first appearance. Only include characters who speak.
- Parentheticals (e.g. "(quieter)") go in "parenthetical" without the surrounding parentheses, never inside "text". Use null when there is none.
- Copy all text exactly as written, word for word. Never invent, summarize, correct, or reword anything. Joining a sentence that was wrapped across several lines into one line is fine.
- Ignore page numbers, scene numbers, "CONTINUED", "(MORE)", "CONTINUED:", headers, footers, revision marks and watermarks.
- Keep the original order.`;

export type ParseOutcome =
  | { ok: true; script: Script }
  | { ok: false; status: number; error: string };

export type ScriptInput = { kind: "text"; text: string } | { kind: "pdf"; bytes: Buffer };

export async function parseScript(source: ScriptInput): Promise<ParseOutcome> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set.");
    return { ok: false, status: 500, error: "Script parsing isn't set up on the server yet." };
  }

  const client = new GoogleGenAI({ apiKey });

  let outputText: string | undefined;
  try {
    const interaction = await client.interactions.create({
      model: MODEL,
      system_instruction: INSTRUCTIONS,
      input:
        source.kind === "text"
          ? source.text
          : [
              { type: "text", text: "Convert the script in this PDF." },
              // Gemini receives the PDF itself, encoded as base64 text.
              { type: "document", mime_type: "application/pdf", data: source.bytes.toString("base64") },
            ],
      response_format: { type: "text", mime_type: "application/json", schema: scriptJsonSchema },
      generation_config: { temperature: 0 },
      store: false, // don't keep a copy of the script on Google's side
    });
    outputText = interaction.output_text;
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    console.error("Gemini request failed:", err);
    if (status === 429) {
      return {
        ok: false,
        status: 429,
        error: "Gemini's free-tier limit was reached. Wait a minute and try again.",
      };
    }
    if (status === 400 && source.kind === "pdf") {
      return {
        ok: false,
        status: 422,
        error: "Gemini couldn't read that PDF. If it's password-protected or damaged, try copying the text in instead.",
      };
    }
    return { ok: false, status: 502, error: "Couldn't reach Gemini. Please try again." };
  }

  let json: unknown;
  try {
    json = JSON.parse(outputText ?? "");
  } catch {
    console.error("Gemini returned non-JSON output:", outputText);
    return { ok: false, status: 502, error: "Gemini returned an unreadable reply. Please try again." };
  }

  const result = validateScript(json);
  if (!result.ok) {
    console.error("Gemini reply failed validation:\n" + result.error);
    return {
      ok: false,
      status: 502,
      error: "Gemini's reply didn't match the expected format. Please try again.",
    };
  }
  return { ok: true, script: result.script };
}
