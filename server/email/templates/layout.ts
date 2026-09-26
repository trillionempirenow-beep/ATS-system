export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface Brand {
  company: string;
  appUrl: string;
  logoUrl: string | null;
  supportEmail: string | null;
}

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const C = {
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  border: '#E2E7EF',
  text: '#0E1626',
  text2: '#435068',
  text3: '#596680',
  primary: '#2563EB',
  sunken: '#F0F3F8',
};
const FONT = "Figtree, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', SFMono-Regular, Menlo, Consolas, monospace";

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'details'; rows: Array<[string, string, 'mono'?]> }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'list'; title?: string; items: string[] }
  | { kind: 'note'; text: string }
  | { kind: 'link'; label: string; href: string };

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 8px;font-size:22px;line-height:30px;font-weight:700;letter-spacing:-.01em;color:${C.text}">${esc(b.text)}</h1>`;
    case 'paragraph':
      return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${C.text2}">${esc(b.text)}</p>`;
    case 'details':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${C.sunken};border-radius:10px;border-collapse:separate">
        ${b.rows
          .map(
            ([label, value, mono], i) => `<tr>
            <td style="padding:${i === 0 ? '14px' : '8px'} 16px ${i === b.rows.length - 1 ? '14px' : '8px'};font-size:13px;line-height:18px;color:${C.text3};white-space:nowrap;vertical-align:top">${esc(label)}</td>
            <td style="padding:${i === 0 ? '14px' : '8px'} 16px ${i === b.rows.length - 1 ? '14px' : '8px'};font-size:14px;line-height:20px;font-weight:600;color:${C.text};text-align:right;${mono ? `font-family:${MONO};` : ''}">${esc(value)}</td>
          </tr>`,
          )
          .join('')}
      </table>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:${C.primary}">
        <a href="${esc(b.href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">${esc(b.label)}</a>
      </td></tr></table>`;
    case 'list':
      return `${b.title ? `<p style="margin:0 0 8px;font-size:13px;line-height:18px;font-weight:600;color:${C.text}">${esc(b.title)}</p>` : ''}
        <ul style="margin:0 0 18px;padding-left:20px;color:${C.text2};font-size:14px;line-height:22px">${b.items.map((i) => `<li style="margin:0 0 4px">${esc(i)}</li>`).join('')}</ul>`;
    case 'note':
      return `<p style="margin:0 0 12px;font-size:13px;line-height:19px;color:${C.text3}">${esc(b.text)}</p>`;
    case 'link':
      return `<p style="margin:0 0 12px;font-size:12px;line-height:18px;color:${C.text3};word-break:break-all">${esc(b.label)} <a href="${esc(b.href)}" style="color:${C.primary}">${esc(b.href)}</a></p>`;
  }
}

function blockText(b: Block): string {
  switch (b.kind) {
    case 'heading': return b.text.toUpperCase();
    case 'paragraph': case 'note': return b.text;
    case 'details': return b.rows.map(([l, v]) => `${l}: ${v}`).join('\n');
    case 'button': return `${b.label}: ${b.href}`;
    case 'list': return `${b.title ? `${b.title}\n` : ''}${b.items.map((i) => `- ${i}`).join('\n')}`;
    case 'link': return `${b.label} ${b.href}`;
  }
}

/** One responsive, table-based layout shared by every transactional email. */
export function renderEmail(brand: Brand, subject: string, preheader: string, blocks: Block[]): RenderedEmail {
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" width="32" height="32" alt="${esc(brand.company)}" style="display:block;border-radius:8px">`
    : `<div style="width:32px;height:32px;border-radius:8px;background:${C.primary};color:#fff;font:700 16px/32px ${FONT};text-align:center">${esc(brand.company.charAt(0))}</div>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<style>@media (max-width:600px){.container{width:100%!important}.pad{padding:24px 20px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px">
    <tr><td style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">${logo}</td>
      <td style="vertical-align:middle;padding-left:10px;font-size:15px;font-weight:700;color:${C.text}">${esc(brand.company)}<span style="color:${C.text3};font-weight:600">/careers</span></td>
    </tr></table></td></tr>
    <tr><td class="pad" style="background:${C.surface};border:1px solid ${C.border};border-radius:14px;padding:32px 36px">
      ${blocks.map(blockHtml).join('\n')}
    </td></tr>
    <tr><td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${C.text3}">
      Sent by ${esc(brand.company)} Recruiting. ${brand.supportEmail ? `Questions? Reply to this email or write to <a href="mailto:${esc(brand.supportEmail)}" style="color:${C.text3}">${esc(brand.supportEmail)}</a>.` : 'Questions? Reply to this email.'}
      <br><a href="${esc(brand.appUrl)}/status" style="color:${C.text3}">Check your application status</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = `${blocks.map(blockText).join('\n\n')}\n\n— ${brand.company} Recruiting`;
  return { subject, html, text };
}
