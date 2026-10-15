import { Badge, Button, Card, ErrorBanner, Field, Loading, Page, inputClass, tones } from "@g3/ui";
import { Dialog } from "@g3/ui";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type ScheduleListItem, api, unwrap } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { browserTimeZone, datesLabel, timeZones } from "../../shared/time";
import { useLoad } from "../../shared/use-load";

/** Every schedule the member can see: published ones, and drafts for editors. */
export function ListPage() {
  const user = useAuthUser();
  const [creating, setCreating] = useState(false);
  const { data, error } = useLoad(() => unwrap(api.schedules.$get()), []);

  return (
    <Page
      title="Schedules"
      description="Who does what at each event, 15 minutes at a time."
      actions={user.canEdit && <Button onClick={() => setCreating(true)}>New schedule</Button>}
    >
      {error && <ErrorBanner message={error} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && (
        <p className="text-sm text-secondary-500">
          {user.canEdit
            ? "No schedules yet. Make one for your next event with New schedule."
            : "No schedules yet. They'll show here once a mentor publishes one."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.map((schedule) => (
          <ScheduleCard key={schedule.id} schedule={schedule} />
        ))}
      </div>
      {creating && <NewScheduleDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}

function ScheduleCard({ schedule }: { schedule: ScheduleListItem }) {
  return (
    <Link
      to={`/schedules/${schedule.id}`}
      className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <Card className="h-full hover:border-secondary-400">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-secondary-900">{schedule.name}</h2>
          {!schedule.published && <Badge colors={tones.warning}>Draft</Badge>}
        </div>
        <p className="mt-1 text-sm text-secondary-500">
          {datesLabel(schedule.firstDay, schedule.lastDay) ?? "No days yet"}
        </p>
      </Card>
    </Link>
  );
}

function NewScheduleDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const schedule = await unwrap(api.schedules.$post({ json: { name, timeZone } }));
      navigate(`/schedules/${schedule.id}/settings`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title="New schedule" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {error && <ErrorBanner message={error} />}
        <Field label="Event">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Greater Kansas City Regional"
            maxLength={100}
            required
            // biome-ignore lint/a11y/noAutofocus: the dialog's only job is this field
            autoFocus
          />
        </Field>
        <Field label="Time zone" hint="Where the event is. Times are shown in it.">
          <TimeZoneSelect value={timeZone} onChange={setTimeZone} />
        </Field>
        <p className="text-sm text-secondary-500">
          It starts as a draft: students see it once you publish it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving || !name.trim()}>
            Create
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TimeZoneSelect({
  value,
  onChange,
}: { value: string; onChange: (zone: string) => void }) {
  const zones = timeZones();
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {!zones.includes(value) && <option value={value}>{value}</option>}
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.split("_").join(" ")}
        </option>
      ))}
    </select>
  );
}
