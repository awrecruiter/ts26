/**
 * Returns true for file types the browser can render inline inside an iframe.
 * DOCX, XLSX, PPTX, DOC, XLS etc. cannot be displayed — show a fallback instead.
 */
export function isPreviewable(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase().split('?')[0] ?? ''
  const PREVIEWABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt'])
  return PREVIEWABLE.has(ext)
}
