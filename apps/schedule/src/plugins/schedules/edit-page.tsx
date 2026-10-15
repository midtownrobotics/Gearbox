import {
  Button,
  Card,
  ConfirmButton,
  ConfirmQuestion,
  ErrorBanner,
  Field,
  Loading,
  Page,
  SuccessBanner,
  Switch,
  Toggle,
  inputClass,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type Day, type Period, type ScheduleDetail, api, unwrap } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { longDayLabel, slotOptions, spanLabel, timeLabel } from "../../shared/time";
import { useLoad } from "../../shared/use-load";
import { TimeZoneSelect } from "./list-page";

// Making an event's schedule ready: its details and publishing, its days and hours, the event's
// labeled periods, and who's attending. Editors only.

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function EditPage() {
  const id = useParams().id ?? "";
  const user = useAuthUser();
  const { data, error, reload } = useLoad(
    () =>
      user.canEdit ? unwrap(api.schedules[":id"].$get({ param: { id } })) : Promise.resolve(null),
    [id],
  );

  if (!user.canEdit) {
    return (
      <Page title="Edit">
        <p className="text-sm text-secondary-500">
          Only mentors and trusted students can edit schedules.
        </p>
      </Page>
    );
  }
  return (
    <Page title="Edit" description={data?.schedule.name} width="narrow">
      <Link to={`/schedules/${id}`} className="text-sm text-secondary-500 hover:text-secondary-900">
        ← Back to the schedule
      </Link>
      {error && <ErrorBanner message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <DetailsCard detail={data} reload={reload} />
          <DaysCard detail={data} reload={reload} />
          <PeriodsCard detail={data} reload={reload} />
          <AttendeesCard detail={data} reload={reload} />
        </>
      )}
    </Page>
  );
}

type CardProps = { detail: ScheduleDetail; reload: () => void };

