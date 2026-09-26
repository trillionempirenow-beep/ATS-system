import { rawPdfText } from './pdf-raw.js';

export interface ExtractResult {
  text: string;
  error: string | null;
  quality: 'good' | 'poor';
}

export function cleanupText(t: string): string {
  return t
    .replace(/[^\P{C}\n\t]+/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface TextItem { str: string; hasEOL?: boolean; transform: number[] }

/** Rebuilds lines from pdf.js text items: a new line on EOL or a vertical jump, a space on a horizontal gap. */
async function layoutText(data: Buffer): Promise<string> {
  // Loaded on first use: the parsers are heavy and only uploads need them.
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    let lastY: number | null = null;
    let lastEnd: number | null = null;
    for (const raw of content.items as unknown[]) {
      const item = raw as TextItem & { width?: number };
      if (typeof item.str !== 'string') continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      else if (lastEnd !== null && x - lastEnd > 1.5 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
      lastEnd = x + (item.width ?? 0);
    }
    pages.push(text);
  }
  return pages.join('\n');
}

export async function extractPdfText(data: Buffer): Promise<ExtractResult> {
  if (data.subarray(0, 4).toString('latin1') !== '%PDF') {
    return { text: '', error: 'That file does not look like a PDF.', quality: 'poor' };
  }
  let text = '';
  try { text = cleanupText(await layoutText(data)); } catch { text = ''; }
  if (text.length < 40) {
    try { text = cleanupText(rawPdfText(data)); } catch { /* fall through to the error below */ }
  }
  if (text.length < 40) {
    return {
      text,
      error: 'Unable to extract text from this PDF. Please upload a text-based PDF or enter the information manually.',
      quality: 'poor',
    };
  }
  const spaces = (text.match(/[ \n]/g) ?? []).length;
  return { text, error: null, quality: spaces / Math.max(1, text.length) < 0.06 ? 'poor' : 'good' };
}

export async function extractDocxText(data: Buffer): Promise<ExtractResult> {
  try {
    const { default: mammoth } = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { text: cleanupText(value), error: null, quality: 'good' };
  } catch {
    return { text: '', error: 'That DOCX file could not be opened — it may be corrupted.', quality: 'poor' };
  }
}

export async function extractDocumentText(data: Buffer, extension: string): Promise<ExtractResult> {
  if (extension === 'pdf') return extractPdfText(data);
  if (extension === 'docx') return extractDocxText(data);
  if (extension === 'doc') {
    return {
      text: '',
      error: 'This is a legacy .doc file, which cannot be read automatically. It has been attached to the candidate — please enter the details manually, or re-save it as PDF or DOCX to auto-fill.',
      quality: 'poor',
    };
  }
  return { text: '', error: 'Unsupported file type.', quality: 'poor' };
}
