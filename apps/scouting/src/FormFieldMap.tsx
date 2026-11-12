// SPDX-License-Identifier: AGPL-3.0-only
import { Button, ErrorBanner } from "@g3/ui";
import {
  type FieldDrawing,
  type FieldStroke,
  MAX_DRAWING_STROKES,
  createFieldDrawing,
  parseFieldDrawing,
} from "@g3/worker-scouting/field-drawing";
import { fieldDrawingSvg } from "@g3/worker-scouting/field-drawing-svg";
import { ArrowRight, Maximize2, Minimize2, Pencil, RotateCcw, Target, Trash2 } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { sharedFieldSvg } from "./field-drawing-view";

const COLORS = ["#ff334f", "#35d06f", "#ffd43b", "#ff66c4"];
type Point = { x: number; y: number };
type Tool = "draw" | "arrow" | "sotm";
type HistoryEntry = {
  image: ImageData;
  hasDrawing: boolean;
  strokes: FieldStroke[];
  legacy: boolean;
};

function drawingColorAt(hex: string, progress: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const normalized = Math.max(0, Math.min(1, progress));
  const channel = (shift: number) => {
    const base = (value >> shift) & 255;
    if (normalized < 0.5) return Math.round(base + (255 - base) * (0.32 * (1 - normalized * 2)));
    return Math.round(base * (1 - 0.42 * ((normalized - 0.5) * 2)));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

export function FormFieldMap({
  canvasRef,
  onDrawingChange,
  onCommit,
  initialImage,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onDrawingChange?: (hasDrawing: boolean) => void;
  /** After each finished stroke, undo or clear, with the canvas as it now is. */
  onCommit?: (canvas: HTMLCanvasElement, vector?: FieldDrawing) => void;
  /** A drawing saved earlier (a data URL of the whole canvas), drawn over the field once loaded. */
  initialImage?: string;
}) {
  const editor = useRef<HTMLDivElement | null>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<FieldStroke[]>([]);
  const legacy = useRef(false);
  const ready = useRef(false);
  const fieldText = useRef("");
  const [error, setError] = useState("");
  const committed = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<HistoryEntry[]>([]);
  const hasDrawing = useRef(false);
  const onDrawingChangeRef = useRef(onDrawingChange);
  const onCommitRef = useRef(onCommit);
  const initialImageRef = useRef(initialImage);
  const drawing = useRef(false);
  const activePointer = useRef<number | null>(null);
  const start = useRef<Point | null>(null);
  const last = useRef<Point | null>(null);
  const preview = useRef<ImageData | null>(null);
  const path = useRef<Point[]>([]);
  const [tool, setTool] = useState<Tool>("draw");
  const [color, setColor] = useState(COLORS[0]);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    onDrawingChangeRef.current = onDrawingChange;
    onCommitRef.current = onCommit;
  }, [onDrawingChange, onCommit]);

  const loadBlob = useCallback(
    (blob: Blob) => {
      const image = new Image();
      image.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (hasDrawing.current) {
          URL.revokeObjectURL(image.src);
          return;
        }
        const width = 1400;
        const sourceWidth = blob.type === "image/svg+xml" ? width : image.naturalWidth;
        const sourceHeight =
          blob.type === "image/svg+xml" ? (width * 9.0692) / 17.541 : image.naturalHeight;
        const scale = Math.min(1, width / sourceWidth);
        canvas.width = Math.round(sourceWidth * scale);
        canvas.height = Math.round(sourceHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = "#17191d";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const clean = document.createElement("canvas");
        clean.width = canvas.width;
        clean.height = canvas.height;
        clean.getContext("2d")?.drawImage(canvas, 0, 0);
        base.current = clean;
        committed.current = clean;
        history.current = [];
        hasDrawing.current = false;
        onDrawingChangeRef.current?.(false);
        URL.revokeObjectURL(image.src);
        // Restore old image drafts unchanged; new drafts contain only normalized strokes.
        const saved = initialImageRef.current;
        initialImageRef.current = undefined;
        if (!saved) {
          ready.current = true;
          return;
        }
        const restored = new Image();
        let url = saved;
        try {
          if (saved.startsWith("{")) {
            const vector = parseFieldDrawing(JSON.parse(saved));
            strokes.current = vector.strokes;
            url = URL.createObjectURL(
              new Blob([fieldDrawingSvg(vector, fieldText.current)], { type: "image/svg+xml" }),
            );
          } else legacy.current = true;
        } catch {
          setError("The saved drawing could not be restored. Reload before editing it.");
          return;
        }
        restored.onload = () => {
          const target = canvasRef.current;
          const targetContext = target?.getContext("2d");
          if (target && targetContext && !hasDrawing.current) {
            targetContext.drawImage(restored, 0, 0, target.width, target.height);
            commitCanvas(target, false);
            setHasDrawing(true);
            ready.current = true;
          }
          if (url !== saved) URL.revokeObjectURL(url);
        };
        restored.onerror = () => {
          if (url !== saved) URL.revokeObjectURL(url);
          setError("The saved drawing could not be restored. Reload before editing it.");
        };
        restored.src = url;
      };
      image.src = URL.createObjectURL(blob);
    },
    [canvasRef],
  );

  useEffect(() => {
    let active = true;
    void sharedFieldSvg()
      .then((text) => {
        if (!active) return;
        fieldText.current = text;
        loadBlob(new Blob([text], { type: "image/svg+xml" }));
      })
      .catch(() => {
        if (active) setError("The field could not be loaded. Try reloading this page.");
      });
    return () => {
      active = false;
    };
  }, [loadBlob]);
  useEffect(() => {
    document.body.classList.toggle("map-workspace-open", fullscreen);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("map-workspace-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fullscreen]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const saved = committed.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !saved || !context || drawing.current) return;
    if (canvas.width !== saved.width || canvas.height !== saved.height) {
      canvas.width = saved.width;
      canvas.height = saved.height;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(saved, 0, 0);
  });

  useEffect(() => {
    const undoKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== "z" ||
        !editor.current?.contains(document.activeElement) ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", undoKey);
    return () => window.removeEventListener("keydown", undoKey);
  }, []);

  function point(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  }
  function snapshot() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      history.current.push({
        image: context.getImageData(0, 0, canvas.width, canvas.height),
        hasDrawing: hasDrawing.current,
        strokes: strokes.current,
        legacy: legacy.current,
      });
      if (history.current.length > 20) history.current.shift();
    }
  }
  function setHasDrawing(value: boolean) {
    if (hasDrawing.current === value) return;
    hasDrawing.current = value;
    onDrawingChangeRef.current?.(value);
  }
  function commitCanvas(canvas: HTMLCanvasElement, report = true) {
    const saved = document.createElement("canvas");
    saved.width = canvas.width;
    saved.height = canvas.height;
    saved.getContext("2d")?.drawImage(canvas, 0, 0);
    committed.current = saved;
    if (report)
      onCommitRef.current?.(
        canvas,
        legacy.current
          ? undefined
          : { version: 1, field: "2026-rebuilt", strokes: strokes.current },
      );
  }
  function arrow(context: CanvasRenderingContext2D, from: Point, to: Point) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = 22;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineTo(
      to.x - head * Math.cos(angle - Math.PI / 6),
      to.y - head * Math.sin(angle - Math.PI / 6),
    );
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x - head * Math.cos(angle + Math.PI / 6),
      to.y - head * Math.sin(angle + Math.PI / 6),
    );
    context.strokeStyle = "rgba(0, 0, 0, 0.9)";
    context.lineWidth = 25;
    context.stroke();
    context.strokeStyle = "rgba(255, 255, 255, 0.98)";
    context.lineWidth = 18;
    context.stroke();
    context.strokeStyle = color;
    context.lineWidth = 10;
    context.stroke();
  }
  function cone(context: CanvasRenderingContext2D, points: Point[]) {
    if (points.length < 2) return;
    const middle = points[Math.floor(points.length / 2)];
    const hub = {
      x: context.canvas.width * (middle.x < context.canvas.width / 2 ? 0.2922 : 0.7078),
      y: context.canvas.height * 0.5,
    };
    context.save();
    context.globalAlpha = 0.22;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const item of points.slice(1)) context.lineTo(item.x, item.y);
    context.lineTo(hub.x, hub.y);
    context.closePath();
    context.fill();
    context.restore();
  }
  function finishGradient(context: CanvasRenderingContext2D, points: Point[]) {
    if (points.length < 2) return;
    const beforeStroke = history.current[history.current.length - 1];
    if (beforeStroke) context.putImageData(beforeStroke.image, 0, 0);
    const lengths = points
      .slice(1)
      .map((item, index) => Math.hypot(item.x - points[index].x, item.y - points[index].y));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!total) return;
    context.strokeStyle = "rgba(0, 0, 0, 0.9)";
    context.lineWidth = 29;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
    context.strokeStyle = "rgba(255, 255, 255, 0.98)";
    context.lineWidth = 21;
    context.stroke();
    let traveled = 0;
    context.lineWidth = 12;
    lengths.forEach((length, index) => {
      const from = points[index];
      const to = points[index + 1];
      const startProgress = traveled / total;
      traveled += length;
      const endProgress = traveled / total;
      const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
      gradient.addColorStop(0, drawingColorAt(color, startProgress));
      gradient.addColorStop(1, drawingColorAt(color, endProgress));
      context.strokeStyle = gradient;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    });
  }
  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !base.current) return;
    snapshot();
    strokes.current = [];
    legacy.current = false;
    setError("");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(base.current, 0, 0);
    setHasDrawing(false);
    commitCanvas(canvas);
  }
  function undo() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const entry = history.current.pop();
    if (canvas && context && entry) {
      context.putImageData(entry.image, 0, 0);
      strokes.current = entry.strokes;
      legacy.current = entry.legacy;
      setHasDrawing(entry.hasDrawing);
      commitCanvas(canvas);
      setError("");
    }
  }
  function finishDrawing(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (context && tool !== "arrow" && path.current.length > 1) {
      finishGradient(context, path.current);
      if (tool === "sotm") cone(context, path.current);
    }
    const points =
      tool === "arrow" && start.current && last.current
        ? [start.current, last.current]
        : path.current;
    const moved =
      points.length > 1 &&
      points.some((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) >= 0.2);
    if (moved && !legacy.current) {
      try {
        strokes.current = createFieldDrawing([
          ...strokes.current,
          {
            tool,
            color,
            ...(tool === "sotm"
              ? {
                  hub:
                    points[Math.floor(points.length / 2)].x < canvas.width / 2
                      ? ("left" as const)
                      : ("right" as const),
                }
              : {}),
            points: points.map((p) => [p.x / canvas.width, p.y / canvas.height]),
          },
        ]).strokes;
      } catch {
        const entry = history.current.pop();
        if (entry) {
          context?.putImageData(entry.image, 0, 0);
          strokes.current = entry.strokes;
          legacy.current = entry.legacy;
          setHasDrawing(entry.hasDrawing);
        }
        setError("This drawing is too complex. Undo or clear a stroke before adding more.");
      }
    }
    setHasDrawing(strokes.current.length > 0 || (legacy.current && hasDrawing.current));
    commitCanvas(canvas);
    drawing.current = false;
    start.current = null;
    last.current = null;
    preview.current = null;
    path.current = [];
  }
  function cancelDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerId !== activePointer.current) return;
    activePointer.current = null;
    const entry = history.current.pop();
    if (entry) {
      event.currentTarget.getContext("2d")?.putImageData(entry.image, 0, 0);
      strokes.current = entry.strokes;
      legacy.current = entry.legacy;
      setHasDrawing(entry.hasDrawing);
    }
    drawing.current = false;
    start.current = null;
    last.current = null;
    preview.current = null;
    path.current = [];
    commitCanvas(event.currentTarget);
  }

  return (
    <div
      ref={editor}
      className={`map-editor form-map-editor ${fullscreen ? "map-editor-fullscreen" : ""}`}
    >
      {error && <ErrorBanner message={error} />}
      <div className="map-toolbar">
        <button
          type="button"
          className="map-fullscreen-button"
          onClick={() => setFullscreen((value) => !value)}
          aria-label={fullscreen ? "Exit fullscreen map" : "Open fullscreen map"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen map"}
          aria-pressed={fullscreen}
        >
          {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          <span>{fullscreen ? "Exit fullscreen" : "Fullscreen map"}</span>
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className={`map-tool-button ${tool === "draw" ? "active" : ""}`}
          onClick={() => setTool("draw")}
          aria-label="Draw freehand"
          aria-pressed={tool === "draw"}
          title="Draw"
        >
          <Pencil size={16} /> <span>Draw</span>
        </button>
        <button
          type="button"
          className={`map-tool-button ${tool === "arrow" ? "active" : ""}`}
          onClick={() => setTool("arrow")}
          aria-label="Draw arrow"
          aria-pressed={tool === "arrow"}
          title="Arrow"
        >
          <ArrowRight size={17} /> <span>Arrow</span>
        </button>
        <button
          type="button"
          className={`map-tool-button ${tool === "sotm" ? "active" : ""}`}
          onClick={() => setTool("sotm")}
          aria-label="Draw shooting on the move path"
          title="Shooting on the move"
          aria-pressed={tool === "sotm"}
        >
          <Target size={17} /> <span>SOTM</span>
        </button>
        <div className="drawing-colors" aria-label="Brush color">
          {COLORS.map((option) => (
            <button
              type="button"
              key={option}
              className={color === option ? "selected" : ""}
              style={{ backgroundColor: option }}
              onClick={() => setColor(option)}
              aria-label={`Use ${option}`}
              aria-pressed={color === option}
            />
          ))}
        </div>
        <button
          type="button"
          className="map-undo-button"
          onClick={undo}
          aria-label="Undo drawing"
          title="Undo"
        >
          <RotateCcw size={16} /> <span>Undo</span>
        </button>
        <Button
          variant="danger"
          type="button"
          className="clear-drawings-button"
          onClick={clear}
          aria-label="Clear drawing"
          title="Clear"
        >
          <Trash2 size={16} /> <span>Clear</span>
        </Button>
      </div>
      <div className="canvas-shell has-image">
        <canvas
          ref={canvasRef}
          aria-label="Drawable field map"
          tabIndex={0}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              activePointer.current !== null ||
              !base.current ||
              !ready.current
            )
              return;
            if (!legacy.current && strokes.current.length >= MAX_DRAWING_STROKES) {
              setError("Undo or clear a stroke before adding more.");
              return;
            }
            setError("");
            event.currentTarget.focus({ preventScroll: true });
            activePointer.current = event.pointerId;
            snapshot();
            drawing.current = true;
            start.current = point(event);
            last.current = start.current;
            path.current = [start.current];
            preview.current =
              event.currentTarget
                .getContext("2d")
                ?.getImageData(0, 0, event.currentTarget.width, event.currentTarget.height) ?? null;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.pointerId !== activePointer.current || !drawing.current || !last.current)
              return;
            const next = point(event);
            const context = event.currentTarget.getContext("2d");
            if (!context) return;
            if (tool === "arrow" && start.current && preview.current) {
              context.putImageData(preview.current, 0, 0);
              arrow(context, start.current, next);
            } else {
              context.strokeStyle = color;
              context.lineWidth = 8;
              context.lineCap = "round";
              context.lineJoin = "round";
              context.beginPath();
              context.moveTo(last.current.x, last.current.y);
              context.lineTo(next.x, next.y);
              context.stroke();
              path.current.push(next);
            }
            setHasDrawing(true);
            last.current = next;
          }}
          onPointerUp={(event) => {
            if (event.pointerId !== activePointer.current) return;
            activePointer.current = null;
            finishDrawing(event.currentTarget);
          }}
          onPointerCancel={cancelDrawing}
          onLostPointerCapture={cancelDrawing}
        />
      </div>
    </div>
  );
}
