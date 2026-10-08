import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

import { drawingUrl, fetchDrawingObjectUrl } from "../../shared/getters";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type State =
  | { kind: "loading" }
  | { kind: "rendering" }
  | { kind: "ready" }
  | { kind: "none" }
  | { kind: "error" };

/**
 * Shows the released drawing for a part revision using PDF.js.
 * Renders only the first page on a canvas with no UI elements.
 */
export function DrawingPreview({
  partNumber,
  revision,
  hideOverlay = false,
  fullHeight = false,
}: {
  partNumber: string;
  revision: string;
  hideOverlay?: boolean;
  fullHeight?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let canceled = false;
    let doc: pdfjs.PDFDocumentProxy | null = null;
    let task: pdfjs.RenderTask | null = null;
    let objectUrl: string | null = null;
    const timeout = setTimeout(() => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setState({ kind: "error" });
    }, 30000); // 30 second timeout

    fetchDrawingObjectUrl(partNumber, revision, controller.signal)
      .then(async (url) => {
        objectUrl = url;
        if (controller.signal.aborted || canceled || !objectUrl) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          setState(objectUrl ? { kind: "rendering" } : { kind: "none" });
          return;
        }

        // Set to rendering state first so canvas gets mounted
        setState({ kind: "rendering" });

        try {
          console.log("Starting PDF load for", objectUrl);
          doc = await pdfjs.getDocument({ url: objectUrl }).promise;
          console.log("PDF loaded, getting page 1");
          if (canceled) return;

          const page = await doc.getPage(1);
          console.log("Page 1 retrieved, rendering to canvas");
          if (canceled) return;

          const canvas = canvasRef.current;
          if (!canvas) {
            console.error("Canvas ref not available, waiting for next render");
            // State is already rendering, canvas will be mounted soon
            // Just wait and don't clear the timeout yet
            return;
          }

          const dpr = window.devicePixelRatio || 1;
          const containerWidth = canvas.parentElement?.clientWidth || 600;
          const scale = containerWidth / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: scale * dpr });

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${containerWidth}px`;
          canvas.style.height = `${viewport.height / dpr}px`;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            console.error("Could not get canvas context");
            setState({ kind: "error" });
            return;
          }

          console.log("Rendering page to canvas");
          task = page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          });

          await task.promise.catch((err) => {
            console.error("Render task error:", err);
          });
          console.log("Render complete");
          setState({ kind: "ready" });
          clearTimeout(timeout);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          console.error("PDF rendering error:", err);
          if (err instanceof Error) {
            console.error("Error details:", err.message, err.stack);
          }
          setState({ kind: "error" });
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState({ kind: "error" });
      });

    return () => {
      canceled = true;
      controller.abort();
      task?.cancel();
      clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [partNumber, revision]);

  if (state.kind === "ready" || state.kind === "rendering") {
    const containerClass = fullHeight
      ? "relative flex-1 overflow-hidden flex items-center justify-center"
      : "relative h-44 rounded-xl border border-steel/30 overflow-hidden flex items-center justify-center";
    return (
      <div className={containerClass}>
        <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
        {state.kind === "rendering" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="text-xs text-paper">Rendering…</span>
          </div>
        )}
        {!hideOverlay && (
          <a
            href={drawingUrl(partNumber, revision)}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0 flex items-end justify-end p-2 bg-transparent hover:bg-ink/5 transition-colors"
          >
            <span className="text-[11px] font-semibold text-paper bg-ink/70 rounded-md px-2 py-1">
              Open drawing ↗
            </span>
          </a>
        )}
      </div>
    );
  }

  const emptyClass = fullHeight
    ? "flex-1 border border-dashed border-steel/40 bg-mist flex flex-col items-center justify-center gap-1 text-steel"
    : "h-44 rounded-xl border border-dashed border-steel/40 bg-mist flex flex-col items-center justify-center gap-1 text-steel";
  return (
    <div className={emptyClass}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
      <span className="text-xs">
        {state.kind === "loading"
          ? "Loading drawing…"
          : state.kind === "error"
            ? "Drawing unavailable"
            : "No drawing for this revision"}
      </span>
    </div>
  );
}
