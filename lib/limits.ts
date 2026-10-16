// Input limits shared by the browser (to warn early) and the server (to enforce).
export const MAX_CHARS = 20_000;

// Vercel accepts about 4.5MB per request; 3MB leaves room for the upload's overhead.
export const MAX_PDF_BYTES = 3 * 1024 * 1024;
export const MAX_PDF_LABEL = "3MB";
