/**
 * Possible preview strategies for an attachment.
 *
 * - `iframe-binary` — file can be loaded directly into an `<iframe>` via the
 *   server-side proxy route (PDFs, images, text).
 * - `iframe-html` — file needs server-side conversion to HTML first
 *   (DOCX via mammoth, CSV rendered as a table) and is loaded into an
 *   `<iframe>` via the `preview-html` route.
 * - `unsupported` — no inline preview available; surface a fallback UI
 *   (typically a download link).
 */
export type PreviewKind = 'iframe-binary' | 'iframe-html' | 'unsupported'

const BINARY_PREVIEWABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt'])
const HTML_PREVIEWABLE = new Set(['docx', 'csv'])

function extractExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
}

/**
 * Classify a filename into a preview strategy. The modal should switch on the
 * return value to decide which iframe `src` to use (proxy vs preview-html) or
 * whether to render a download-only fallback.
 */
export function previewKind(filename: string): PreviewKind {
  const ext = extractExt(filename)
  if (BINARY_PREVIEWABLE.has(ext)) return 'iframe-binary'
  if (HTML_PREVIEWABLE.has(ext)) return 'iframe-html'
  return 'unsupported'
}

/**
 * Returns true for file types the browser can render inline inside an iframe.
 * DOCX, XLSX, PPTX, DOC, XLS etc. cannot be displayed — show a fallback instead.
 *
 * @deprecated use {@link previewKind} instead — it distinguishes between
 * formats the browser renders natively (`iframe-binary`) and formats we
 * convert to HTML server-side first (`iframe-html`).
 */
export function isPreviewable(filename: string): boolean {
  const ext = extractExt(filename)
  return BINARY_PREVIEWABLE.has(ext)
}
