import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, GUEST_BLOCKED_MESSAGE, sessionRole } from "@/lib/auth";
import { MAX_CHARS, MAX_PDF_BYTES, MAX_PDF_LABEL } from "@/lib/limits";
import { parseScript, type ScriptInput } from "@/lib/parse-script";
import { findUnmatchedLines } from "@/lib/script-schema";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

// POST /api/parse with either:
//   JSON      { "text": "...pasted script..." }
//   FormData  a "file" field holding a PDF
export async function POST(request: NextRequest) {
  // proxy.ts already blocks logged-out requests; checking again here keeps the
  // route safe even if the proxy's matcher is changed later.
  const role = await sessionRole(request.cookies.get(AUTH_COOKIE)?.value);
  if (!role) return fail("Not logged in.", 401);
  // Demo (guest) logins can't spend API credits.
  if (role === "guest") return fail(GUEST_BLOCKED_MESSAGE, 403);

  const isUpload = request.headers.get("content-type")?.startsWith("multipart/form-data");
  const input = isUpload ? await readPdf(request) : await readText(request);
  if (input instanceof NextResponse) return input;

  const result = await parseScript(input);
  if (!result.ok) return fail(result.error, result.status);

  // Flag any line whose text isn't in the original, so invented wording is never silently accepted.
  // The server can't read a PDF's text itself, so PDF results get a general reminder instead.
  const warnings =
    input.kind === "text"
      ? findUnmatchedLines(result.script, input.text).map(
          (i) => `Line ${i + 1} doesn't exactly match your script. Please check it.`,
        )
      : ["Parsed from a PDF, so the wording couldn't be double-checked automatically. Please proofread."];

  return NextResponse.json({ ...result.script, warnings });
}

async function readText(request: NextRequest): Promise<ScriptInput | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('Request body must be JSON like {"text": "..."}.', 400);
  }

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim() === "") {
    return fail("Paste some script text first.", 400);
  }
  if (text.length > MAX_CHARS) {
    return fail(
      `That's ${text.length.toLocaleString()} characters. The limit is ${MAX_CHARS.toLocaleString()}; try pasting one scene at a time.`,
      413,
    );
  }
  return { kind: "text", text };
}

async function readPdf(request: NextRequest): Promise<ScriptInput | NextResponse> {
  const tooBig = `That PDF is too large. The limit is ${MAX_PDF_LABEL}; try uploading just your sides.`;

  // Reject oversized uploads before reading them (the header is the browser's own size claim).
  if (Number(request.headers.get("content-length")) > MAX_PDF_BYTES + 64 * 1024) {
    return fail(tooBig, 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return fail("The upload couldn't be read. Please try again.", 400);
  }
  if (!(file instanceof File) || file.size === 0) {
    return fail("Choose a PDF file to upload.", 400);
  }
  if (file.size > MAX_PDF_BYTES) return fail(tooBig, 413);

  // Real PDFs always begin with "%PDF-". This catches other files renamed to .pdf.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!file.name.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return fail("Only PDF files are supported. For other formats, copy the text and paste it in.", 415);
  }
  return { kind: "pdf", bytes };
}
