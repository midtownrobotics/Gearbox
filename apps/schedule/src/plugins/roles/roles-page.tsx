import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  TextField,
  focusRing,
  inputClass,
} from "@g3/ui";
import { ROLE_TYPES, type RoleColor, type RoleType } from "@g3/worker-schedule";
import { useState } from "react";
import { type Role, api, unwrap } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { PRESETS, PRESET_KEYS, Swatch, isPreset, roleBlock } from "../../shared/role-colors";
import { useLoad } from "../../shared/use-load";

// The team's roles, kept from event to event: what people can be assigned. A role that's been
// assigned is archived rather than deleted, so past schedules keep it.

const TYPE_NAMES: Record<RoleType, string> = { scouting: "Scouting", pit: "Pit", other: "Other" };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function RolesPage() {
  const user = useAuthUser();
  const { data, error, reload } = useLoad(
    () => (user.canEdit ? unwrap(api.roles.$get()) : Promise.resolve(null)),
    [],
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setSaving(true);
    setSaveError(null);
    try {
      await work();
      reload();
      return true;
    } catch (err) {
      setSaveError(message(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!user.canEdit) {
    return (
      <Page title="Roles">
        <p className="text-sm text-secondary-500">
          Only mentors and trusted students can change roles.
        </p>
      </Page>
    );
  }

  const active = data?.filter((r) => !r.archived) ?? [];
  const archived = data?.filter((r) => r.archived) ?? [];

  function move(index: number, by: -1 | 1) {
    const ids = active.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    void run(() =>
      unwrap(api.roles.order.$put({ json: { ids: [...ids, ...archived.map((r) => r.id)] } })),
    );
  }

  return (
    <Page
      title="Roles"
      description="What people can be assigned at an event, like Drive Team, Scouting or Lunch."
      width="narrow"
    >
      {(error || saveError) && <ErrorBanner message={(error ?? saveError) as string} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <NewRole
            saving={saving}
            onAdd={(name, color, type) =>
              run(() => unwrap(api.roles.$post({ json: { name, color, type } })))
            }
          />
          <Card title="Roles">
            {active.length === 0 ? (
              <p className="text-sm text-secondary-500">No roles yet. Add the first one above.</p>
            ) : (
              <ul className="divide-y divide-secondary-100">
                {active.map((role, i) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    saving={saving}
                    first={i === 0}
                    last={i === active.length - 1}
                    onMove={(by) => move(i, by)}
                    onSave={(json) =>
                      run(() =>
                        unwrap(
                          api.roles[":roleId"].$patch({ param: { roleId: String(role.id) }, json }),
                        ),
                      )
                    }
                    onDelete={() =>
                      void run(() =>
                        unwrap(
                          api.roles[":roleId"].$delete({ param: { roleId: String(role.id) } }),
                        ),
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </Card>
          {archived.length > 0 && (
            <Card title="Archived">
              <p className="mb-3 text-sm text-secondary-500">
                Kept on past schedules, but can't be assigned.
              </p>
              <ul className="divide-y divide-secondary-100">
                {archived.map((role) => (
                  <li
                    key={role.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 text-sm text-secondary-700">
                      <Swatch color={role.color} />
                      <span className="min-w-0">{role.name}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={saving}
                      onClick={() =>
                        void run(() =>
                          unwrap(
                            api.roles[":roleId"].$patch({
                              param: { roleId: String(role.id) },
                              json: { archived: false },
                            }),
                          ),
                        )
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

const SELECTED = "ring-2 ring-secondary-900 ring-offset-2 ring-offset-surface";

/** The presets, which suit light and dark mode, or any color the team picks. */
function ColorPicker({ value, onChange }: { value: string; onChange: (color: RoleColor) => void }) {
  const custom = !isPreset(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
      {PRESET_KEYS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={PRESETS[color].name}
          title={PRESETS[color].name}
          onClick={() => onChange(color)}
          className={`h-6 w-6 rounded-md ${focusRing} ${PRESETS[color].swatch} ${value === color ? SELECTED : ""}`}
        />
      ))}
      <label
        className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-secondary-300 bg-surface px-2 py-0.5 text-sm text-secondary-700 hover:border-secondary-500 focus-within:ring-2 focus-within:ring-primary-500 ${custom ? SELECTED : ""}`}
      >
        {custom && <Swatch color={value} />}
        {custom ? value : "Custom"}
        <input
          type="color"
          aria-label="Custom color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={custom ? value : "#3b82f6"}
          onChange={(e) => onChange(e.target.value as RoleColor)}
        />
      </label>
    </div>
  );
}

/** What kind of work the role is. */
function TypePicker({ value, onChange }: { value: RoleType; onChange: (type: RoleType) => void }) {
  return (
    <select
      aria-label="Type"
      className={inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value as RoleType)}
    >
      {ROLE_TYPES.map((type) => (
        <option key={type} value={type}>
          {TYPE_NAMES[type]}
        </option>
      ))}
    </select>
  );
}

function NewRole({
  saving,
  onAdd,
}: {
  saving: boolean;
  onAdd: (name: string, color: RoleColor, type: RoleType) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<RoleColor>("blue");
  const [type, setType] = useState<RoleType>("other");
  return (
    <Card title="New role">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(name, color, type).then((ok) => {
            if (!ok) return;
            setName("");
            setType("other");
          });
        }}
      >
        <Field label="Name">
          <TextField
            kind="role"
            value={name}
            maxLength={40}
            placeholder="Drive Team"
            required
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Type">
          <TypePicker value={type} onChange={setType} />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
        <Button type="submit" disabled={saving || !name.trim()}>
          Add role
        </Button>
      </form>
    </Card>
  );
}

function RoleRow({
  role,
  saving,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  role: Role;
  saving: boolean;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onSave: (changes: {
    name?: string;
    color?: RoleColor;
    type?: RoleType;
    archived?: boolean;
  }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color as RoleColor);
  const [type, setType] = useState(role.type);

  if (editing) {
    return (
      <li className="py-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ name, color, type }).then((ok) => ok && setEditing(false));
          }}
        >
          <TextField
            kind="role"
            aria-label="Name"
            value={name}
            maxLength={40}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <TypePicker value={type} onChange={setType} />
          <ColorPicker value={color} onChange={setColor} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving || !name.trim()}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="inline-flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 rounded-md border px-2 py-0.5 text-sm font-medium ${roleBlock(role.color).className}`}
          style={roleBlock(role.color).style}
        >
          {role.name}
        </span>
        <Badge>{TYPE_NAMES[role.type]}</Badge>
      </span>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || first}
          onClick={() => onMove(-1)}
          aria-label={`Move ${role.name} up`}
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || last}
          onClick={() => onMove(1)}
          aria-label={`Move ${role.name} down`}
        >
          ↓
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={() => void onSave({ archived: true })}
        >
          Archive
        </Button>
        <ConfirmButton
          label="Delete"
          size="sm"
          question={`Delete ${role.name}? A role that's been assigned can only be archived.`}
          disabled={saving}
          onConfirm={onDelete}
        />
      </div>
    </li>
  );
}
