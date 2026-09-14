/** Managed-attachment reference syntax (D 批 §9.2/§9.3).
 *
 *  Attachments live in Markdown as `![alt](attachment:<uuid>)` — plain source
 *  that survives clipboard copy, export and search. Rendering splits the text
 *  into segments: ordinary Markdown goes through the sanitizer untouched
 *  (remote <img> stays forbidden), attachment segments are rendered by the
 *  AttachmentImage component which fetches bytes with the bearer token that
 *  NEVER appears in an <img> URL.
 */

export type AttachmentSegment =
  | { type: "text"; md: string }
  | { type: "attachment"; id: string; alt: string }
  | { type: "external"; alt: string; url: string };

const ATTACHMENT_IMG = /!\[([^\]]*)\]\(attachment:([0-9a-fA-F-]{36})\)/g;
const EXTERNAL_IMG = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

type Matched =
  | { start: number; end: number; seg: Extract<AttachmentSegment, { type: "attachment" | "external" }> };

/** Split raw Markdown into text / managed-attachment / external-image
 *  segments, preserving order and all non-image source text verbatim. */
export function splitAttachmentSegments(md: string): AttachmentSegment[] {
  const matches: Matched[] = [];
  for (const m of md.matchAll(ATTACHMENT_IMG)) {
    matches.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      seg: { type: "attachment", id: m[2], alt: m[1] ?? "" },
    });
  }
  for (const m of md.matchAll(EXTERNAL_IMG)) {
    matches.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      seg: { type: "external", url: m[2], alt: m[1] ?? "" },
    });
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: AttachmentSegment[] = [];
  let pos = 0;
  for (const { start, end, seg } of matches) {
    if (start < pos) continue; // overlapping/contained — first match wins
    if (start > pos) out.push({ type: "text", md: md.slice(pos, start) });
    out.push(seg);
    pos = end;
  }
  if (pos < md.length) out.push({ type: "text", md: md.slice(pos) });
  return out;
}

/** Insert a managed-attachment reference at the end of the body (D3 editor
 *  insertion point: uploads are appended, never inline-surgically placed). */
export function appendAttachmentRef(md: string, id: string, name: string): string {
  const alt = name.replace(/[[\]]/g, "").slice(0, 80) || "图片";
  const base = md && !md.endsWith("\n") ? md + "\n" : md ?? "";
  return `${base}![${alt}](attachment:${id})\n`;
}
