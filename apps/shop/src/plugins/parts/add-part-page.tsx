import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  Page,
  type SafeTextKind,
  TextField,
  buttonClass,
  inputClass,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { partInfoRequiredBy, pipelineFileError } from "../../shared/derive";
import { useProjectFilter } from "../../shared/projects";
import { type PartDefinition, type PartInstance, activeOr } from "../../shared/types";
import { useAuthUser } from "../../shared/use-auth";
import { useShopData } from "../../shared/use-shop-data";
import { useTouchDevice } from "../../shared/use-touch";

/** State handed over from a part's "Edit & Obsolete" action. */
type TransferFrom = {
  sourcePartDefinitionId: number;
  onshapePartNumber: string;
  revision: string;
  subsystemId: number;
  name: string;
  notes: string;
  material: string;
  thickness: string;
  isPriority: boolean;
  quantity: number;
  processes: { processId: number; done: boolean }[];
};

export function AddPartPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading } = useShopData();
  const touch = useTouchDevice();
  const user = useAuthUser();

  // Redirect non-admins back to parts page
  useEffect(() => {
    if (user && !user.isAdmin) {
      navigate("/parts");
    }
  }, [user, navigate]);

  const transfer = (location.state as { transferFrom?: TransferFrom } | null)?.transferFrom ?? null;

  const [form, setForm] = useState({
    onshapePartNumber: transfer?.onshapePartNumber ?? "",
    revision: transfer?.revision ?? "",
    subsystemId: transfer?.subsystemId ?? 0,
    name: transfer?.name ?? "",
    quantity: transfer?.quantity ?? 1,
    notes: transfer?.notes ?? "",
    material: transfer?.material ?? "",
    thickness: transfer?.thickness ?? "",
    isPriority: transfer?.isPriority ?? false,
  });
  // Edit & Obsolete starts from the original pipeline (all steps restart); Add Part starts empty.
  const [processIds, setProcessIds] = useState<number[]>(
    transfer ? transfer.processes.map((p) => p.processId) : [],
  );
  const [formError, setFormError] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The project the part is for: picked here, else its subsystem's, else the one the pages are
  // filtered to, else the team's only one. Its subsystems are the ones to pick from.
  const projectFilter = useProjectFilter();
  const [pickedProject, setPickedProject] = useState<number | null>(null);

  if (loading || !user)
    return (
      <Page title="Add Part" width="narrow">
        <Loading />
      </Page>
    );

  function setProcessAt(index: number, processId: number) {
    setProcessIds((prev) => {
      const next = [...prev];
      if (processId === 0) next.splice(index, 1);
      else next[index] = processId;
      return next;
    });
  }

  const infoRequiredBy = partInfoRequiredBy(processIds, data?.processes ?? []);
  // The team's quality check, which the worker puts at the end of every part.
  const qualityStep = user.qualityCheck.required
    ? (data?.processes.find(
        (p) => p.id === user.qualityCheck.processId && p.type === "quality_control",
      ) ?? null)
    : null;
  // Not one removed on the Admin page, unless the part being edited already has it.
  const pickable = activeOr(data?.processes ?? [], processIds).filter(
    (p) => p.id !== qualityStep?.id,
  );

  async function handleSubmit() {
    if (
      !form.onshapePartNumber.trim() ||
      !form.revision.trim() ||
      !form.name.trim() ||
      !form.subsystemId
    ) {
      setFormError("Onshape part number, revision, subsystem, and name are required.");
      return;
    }
    if (!Number.isInteger(form.quantity) || form.quantity < 1) {
      setFormError("Quantity must be a whole number of at least 1.");
      return;
    }
    if (infoRequiredBy.length > 0 && (!form.material.trim() || !form.thickness.trim())) {
      setFormError(`Material and thickness are required for ${infoRequiredBy.join(", ")}.`);
      return;
    }
    const fileError = pipelineFileError(processIds, data?.processes ?? []);
    if (fileError) {
      setFormError(fileError);
      return;
    }
    setFormError("");
    setSubmitting(true);

    try {
      const pipeline = processIds;
      const fields = {
        subsystemId: form.subsystemId,
        name: form.name.trim(),
        notes: form.notes.trim() || null,
        material: form.material.trim() || null,
        thickness: form.thickness.trim() || null,
      };

      // Edit & Obsolete usually keeps the same part number + revision, which matches the
      // original definition (only its instances are retired). Reuse it, but apply the edits:
      // new instances copy the definition's blueprint, so it must be the edited pipeline.
      let definition: PartDefinition | undefined;
      if (transfer) {
        definition = data?.definitions.find(
          (d) =>
            d.onshapePartNumber === form.onshapePartNumber.trim() &&
            d.revision === form.revision.trim() &&
            !d.isObsolete,
        );
      }

      if (definition) {
        const [patchRes, blueprintRes] = await Promise.all([
          api["part-definitions"][":id"].$patch({
            param: { id: String(definition.id) },
            json: fields,
          }),
          api["part-definitions"][":id"].processes.$put({
            param: { id: String(definition.id) },
            json: { processIds: pipeline },
          }),
        ]);
        for (const res of [patchRes, blueprintRes]) {
          if (!res.ok) {
            setBanner(await getErrorMessage(res as unknown as Response));
            return;
          }
        }
      } else {
        const defRes = await api["part-definitions"].$post({
          json: {
            onshapePartNumber: form.onshapePartNumber.trim(),
            revision: form.revision.trim(),
            subsystemId: form.subsystemId,
            name: fields.name,
            notes: fields.notes ?? undefined,
            material: fields.material ?? undefined,
            thickness: fields.thickness ?? undefined,
            processIds: pipeline,
          },
        });
        if (!defRes.ok) {
          setBanner(await getErrorMessage(defRes as unknown as Response));
          return;
        }
        definition = (await defRes.json()) as PartDefinition;
      }

      // New instances always start at the first process; nothing carries over.
      const instRes = await api["part-instances"].$post({
        json: { partDefinitionId: definition.id, quantity: form.quantity },
      });
      if (!instRes.ok) {
        setBanner(await getErrorMessage(instRes as unknown as Response));
        return;
      }
      const instances = (await instRes.json()) as PartInstance[];

      if (form.isPriority) {
        await Promise.all(
          instances.map((inst) =>
            api["part-instances"][":id"].$patch({
              param: { id: String(inst.id) },
              json: { isPriority: true },
            }),
          ),
        );
      }

      // Retire the original's instances only once the replacements exist, so a failure above
      // never leaves the part with nothing active.
      if (transfer) {
        const originals =
          data?.instances.filter(
            (i) => i.partDefinitionId === transfer.sourcePartDefinitionId && !i.isStale,
          ) ?? [];
        await Promise.all(
          originals.map((inst) =>
            api["part-instances"][":id"].$patch({
              param: { id: String(inst.id) },
              json: { isStale: true },
            }),
          ),
        );
      }

      navigate("/parts");
    } finally {
      setSubmitting(false);
    }
  }

  const projects = activeOr(data?.projects ?? []);
  const currentProject = data?.subsystems.find((s) => s.id === form.subsystemId)?.projectId;
  const projectId =
    pickedProject ??
    currentProject ??
    projectFilter.projectId ??
    (projects.length === 1 ? projects[0].id : null);
  const removedProjects = new Set(
    (data?.projects ?? []).filter((p) => p.archivedAt !== null).map((p) => p.id),
  );
  const subsystems = activeOr(data?.subsystems ?? [], [form.subsystemId]).filter(
    (s) =>
      s.id === form.subsystemId || (s.projectId === projectId && !removedProjects.has(s.projectId)),
  );
  const processes = activeOr(data?.processes ?? []);

  return (
    <Page
      title={transfer ? "Edit and Make Obsolete" : "Add Part"}
      description={
        transfer ? "The original moves to Obsolete once this part is created." : undefined
      }
      width="narrow"
      actions={
        <Link to="/parts" className="text-sm text-secondary-500 hover:text-primary-600">
          ← Parts
        </Link>
      }
    >
      <>
        {banner && <ErrorBanner message={banner} />}

        <Card className="space-y-4">
          {projects.length > 1 && (
            <Field label="Project *">
              <select
                value={projectId ?? 0}
                onChange={(e) => {
                  setPickedProject(Number(e.target.value) || null);
                  setForm({ ...form, subsystemId: 0 });
                }}
                className={inputClass}
              >
                <option value={0}>Select…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {projects.length > 1 && projectId === null ? null : subsystems.length === 0 ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">
              {projects.length === 0
                ? "A part needs a project and a subsystem."
                : "A part needs a subsystem."}{" "}
              <Link to="/admin" className="underline font-medium">
                Add one on Admin
              </Link>{" "}
              first.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <LabeledText
                  kind="sku"
                  label="Onshape Part Number"
                  required
                  value={form.onshapePartNumber}
                  onChange={(v) => setForm({ ...form, onshapePartNumber: v })}
                  placeholder="P-0042"
                />
                <LabeledText
                  kind="revision"
                  label="Onshape Revision"
                  required
                  value={form.revision}
                  onChange={(v) => setForm({ ...form, revision: v })}
                  placeholder="A"
                />
                <Field label="Subsystem *">
                  <select
                    value={form.subsystemId}
                    onChange={(e) => setForm({ ...form, subsystemId: Number(e.target.value) })}
                    className={inputClass}
                  >
                    <option value={0}>Select…</option>
                    {subsystems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.archivedAt === null ? s.name : `${s.name} (removed)`}
                      </option>
                    ))}
                  </select>
                </Field>
                <LabeledText
                  kind="partName"
                  label="Name"
                  required
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  placeholder="Same as Onshape"
                />
                <Field label="Quantity *" hint="One part instance is made per quantity.">
                  <input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        quantity: Math.max(1, Math.floor(Number(e.target.value))),
                      })
                    }
                    className={inputClass}
                  />
                </Field>
                <LabeledText
                  kind="note"
                  label="Notes"
                  value={form.notes}
                  onChange={(v) => setForm({ ...form, notes: v })}
                  placeholder="Optional"
                />
                {infoRequiredBy.length > 0 && (
                  <>
                    <LabeledText
                      kind="material"
                      label="Material"
                      required
                      value={form.material}
                      onChange={(v) => setForm({ ...form, material: v })}
                      placeholder="e.g. 4140"
                      hint={`Required by ${infoRequiredBy.join(", ")}`}
                    />
                    <LabeledText
                      kind="size"
                      label="Thickness"
                      required
                      value={form.thickness}
                      onChange={(v) => setForm({ ...form, thickness: v })}
                      placeholder='e.g. 0.25"'
                    />
                  </>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-secondary-900">
                <input
                  type="checkbox"
                  checked={form.isPriority}
                  onChange={(e) => setForm({ ...form, isPriority: e.target.checked })}
                  className="accent-primary-500 w-4 h-4"
                />
                Priority part
              </label>

              <hr className="border-secondary-200" />

              {/* Processes */}
              <div className="space-y-2">
                <FieldLabel label="Processes" />
                <p className="text-xs text-secondary-500">
                  The order here is the order the part moves through the shop.
                </p>
                {processes.length === 0 ? (
                  <p className="text-sm text-secondary-500">No processes yet. Add some on Admin.</p>
                ) : (
                  <div className="space-y-2">
                    {processIds.map((pid, i) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows; duplicates of the same process are allowed
                        key={i}
                        className="flex items-center gap-2"
                      >
                        <span className="w-6 text-sm font-mono text-secondary-400 text-right shrink-0">
                          {i + 1}.
                        </span>
                        <select
                          value={pid}
                          onChange={(e) => setProcessAt(i, Number(e.target.value))}
                          className={`${inputClass} flex-1`}
                        >
                          <option value={0}>Remove</option>
                          {pickable.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.archivedAt === null ? p.name : `${p.name} (removed)`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-sm font-mono text-secondary-400 text-right shrink-0">
                        {processIds.length + 1}.
                      </span>
                      <select
                        value={0}
                        onChange={(e) => {
                          const pid = Number(e.target.value);
                          if (pid) setProcessIds((prev) => [...prev, pid]);
                        }}
                        className={`${inputClass} flex-1 border-dashed !text-secondary-500`}
                      >
                        <option value={0}>Add a process…</option>
                        {activeOr(pickable).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {qualityStep && (
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0" />
                        <p className="flex-1 bg-inset border border-secondary-200 rounded-lg px-3 py-2 text-sm text-secondary-600">
                          Last: {qualityStep.name} — the team requires quality control on every
                          part.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {formError && <p className="text-red-700 text-sm">{formError}</p>}

              <div className="flex gap-2 pt-2">
                <Button size={touch ? "lg" : "md"} onClick={handleSubmit} disabled={submitting}>
                  {submitting
                    ? "Creating…"
                    : transfer
                      ? "Create and make the original obsolete"
                      : "Create part"}
                </Button>
                <Link to="/parts" className={buttonClass("secondary", touch ? "lg" : "md")}>
                  Cancel
                </Link>
              </div>
            </>
          )}
        </Card>
      </>
    </Page>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="text-sm font-medium text-secondary-700">
      {label}
      {required && <span className="text-red-700"> *</span>}
    </span>
  );
}

function LabeledText({
  label,
  kind,
  value,
  onChange,
  placeholder,
  required,
  hint,
}: {
  label: string;
  kind: SafeTextKind;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint}>
      <TextField
        kind={kind}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
