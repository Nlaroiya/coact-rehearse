// The shape of a parsed script, shared by the server (to check Gemini's reply)
// and the browser (to type the editor). Contains no secrets.
import { z } from "zod";

export const LineSchema = z.object({
  type: z.enum(["dialogue", "direction"]),
  speaker: z.string().min(1).nullable(),
  parenthetical: z.string().nullable(),
  text: z.string().min(1),
});

export const ScriptSchema = z.object({
  characters: z.array(z.string().min(1)),
  lines: z.array(LineSchema),
});

// Rules that a JSON schema can't express, so zod checks them after the basic shape.
const CheckedScriptSchema = ScriptSchema.superRefine((script, ctx) => {
  script.lines.forEach((line, i) => {
    if (line.type === "dialogue" && line.speaker === null) {
      ctx.addIssue({ code: "custom", path: ["lines", i, "speaker"], message: "Dialogue needs a speaker" });
    }
    if (line.type === "direction" && line.speaker !== null) {
      ctx.addIssue({ code: "custom", path: ["lines", i, "speaker"], message: "Directions must have no speaker" });
    }
    if (line.speaker !== null && !script.characters.includes(line.speaker)) {
      ctx.addIssue({
        code: "custom",
        path: ["lines", i, "speaker"],
        message: `Speaker "${line.speaker}" is not in the character list`,
      });
    }
  });
});

export type Line = z.infer<typeof LineSchema>;
export type Script = z.infer<typeof ScriptSchema>;

// The JSON schema sent to Gemini, generated from the zod schema above.
export const scriptJsonSchema = z.toJSONSchema(ScriptSchema);

export type ValidationResult =
  | { ok: true; script: Script }
  | { ok: false; error: string };

// Checks an unknown value (e.g. Gemini's parsed JSON) and explains what's wrong if invalid.
export function validateScript(raw: unknown): ValidationResult {
  const result = CheckedScriptSchema.safeParse(raw);
  if (result.success) return { ok: true, script: result.data };
  return { ok: false, error: z.prettifyError(result.error) };
}

// Squashes spacing, line breaks and curly quotes so wrapped lines still match the original.
function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Returns the index of every line whose text doesn't appear in the pasted script,
// a sign that the model invented or reworded something.
export function findUnmatchedLines(script: Script, source: string): number[] {
  const haystack = normalize(source);
  return script.lines.flatMap((line, i) =>
    haystack.includes(normalize(line.text)) ? [] : [i],
  );
}
