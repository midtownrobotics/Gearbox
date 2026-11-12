// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, ErrorBanner, Page, Stat, buttonClass } from "@g3/ui";
import { type FieldDrawing, createFieldDrawing } from "@g3/worker-scouting/field-drawing";
import { fieldDrawingSvg } from "@g3/worker-scouting/field-drawing-svg";
import { useEffect, useRef, useState } from "react";
import { FormFieldMap } from "./FormFieldMap";
import { sharedFieldSvg } from "./field-drawing-view";

/** Development-only editor review. No session, team writes, or messages. */
export default function DrawingPreview() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState<FieldDrawing>(createFieldDrawing([]));
  const [initial, setInitial] = useState("");
  const [revision, setRevision] = useState(0);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const json = JSON.stringify(drawing);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void sharedFieldSvg()
      .then((field) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(
          new Blob([fieldDrawingSvg(drawing, field)], { type: "image/svg+xml" }),
        );
        setUrl(objectUrl);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [drawing]);
  return (
    <Page
      title="Drawing preview"
      description="Local preview. Draw a path, restore it, and compare the saved result. Nothing is sent to a team."
    >
      {error && <ErrorBanner message={error} />}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Stored coordinates"
            value={`${new TextEncoder().encode(json).length.toLocaleString()} bytes`}
          />
          <Stat label="Strokes" value={drawing.strokes.length} />
          <Stat label="Points" value={drawing.strokes.reduce((n, s) => n + s.points.length, 0)} />
        </div>
      </Card>
      <Card title="Draw">
        <FormFieldMap
          key={revision}
          canvasRef={canvas}
          initialImage={initial || undefined}
          onCommit={(_, vector) => {
            if (vector) setDrawing(vector);
          }}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!drawing.strokes.length}
            onClick={() => {
              setInitial(json);
              setRevision((n) => n + 1);
            }}
          >
            Restore saved coordinates
          </Button>
          {url && (
            <a className={buttonClass("secondary")} href={url} download="field-path.svg">
              Download SVG
            </a>
          )}
        </div>
      </Card>
      <Card title="Saved view">
        {url && (
          <img
            className="w-full rounded-lg"
            src={url}
            alt="Field with the saved drawing rendered from coordinates"
          />
        )}
      </Card>
    </Page>
  );
}
