/** Markdown body with managed-attachment rendering (D3).
 *
 *  Splitting lives in lib/attachments.ts; here a text segment still goes
 *  through the sanitizing renderer (remote <img> stays forbidden — external
 *  images are pulled out as placeholder bars, never loaded), attachment
 *  segments render via AttachmentImage which fetches bytes with the bearer
 *  token that never touches a URL.
 */

import { useEffect, useState } from "react";
import api from "../lib/api";
import { t, useT } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";
import { splitAttachmentSegments } from "../lib/attachments";

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt || t("att.lightbox.label")}
      data-testid="att-lightbox"
      onClick={onClose}
    >
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-close" data-testid="att-lightbox-close" onClick={onClose} aria-label={t("att.lightbox.close")}>
        ×
      </button>
    </div>
  );
}

function AttachmentImage({ id, alt, onZoom }: { id: string; alt: string; onZoom: (url: string) => void }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setErr(false);
    api
      .attachmentBlob(id)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        if (alive) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (alive) setErr(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (err) {
    return (
      <span className="att-missing" role="img" aria-label={t("att.error")}>
        {t("att.error")}（{id.slice(0, 8)}…）
      </span>
    );
  }
  if (!url) {
    return <span className="att-loading">{t("att.loading")}</span>;
  }
  return (
    <button type="button" className="att-img-btn" data-testid={`att-img-${id.slice(0, 8)}`} onClick={() => onZoom(url)} aria-label={t("att.zoom", { alt })}>
      <img src={url} alt={alt} loading="lazy" />
    </button>
  );
}

/** D3: the ONLY sanctioned way to render node details containing attachments
 *  (editor preview and read view share it). */
export default function MarkdownBody({ md }: { md: string }) {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const segs = splitAttachmentSegments(md);
  return (
    <div className="md-body">
      {segs.map((s, i) => {
        if (s.type === "text")
          return <div key={i} dangerouslySetInnerHTML={{ __html: renderMarkdown(s.md) }} />;
        if (s.type === "external")
          return (
            // SPEC §446 承接：外链图片一律不加载，占位条只显示 URL 文本。
            <span key={i} className="att-external" data-testid="att-external">
              {t("att.external")}
              <span className="att-external-url"> {s.url}</span>
            </span>
          );
        return <AttachmentImage key={i} id={s.id} alt={s.alt} onZoom={(url) => setZoom({ src: url, alt: s.alt })} />;
      })}
      {zoom && <Lightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </div>
  );
}