/** A save that shows its error, for the cards below. */
function useSave() {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save(work: () => Promise<unknown>, after?: () => void) {
    setSaving(true);
    setError(null);
    try {
      await work();
      after?.();
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { error, saving, save };
}

const REMINDERS = [null, 0, 5, 10, 15, 30, 60];
const reminderLabel = (minutes: number | null) =>
  minutes === null ? "Off" : minutes === 0 ? "When it starts" : `${minutes} minutes before`;

function DetailsCard({ detail, reload }: CardProps) {
  const navigate = useNavigate();
  const { schedule } = detail;
  const param = { id: String(schedule.id) };
  const [name, setName] = useState(schedule.name);
  const [timeZone, setTimeZone] = useState(schedule.timeZone);
  const [notify, setNotify] = useState<number | null>(schedule.notifyMinutes);
  const [saved, setSaved] = useState(false);
  const { error, saving, save } = useSave();
  const changed =
    name.trim() !== schedule.name ||
    timeZone !== schedule.timeZone ||
    notify !== schedule.notifyMinutes;

  return (
    <Card title="Details">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save(
            () =>
              unwrap(
                api.schedules[":id"].$patch({
                  param,
                  json: { name, timeZone, notifyMinutes: notify },
                }),
              ),
            () => {
              setSaved(true);
              reload();
            },
          );
        }}
      >
        {error && <ErrorBanner message={error} />}
        {saved && <SuccessBanner message="Saved." />}
        <Field label="Event">
          <input
            className={inputClass}
            value={name}
            maxLength={100}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Time zone" hint="Where the event is. Times are shown in it.">
          <TimeZoneSelect value={timeZone} onChange={setTimeZone} />
        </Field>
        <Field
          label="Slack reminders"
          hint="A message before each change of role, to everyone with Slack linked."
        >
          <select
            className={inputClass}
            value={notify === null ? "off" : String(notify)}
            onChange={(e) => setNotify(e.target.value === "off" ? null : Number(e.target.value))}
          >
            {REMINDERS.map((minutes) => (
              <option key={String(minutes)} value={minutes === null ? "off" : String(minutes)}>
                {reminderLabel(minutes)}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={saving || !changed || !name.trim()}>
          Save
        </Button>
      </form>

      <div className="mt-5 space-y-4 border-t border-secondary-200 pt-4">
        <Toggle
          label="Published"
          description={
            schedule.published
              ? "Everyone on the team can see it, and Slack reminders are on."
              : "Only mentors and trusted students can see it. Students see it once it's published."
          }
          checked={schedule.published}
          disabled={saving}
          onChange={(published) =>
            void save(
              () => unwrap(api.schedules[":id"].$patch({ param, json: { published } })),
              reload,
            )
          }
        />
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            label="Delete schedule"
            question={`Delete ${schedule.name}, with everyone's blocks? This can't be undone.`}
            disabled={saving}
            onConfirm={() =>
              void save(
                () => unwrap(api.schedules[":id"].$delete({ param })),
                () => navigate("/schedules"),
              )
            }
          />
        </div>
      </div>
    </Card>
  );
}

/** Start and end selects on the 15-minute grid. */
function HoursPicker({
  start,
  end,
  onChange,
  min = 0,
  max = 96,
}: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="From"
        className={`${inputClass} w-auto`}
        value={start}
        onChange={(e) => onChange(Number(e.target.value), end)}
      >
        {slotOptions(min, max - 1).map((slot) => (
          <option key={slot} value={slot}>
            {timeLabel(slot)}
          </option>
        ))}
      </select>
      <span className="text-sm text-secondary-500">to</span>
      <select
        aria-label="To"
        className={`${inputClass} w-auto`}
        value={end}
        onChange={(e) => onChange(start, Number(e.target.value))}
      >
        {slotOptions(min + 1, max).map((slot) => (
          <option key={slot} value={slot}>
            {timeLabel(slot)}
          </option>
        ))}
      </select>
    </div>
  );
}

function DaysCard({ detail, reload }: CardProps) {
  const param = { id: String(detail.schedule.id) };
  const { error, saving, save } = useSave();
  const [newDay, setNewDay] = useState("");
  const [hours, setHours] = useState({ start: 32, end: 72 });

  const setDay = (day: string, start: number, end: number) =>
    save(
      () =>
        unwrap(
          api.schedules[":id"].days[":day"].$put({
            param: { ...param, day },
            json: { start, end },
          }),
        ),
      reload,
    );

  return (
    <Card title="Days">
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {detail.days.length === 0 && (
          <p className="text-sm text-secondary-500">Add each day of the event and its hours.</p>
        )}
        <ul className="space-y-3">
          {detail.days.map((day) => (
            <DayRow
              key={day.day}
              day={day}
              saving={saving}
              onHours={(start, end) => void setDay(day.day, start, end)}
              onRemove={() =>
                void save(
                  () =>
                    unwrap(
                      api.schedules[":id"].days[":day"].$delete({
                        param: { ...param, day: day.day },
                      }),
                    ),
                  reload,
                )
              }
            />
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2 border-t border-secondary-200 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void setDay(newDay, hours.start, hours.end).then((ok) => ok && setNewDay(""));
          }}
        >
          <Field label="Add a day">
            <input
              type="date"
              className={`${inputClass} w-auto`}
              value={newDay}
              required
              onChange={(e) => setNewDay(e.target.value)}
            />
          </Field>
          <HoursPicker
            start={hours.start}
            end={hours.end}
            onChange={(start, end) => setHours({ start, end })}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={saving || !newDay || hours.start >= hours.end}
          >
            Add day
          </Button>
        </form>
      </div>
    </Card>
  );
}

function DayRow({
  day,
  saving,
  onHours,
  onRemove,
}: {
  day: Day;
  saving: boolean;
  onHours: (start: number, end: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium text-secondary-900">{longDayLabel(day.day)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <HoursPicker
          start={day.start}
          end={day.end}
          onChange={(start, end) => start < end && onHours(start, end)}
        />
        <ConfirmButton
          label="Remove"
          size="sm"
          question="Remove this day, with its periods and everyone's blocks on it?"
          confirmLabel="Remove day"
          disabled={saving}
          onConfirm={onRemove}
        />
      </div>
    </li>
  );
}

/**
 * A start and end kept within a day's hours (and the end after the start), so the time pickers
 * never send a time they can't show.
 */
function withinDay(start: number, end: number, day: { start: number; end: number }) {
  const from = Math.min(Math.max(start, day.start), day.end - 1);
  return { start: from, end: Math.min(Math.max(end, from + 1), day.end) };
}

function PeriodsCard({ detail, reload }: CardProps) {
  const param = { id: String(detail.schedule.id) };
  const { error, saving, save } = useSave();
  const firstDay = detail.days[0];
  const [draft, setDraft] = useState({ day: firstDay?.day ?? "", label: "", start: 48, end: 52 });
  useEffect(() => {
    if (!detail.days.some((d) => d.day === draft.day) && firstDay) {
      setDraft((d) => ({ ...d, day: firstDay.day }));
    }
  }, [detail.days, draft.day, firstDay]);

  if (detail.days.length === 0) {
    return (
      <Card title="Periods">
        <p className="text-sm text-secondary-500">Add a day first, then its periods.</p>
      </Card>
    );
  }
  const draftDay = detail.days.find((d) => d.day === draft.day) ?? firstDay;
  const times = withinDay(draft.start, draft.end, draftDay);

  return (
    <Card title="Periods">
      <div className="space-y-4">
        <p className="text-sm text-secondary-500">
          The event's own agenda, like Load in, Lunch or Practice matches. Periods can't overlap.
        </p>
        {error && <ErrorBanner message={error} />}
        {detail.days.map((day) => {
          const periods = detail.periods.filter((p) => p.day === day.day);
          if (periods.length === 0) return null;
          return (
            <div key={day.day} className="space-y-2">
              <h3 className="text-sm font-semibold text-secondary-700">{longDayLabel(day.day)}</h3>
              <ul className="space-y-2">
                {periods.map((period) => (
                  <PeriodRow
                    key={period.id}
                    period={period}
                    day={day}
                    saving={saving}
                    onSave={(changes) =>
                      save(
                        () =>
                          unwrap(
                            api.schedules[":id"].periods[":periodId"].$patch({
                              param: { ...param, periodId: String(period.id) },
                              json: changes,
                            }),
                          ),
                        reload,
                      )
                    }
                    onDelete={() =>
                      void save(
                        () =>
                          unwrap(
                            api.schedules[":id"].periods[":periodId"].$delete({
                              param: { ...param, periodId: String(period.id) },
                            }),
                          ),
                        reload,
                      )
                    }
                  />
                ))}
              </ul>
            </div>
          );
        })}
        <form
          className="space-y-3 border-t border-secondary-200 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              () =>
                unwrap(
                  api.schedules[":id"].periods.$post({
                    param,
                    json: { day: draftDay.day, label: draft.label, ...times },
                  }),
                ),
              () => {
                setDraft((d) => ({ ...d, label: "" }));
                reload();
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Add a period">
              <input
                className={inputClass}
                value={draft.label}
                placeholder="Lunch"
                maxLength={60}
                required
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </Field>
            <Field label="Day">
              <select
                className={inputClass}
                value={draft.day}
                onChange={(e) => setDraft({ ...draft, day: e.target.value })}
              >
                {detail.days.map((d) => (
                  <option key={d.day} value={d.day}>
                    {longDayLabel(d.day)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HoursPicker
              start={times.start}
              end={times.end}
              min={draftDay.start}
              max={draftDay.end}
              onChange={(start, end) => setDraft({ ...draft, start, end })}
            />
            <Button type="submit" variant="secondary" disabled={saving || !draft.label.trim()}>
              Add period
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

function PeriodRow({
  period,
  day,
  saving,
  onSave,
  onDelete,
}: {
  period: Period;
  day: Day;
  saving: boolean;
  onSave: (changes: { label: string; start: number; end: number }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ label: period.label, start: period.start, end: period.end });
  const times = withinDay(draft.start, draft.end, day);
  if (!editing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium text-secondary-900">{period.label}</span>{" "}
          <span className="text-sm text-secondary-500">{spanLabel(period.start, period.end)}</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <ConfirmButton
            label="Delete"
            size="sm"
            question={`Delete ${period.label}?`}
            disabled={saving}
            onConfirm={onDelete}
          />
        </div>
      </li>
    );
  }
  return (
    <li>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ label: draft.label, ...times }).then((ok) => ok && setEditing(false));
        }}
      >
        <input
          aria-label="Label"
          className={`${inputClass} w-40`}
          value={draft.label}
          maxLength={60}
          required
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <HoursPicker
          start={times.start}
          end={times.end}
          min={day.start}
          max={day.end}
          onChange={(start, end) => setDraft({ ...draft, start, end })}
        />
        <Button type="submit" size="sm" disabled={saving}>
          Save
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
    </li>
  );
}

function AttendeesCard({ detail, reload }: CardProps) {
  const param = { id: String(detail.schedule.id) };
  const { error, saving, save } = useSave();
  const members = useLoad(() => unwrap(api.members.$get()), []);
  const [removing, setRemoving] = useState<string | null>(null);
  const going = new Set(detail.attendees.map((a) => a.userId));
  const hasBlocks = new Set(detail.assignments.map((a) => a.userId));
  // Members who have left the team but are still on the list.
  const former = detail.attendees.filter((a) => !a.active);

  const add = (userIds: string[]) =>
    save(() => unwrap(api.schedules[":id"].attendees.$post({ param, json: { userIds } })), reload);
  const remove = (userId: string) =>
    save(
      () =>
        unwrap(api.schedules[":id"].attendees[":userId"].$delete({ param: { ...param, userId } })),
      () => {
        setRemoving(null);
        reload();
      },
    );

  const missing = members.data?.filter((m) => !going.has(m.id)) ?? [];

  return (
    <Card title={`Attending (${detail.attendees.length})`}>
      <div className="space-y-3">
        <p className="text-sm text-secondary-500">Only the people attending are in the schedule.</p>
        {error && <ErrorBanner message={error} />}
        {members.error && <ErrorBanner message={members.error} />}
        {!members.data && !members.error && <Loading />}
        {members.data && missing.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => void add(missing.map((m) => m.id))}
          >
            Add everyone
          </Button>
        )}
        <ul className="divide-y divide-secondary-100">
          {members.data?.map((member) => {
            const on = going.has(member.id);
            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="text-sm text-secondary-900">
                  {member.displayName}
                  {member.isMentor && <span className="text-secondary-500"> · Mentor</span>}
                </span>
                <Switch
                  label={`${member.displayName} is attending`}
                  checked={on}
                  disabled={saving}
                  onChange={(checked) => {
                    if (checked) void add([member.id]);
                    else if (hasBlocks.has(member.id)) setRemoving(member.id);
                    else void remove(member.id);
                  }}
                />
                {removing === member.id && (
                  <ConfirmQuestion
                    question={`Remove ${member.displayName}? Their blocks in this schedule are deleted too.`}
                    confirmLabel="Remove"
                    keepLabel="Keep them"
                    size="sm"
                    disabled={saving}
                    onConfirm={() => void remove(member.id)}
                    onKeep={() => setRemoving(null)}
                  />
                )}
              </li>
            );
          })}
          {former.map((attendee) => (
            <li
              key={attendee.userId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="text-sm text-secondary-500">
                {attendee.displayName ?? "Former member"} · no longer on the team
              </span>
              <ConfirmButton
                label="Remove"
                size="sm"
                question="Remove them, with their blocks in this schedule?"
                disabled={saving}
                onConfirm={() => void remove(attendee.userId)}
              />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
