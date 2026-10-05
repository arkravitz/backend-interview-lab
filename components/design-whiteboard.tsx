'use client';

/* oxlint-disable next/no-img-element -- Local blob SVGs have no remote image optimization path. */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- The labeled diagram scroll region needs keyboard access and must not count as an interview section. */

import { useEffect, useRef, useState } from 'react';
import { Download, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

let renderer: Promise<(typeof import('mermaid'))['default']> | undefined;
let serial = 0;

function loadRenderer() {
  renderer ??= import('mermaid')
    .then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'neutral',
        fontFamily: 'Arial, sans-serif',
        htmlLabels: false,
        flowchart: { useMaxWidth: false, curve: 'linear' },
      });
      return mermaid;
    })
    .catch((error: unknown) => {
      renderer = undefined;
      throw error;
    });
  return renderer;
}

/** Only bundled reference answers opt into diagram rendering. Model text
 * remains ordinary markdown. SVG is displayed as an image, never inserted
 * into the application DOM as HTML. */
export function DesignWhiteboard({ source }: { source: string }) {
  const [result, setResult] = useState<{
    url?: string;
    width?: number;
    error?: string;
  }>({});
  const [zoom, setZoom] = useState(100);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const render = async () => {
      try {
        const mermaid = await loadRenderer();
        if (cancelled) return;
        const { svg } = await mermaid.render(`whiteboard-${++serial}`, source);
        if (cancelled) return;
        const dimensions = svg.match(/\bviewBox="([^"]+)"/)?.[1].split(/\s+/);
        const width = Number(dimensions?.[2]);
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setResult({
          url,
          width: Number.isFinite(width) && width > 0 ? width : 880,
        });
      } catch {
        if (!cancelled)
          setResult({
            error:
              'The whiteboard could not render. The diagram source is available below.',
          });
      }
    };
    void render();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);

  return (
    <figure className="design-whiteboard">
      <figcaption>
        <b>Architecture whiteboard</b>
        <div className="whiteboard-controls">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom <= 75}
            onClick={() => setZoom((z) => Math.max(75, z - 25))}
          >
            <Minus size={14} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Reset zoom"
            onClick={() => {
              setZoom(100);
              frame.current?.scrollTo({ left: 0, top: 0 });
            }}
          >
            {zoom}%
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom >= 200}
            onClick={() => setZoom((z) => Math.min(200, z + 25))}
          >
            <Plus size={14} />
          </Button>
          {result.url && (
            <a
              href={result.url}
              download="architecture-whiteboard.svg"
              aria-label="Download whiteboard SVG"
            >
              <Download size={15} />
            </a>
          )}
        </div>
      </figcaption>
      {result.url ? (
        <div
          className="whiteboard-canvas"
          ref={frame}
          tabIndex={0}
          role="region"
          aria-label="Scrollable architecture diagram"
        >
          <img
            src={result.url}
            alt="Architecture whiteboard"
            style={{
              width: `${zoom}%`,
              minWidth: `${((result.width ?? 880) * 0.75 * zoom) / 100}px`,
              maxWidth: 'none',
            }}
          />
        </div>
      ) : (
        <output className={result.error ? 'diagram-error' : 'muted'}>
          {result.error ?? 'Drawing the whiteboard…'}
        </output>
      )}
      <details className="whiteboard-source">
        <summary>Diagram source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
