// SPDX-License-Identifier: AGPL-3.0-only
import { Button, ErrorBanner, Loading, TextField } from "@g3/ui";
import {
  type FieldDrawing,
  createFieldDrawing,
  fieldDrawingFile,
  parseFieldDrawing,
} from "@g3/worker-scouting/field-drawing";
import { useEffect, useRef, useState } from "react";
import { FormFieldMap } from "./FormFieldMap";
import { type LocalFieldMap, saveLocalFieldMap } from "./local-field-maps";

export function VectorFieldMapEditor({
  map,
  onSaved,
}: {
  map: (Pick<LocalFieldMap, "id" | "name" | "eventName" | "notes"> & { image?: Blob }) | null;
  onSaved: () => Promise<void>;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<FieldDrawing>(createFieldDrawing([]));
  const [name, setName] = useState(map?.name ?? "");
  const [eventName, setEventName] = useState(map?.eventName ?? "");
  const [notes, setNotes] = useState(map?.notes ?? "");
  const [initial, setInitial] = useState<string | null>(map?.image ? null : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (map?.image)
      void map.image
        .text()
        .then((json) => {
          if (!active) return;
          drawing.current = parseFieldDrawing(JSON.parse(json));
          setInitial(JSON.stringify(drawing.current));
        })
        .catch(() => {
          if (active) setError("The saved map could not be read. Your original is unchanged.");
        });
    return () => {
      active = false;
    };
  }, [map?.image]);
  async function save() {
    if (initial === null) return;
    setSaving(true);
    setError("");
    try {
      await saveLocalFieldMap({
        id: map?.id ?? crypto.randomUUID(),
        name: name.trim(),
        eventName: eventName.trim(),
        notes: notes.trim(),
        image: fieldDrawingFile(drawing.current),
        updatedAt: Date.now(),
      });
      await onSaved();
      if (!map) {
        drawing.current = createFieldDrawing([]);
        setName("");
        setEventName("");
        setNotes("");
        setRevision((value) => value + 1);
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="map-editor">
      {error && <ErrorBanner message={error} />}
      {initial === null ? (
        <Loading />
      ) : (
        <FormFieldMap
          key={revision}
          canvasRef={canvas}
          initialImage={initial || undefined}
          onCommit={(_, vector) => {
            if (vector) drawing.current = vector;
          }}
        />
      )}
      <div className="map-details">
        <TextField
          kind="map"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Map name *"
        />
        <TextField
          kind="match"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          placeholder="Event or match"
        />
        <TextField
          kind="note"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
        />
        <Button
          variant="primary"
          disabled={!name.trim() || initial === null || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : map ? "Save changes" : "Save annotated map"}
        </Button>
      </div>
    </div>
  );
}
