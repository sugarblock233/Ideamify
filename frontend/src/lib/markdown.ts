/** Safe Markdown rendering for `details_md` (SPEC 9 security section).

- Raw HTML is never rendered as HTML: marked output is sanitized with
  DOMPurify; <script>/<iframe>/<img>/forms are forbidden outright.
- Only http/https/mailto links survive; other schemes (javascript:, data:)
  are neutralized by the URI allowlist.
- No external image or preview loading of any kind.
*/

import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: false, breaks: true });

export function renderMarkdown(md: string): string {
  if (!md.trim()) return "";
  const html = marked.parse(md, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "script", "style", "iframe", "object", "embed", "form", "input",
      "button", "select", "textarea", "img", "picture", "video", "audio",
      "source", "base", "link", "meta",
    ],
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
  });
  // New tab + no referrer for outbound links (never lose the app session).
  return clean.replace(/<a\s/gi, '<a rel="noopener noreferrer" target="_blank" ');
}

export function markdownToPlainText(md: string): string {
  if (!md) return "";
  // crude but safe plain text for clipboard copies
  return md
    .replace(/```[\s\S]*?```/g, (m) => " " + m.replace(/^```[^\n]*/gm, "").trim() + " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}