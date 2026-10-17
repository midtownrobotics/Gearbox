import { Button } from "@g3/ui";
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

const COLORS = ["#ff334f", "#35d06f", "#ffd43b", "#ff66c4"];
type Point = { x: number; y: number };
type Tool = "draw" | "arrow" | "sotm";
type HistoryEntry = { image: ImageData; hasDrawing: boolean };

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
  initialDrawing,
  onDrawingSave,
  onRestoreComplete,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onDrawingChange?: (hasDrawing: boolean) => void;
  initialDrawing?: string;
  onDrawingSave?: (drawing: string | null) => void;
  onRestoreComplete?: (success: boolean) => void;
}) {
  const base = useRef<HTMLCanvasElement | null>(null);
  const committed = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<HistoryEntry[]>([]);
  const hasDrawing = useRef(false);
  const initialDrawingRef = useRef(initialDrawing);
  const restoring = useRef(!!initialDrawing);
  const onDrawingSaveRef = useRef(onDrawingSave);
  const onRestoreCompleteRef = useRef(onRestoreComplete);
  const onDrawingChangeRef = useRef(onDrawingChange);
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
    onDrawingSaveRef.current = onDrawingSave;
    onRestoreCompleteRef.current = onRestoreComplete;
  }, [onDrawingChange, onDrawingSave, onRestoreComplete]);

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
        if (initialDrawingRef.current) {
          const savedImage = new Image();
          savedImage.onload = () => {
            if (canvasRef.current !== canvas) return;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(savedImage, 0, 0, canvas.width, canvas.height);
            const saved = document.createElement("canvas");
            saved.width = canvas.width;
            saved.height = canvas.height;
            saved.getContext("2d")?.drawImage(canvas, 0, 0);
            committed.current = saved;
            hasDrawing.current = true;
            restoring.current = false;
            initialDrawingRef.current = undefined;
            onDrawingChangeRef.current?.(true);
            onRestoreCompleteRef.current?.(true);
          };
          savedImage.onerror = () => {
            restoring.current = false;
            onRestoreCompleteRef.current?.(false);
          };
          savedImage.src = initialDrawingRef.current;
        } else restoring.current = false;
        URL.revokeObjectURL(image.src);
      };
      image.src = URL.createObjectURL(blob);
    },
    [canvasRef],
  );

  const loadRebuilt = useCallback(async () => {
    try {
      const response = await fetch("/field-2026.svg");
      if (!response.ok) throw new Error("Field unavailable");
      loadBlob(await response.blob());
    } catch {
      if (initialDrawingRef.current) onRestoreCompleteRef.current?.(false);
    }
  }, [loadBlob]);

  useEffect(() => {
    void loadRebuilt();
  }, [loadRebuilt]);
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
      });
      if (history.current.length > 20) history.current.shift();
    }
  }
  function setHasDrawing(value: boolean) {
    if (hasDrawing.current === value) return;
    hasDrawing.current = value;
    onDrawingChangeRef.current?.(value);
  }
  function commitCanvas(canvas: HTMLCanvasElement) {
    const saved = document.createElement("canvas");
    saved.width = canvas.width;
    saved.height = canvas.height;
    saved.getContext("2d")?.drawImage(canvas, 0, 0);
    committed.current = saved;
  }
  function saveDrawing(canvas: HTMLCanvasElement) {
    onDrawingSaveRef.current?.(hasDrawing.current ? canvas.toDataURL("image/png") : null);
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
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(base.current, 0, 0);
    commitCanvas(canvas);
    setHasDrawing(false);
    saveDrawing(canvas);
  }
  function undo() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const entry = history.current.pop();
    if (canvas && context && entry) {
      context.putImageData(entry.image, 0, 0);
      commitCanvas(canvas);
      setHasDrawing(entry.hasDrawing);
      saveDrawing(canvas);
    }
  }
  function finishDrawing(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (context && tool !== "arrow" && path.current.length > 1) {
      finishGradient(context, path.current);
      if (tool === "sotm") cone(context, path.current);
    }
    if (path.current.length > 1) setHasDrawing(true);
    commitCanvas(canvas);
    saveDrawing(canvas);
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
    <div className={`map-editor form-map-editor ${fullscreen ? "map-editor-fullscreen" : ""}`}>
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
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              activePointer.current !== null ||
              !base.current ||
              restoring.current
            )
              return;
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
