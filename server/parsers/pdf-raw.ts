import { inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Fallback reader for PDFs whose structure pdf.js rejects (broken xref tables,
 * hand-written files). Like the PHP reader it replaces, it walks every content
 * stream and rebuilds text from the text-showing operators. It does not map
 * custom font encodings, so it is only used when the main path fails.
 */
export function rawPdfText(data: Buffer): string {
  const src = data.toString('latin1');
  const out: string[] = [];
  const streamRe = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    const dict = m[1] ?? '';
    if (/\/Type\s*\/(XRef|ObjStm|XObject|FontDescriptor)/.test(dict) || /\/Subtype\s*\/Image/.test(dict)) continue;
    let bytes = data.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try { bytes = inflateSync(bytes); } catch {
        try { bytes = inflateRawSync(bytes); } catch { continue; }
      }
    }
    const content = bytes.toString('latin1');
    if (!/\bBT\b/.test(content)) continue;
    out.push(textFromContent(content));
  }
  return out.join('\n');
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_all, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[c] ?? '';
  });
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let s = '';
  // Two-byte hex strings are usually UTF-16BE when they start with a BOM.
  if (clean.startsWith('FEFF') || clean.startsWith('feff')) {
    for (let i = 4; i + 3 < clean.length; i += 4) s += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    return s;
  }
  for (let i = 0; i + 1 < clean.length; i += 2) s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return s;
}

function textFromContent(c: string): string {
  let text = '';
  let line = '';
  const flush = () => { text += `${line}\n`; line = ''; };
  const re = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s/[\]()<>]+|[A-Za-z'"*]+/g;
  const operands: string[] = [];
  let inArray = false;
  let arrayText = '';
  let tok: RegExpExecArray | null;
  while ((tok = re.exec(c))) {
    const t = tok[0];
    if (t.startsWith('(')) {
      const s = unescapeLiteral(t.slice(1, -1));
      if (inArray) arrayText += s; else operands.push(s);
    } else if (t.startsWith('<')) {
      const s = decodeHex(t.slice(1, -1));
      if (inArray) arrayText += s; else operands.push(s);
    } else if (t === '[') { inArray = true; arrayText = ''; }
    else if (t === ']') { inArray = false; operands.push(arrayText); }
    else if (/^-?\d*\.?\d+$/.test(t)) {
      if (inArray && Number(t) < -200) arrayText += ' ';
      else if (!inArray) operands.push(t);
    } else if (t.startsWith('/')) { operands.push(t); }
    else {
      switch (t) {
        case 'Tj': case 'TJ': line += operands.pop() ?? ''; break;
        case "'": case '"': flush(); line += operands.pop() ?? ''; break;
        case 'T*': case 'ET': flush(); break;
        case 'Td': case 'TD': {
          const ty = Number(operands[operands.length - 1] ?? 0);
          if (ty !== 0) flush(); else if (line && !line.endsWith(' ')) line += ' ';
          break;
        }
        case 'Tm': flush(); break;
        default: break;
      }
      operands.length = 0;
    }
  }
  if (line) flush();
  return text;
}
