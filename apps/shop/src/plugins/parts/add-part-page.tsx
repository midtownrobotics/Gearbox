import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { partInfoRequiredBy, pipelineFileError } from "../../shared/derive";
import type { PartDefinition, PartInstance } from "../../shared/types";
import { ErrorBanner, PageLoading } from "../../shared/ui";
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

  if (loading || !user) return <PageLoading />;

  function setProcessAt(index: number, processId: number) {
    setProcessIds((prev) => {
      const next = [...prev];
      if (processId === 0) next.splice(index, 1);
      else next[index] = processId;
      return next;
    });
  }

  const infoRequiredBy = partInfoRequiredBy(processIds, data?.processes ?? []);

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

  const subsystems = data?.subsystems ?? [];
  const processes = data?.processes ?? [];

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
        <div>
          <Link to="/parts" className="text-sm text-steel hover:text-ink transition-colors">
            ← Back to Parts
          </Link>
          <h1 className="font-display text-4xl text-ink mt-2">
            {transfer ? "Edit & Obsolete" : "Add Part"}
          </h1>
          {transfer && (
            <p className="text-sm text-steel-dark mt-1">
              The original moves to Obsolete once this part is created.
            </p>
          )}
        </div>

        {banner && <ErrorBanner message={banner} />}

        <div className="bg-paper border border-steel/30 rounded-xl p-6 space-y-4">
          {subsystems.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">
              No subsystems exist yet — add one on the{" "}
              <Link to="/admin" className="underline font-medium">
                Admin page
              </Link>{" "}
              first.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Onshape Part Number"
                  required
                  value={form.onshapePartNumber}
                  onChange={(v) => setForm({ ...form, onshapePartNumber: v })}
                  placeholder="P-0042"
                />
                <Field
                  label="Onshape Revision"
                  required
                  value={form.revision}
                  onChange={(v) => setForm({ ...form, revision: v })}
                  placeholder="A"
                />
                <div className="space-y-1">
                  <FieldLabel label="Subsystem" required />
                  <select
                    value={form.subsystemId}
                    onChange={(e) => setForm({ ...form, subsystemId: Number(e.target.value) })}
                    className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
                  >
                    <option value={0}>Select…</option>
                    {subsystems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Name"
                  required
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  placeholder="Same as Onshape"
                />
                <div className="space-y-1">
                  <FieldLabel label="Quantity" required />
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
                    className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
                  />
                  <p className="text-xs text-steel">One part instance is made per quantity.</p>
                </div>
                <Field
                  label="Notes"
                  value={form.notes}
                  onChange={(v) => setForm({ ...form, notes: v })}
                  placeholder="Optional"
                />
                {infoRequiredBy.length > 0 && (
                  <>
                    <Field
                      label="Material"
                      required
                      value={form.material}
                      onChange={(v) => setForm({ ...form, material: v })}
                      placeholder="e.g. 4140"
                      hint={`Required by ${infoRequiredBy.join(", ")}`}
                    />
                    <Field
                      label="Thickness"
                      required
                      value={form.thickness}
                      onChange={(v) => setForm({ ...form, thickness: v })}
                      placeholder='e.g. 0.25"'
                    />
                  </>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.isPriority}
                  onChange={(e) => setForm({ ...form, isPriority: e.target.checked })}
                  className="accent-crimson w-4 h-4"
                />
                Priority part
              </label>

              <hr className="border-steel/25" />

              {/* Processes */}
              <div className="space-y-2">
                <FieldLabel label="Processes" />
                <p className="text-xs text-steel">
                  The order here is the order the part moves through the shop.
                </p>
                {processes.length === 0 ? (
                  <p className="text-sm text-steel">
                    No processes exist yet — add some on the Admin page.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {processIds.map((pid, i) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows; duplicates of the same process are allowed
                        key={i}
                        className="flex items-center gap-2"
                      >
                        <span className="w-6 text-sm font-mono text-steel text-right shrink-0">
                          {i + 1}.
                        </span>
                        <select
                          value={pid}
                          onChange={(e) => setProcessAt(i, Number(e.target.value))}
                          className="flex-1 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
                        >
                          <option value={0}>Remove</option>
                          {processes.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-sm font-mono text-steel text-right shrink-0">
                        {processIds.length + 1}.
                      </span>
                      <select
                        value={0}
                        onChange={(e) => {
                          const pid = Number(e.target.value);
                          if (pid) setProcessIds((prev) => [...prev, pid]);
                        }}
                        className="flex-1 bg-mist border border-dashed border-steel/40 rounded-lg px-3 py-2 text-sm text-steel-dark focus:outline-none focus:border-crimson"
                      >
                        <option value={0}>Add a process…</option>
                        {processes.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {formError && <p className="text-crimson-dark text-sm">{formError}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className={`bg-crimson hover:bg-crimson-dark disabled:opacity-50 text-paper text-sm font-semibold rounded-lg transition-colors ${
                    touch ? "px-6 py-3" : "px-5 py-2"
                  }`}
                >
                  {submitting ? "Creating…" : transfer ? "Create & Retire Original" : "Create Part"}
                </button>
                <Link
                  to="/parts"
                  className={`bg-steel-tint hover:bg-steel/30 text-steel-dark text-sm font-medium rounded-lg transition-colors ${
                    touch ? "px-6 py-3" : "px-5 py-2"
                  }`}
                >
                  Cancel
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="text-xs font-medium text-steel-dark">
      {label}
      {required && <span className="text-crimson"> *</span>}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel label={label} required={required} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
      />
      {hint && <p className="text-xs text-steel">{hint}</p>}
    </div>
  );
}
