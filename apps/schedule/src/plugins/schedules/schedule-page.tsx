import { Badge, Card, Chip, ErrorBanner, Loading, Page, Switch, buttonClass, tones } from "@g3/ui";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type Change, type Role, type ScheduleDetail, api, unwrap } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { Swatch, roleBlock } from "../../shared/role-colors";
import { dayLabel, longDayLabel, nowAt, spanLabel } from "../../shared/time";
import { useLoad } from "../../shared/use-load";
import { type Cells, inverseOf, rowRanges, sharing, toCells } from "./cells";
import { useMenuOnDoubleRightClick } from "./context-menu";
import { useEditing } from "./editing";
import { Grid, applyChange } from "./grid";
import { useHistory } from "./history";
import { Tools, useTools } from "./tools";

/** One event's schedule: the viewer's own day, or everyone's (where editors paint blocks). */
export function SchedulePage() {
  const id = useParams().id ?? "";
  const user = useAuthUser();
  const { data, error, reload } = useLoad(
    () => unwrap(api.schedules[":id"].$get({ param: { id } })),
    [id],
  );

  if (error) {
    return (
      <Page title="Schedule">
        <BackLink />
        <ErrorBanner message={error} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Schedule">
        <Loading />
      </Page>
    );
  }
  return <Loaded detail={data} canEdit={user.canEdit} me={user.userId} reload={reload} />;
}

function BackLink() {
  return (
    <Link to="/schedules/all" className="text-sm text-secondary-500 hover:text-secondary-900">
      ← All schedules
    </Link>
  );
}

function Loaded({
  detail,
  canEdit,
  me,
  reload,
}: { detail: ScheduleDetail; canEdit: boolean; me: string; reload: () => void }) {
  const [params, setParams] = useSearchParams();
  const attending = detail.attendees.some((a) => a.userId === me);
  const view = params.get("view") ?? (attending ? "mine" : "everyone");
  // The viewer's friends (only theirs to see): the Friends view, and "With" on their own day.
  const friendList = useLoad(() => unwrap(api.friends.$get()), []);
  const friends = useMemo(() => new Set(friendList.data?.map((f) => f.userId)), [friendList.data]);
  const day = detail.days.find((d) => d.day === params.get("day")) ?? todayOrFirst(detail);
  const roles = useMemo(() => new Map(detail.roles.map((r) => [r.id, r])), [detail.roles]);

  // Blocks as the page shows them: the worker's, with any change shown before it answers.
  const [cells, setCells] = useState<Cells>(() => toCells(detail.assignments));
  useEffect(() => setCells(toCells(detail.assignments)), [detail.assignments]);
  const tools = useTools(me, detail.roles);
  // Editors paint with the right button: the browser's menu only on a double right-click.
  // Editors switch editing on to paint; it's off whenever the app is opened or reloaded, so
  // looking never risks a change. Off, the page is as a student sees it.
  const [editingOn, setEditingOn] = useEditing();
  const editing = canEdit && editingOn;
  const editingLabel = useId();
  useMenuOnDoubleRightClick(editing);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The "now" mark, kept current.
  const [now, setNow] = useState(() => nowAt(detail.schedule.timeZone));
  useEffect(() => {
    const timer = setInterval(() => setNow(nowAt(detail.schedule.timeZone)), 30_000);
    return () => clearInterval(timer);
  }, [detail.schedule.timeZone]);

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  // The grid's rows: everyone attending, or just the viewer and their friends.
  const shown =
    view === "friends"
      ? detail.attendees.filter((a) => friends.has(a.userId) || a.userId === me)
      : detail.attendees;
  // With no friends attending, the Friends view would only be the viewer.
  const friendsAttending = shown.some((a) => a.userId !== me);

  // Saves go one after another, so an undo can't reach the worker before the paint it undoes.
  const queue = useRef(Promise.resolve());
  /** Shows changes at once and saves them; a failed save reloads the schedule and its history. */
  const send = useCallback(
    (changes: Change[]) => {
      if (changes.length === 0) return;
      setSaveError(null);
      setCells((current) => changes.reduce(applyChange, current));
      queue.current = queue.current.then(async () => {
        try {
          await unwrap(
            api.schedules[":id"].assignments.$put({
              param: { id: String(detail.schedule.id) },
              json: { changes },
            }),
          );
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : String(err));
          history.current?.clear();
          reload();
        }
      });
    },
    [detail.schedule.id, reload],
  );
  const steps = useHistory(send, editing);
  const history = useRef(steps);
  history.current = steps;

  function paint(change: Change) {
    steps.record([change], inverseOf(cells, change));
    send([change]);
  }

  return (
    <Page
      title={detail.schedule.name}
      width="full"
      description={
        <>
          <span className="block">
            <BackLink />
          </span>
          {canEdit && (
            // Under the name, where it belongs: whether students can see it yet, editing it, and
            // switching painting off to look without risk.
            <span className="mt-2 inline-flex flex-wrap items-center gap-2">
              {!detail.schedule.published && <Badge colors={tones.warning}>Draft</Badge>}
              <Link
                to={`/schedules/${detail.schedule.id}/settings`}
                className={buttonClass("secondary", "sm")}
              >
                Settings
              </Link>
              <span className="inline-flex items-center gap-2">
                <Switch
                  checked={editingOn}
                  onChange={setEditingOn}
                  aria-labelledby={editingLabel}
                />
                <span id={editingLabel} className="text-sm text-secondary-700">
                  Editing
                </span>
              </span>
            </span>
          )}
        </>
      }
    >
      {saveError && <ErrorBanner message={saveError} />}

      {detail.days.length === 0 || !day ? (
        <p className="text-sm text-secondary-500">
          {canEdit
            ? "No days yet. Add the event's days and hours in Settings."
            : "This event has no days yet."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip selected={view === "mine"} onClick={() => set("view", "mine")}>
              My schedule
            </Chip>
            <Chip selected={view === "friends"} onClick={() => set("view", "friends")}>
              Friends
            </Chip>
            <Chip selected={view === "everyone"} onClick={() => set("view", "everyone")}>
              Everyone
            </Chip>
            <span className="mx-1 h-5 border-l border-secondary-300" aria-hidden />
            {detail.days.map((d) => (
              <Chip
                key={d.day}
                selected={d.day === day.day}
                // Today isn't kept in the address, so the page follows the date when it's reopened.
                onClick={() => set("day", d.day === todayOrFirst(detail).day ? null : d.day)}
              >
                {dayLabel(d.day)}
              </Chip>
            ))}
          </div>

          {view === "mine" ? (
            <MyDay
              detail={detail}
              cells={cells}
              roles={roles}
              me={me}
              friends={friends}
              day={day.day}
            />
          ) : view === "friends" && friendList.data?.length === 0 ? (
            <p className="text-sm text-secondary-500">
              Add friends on the{" "}
              <Link to="/friends" className="underline">
                Friends
              </Link>{" "}
              page to see their schedules here with yours.
            </p>
          ) : view === "friends" && !friendList.data ? (
            friendList.error ? (
              <ErrorBanner message={friendList.error} />
            ) : (
              <Loading />
            )
          ) : (
            <>
              {editing && (
                <Tools
                  roles={detail.roles}
                  tools={tools.tools}
                  buttons={tools.buttons}
                  onChange={tools.update}
                  history={steps}
                />
              )}
              {shown.length === 0 || (view === "friends" && !friendsAttending) ? (
                <p className="text-sm text-secondary-500">
                  {view === "friends"
                    ? "None of your friends are attending this event."
                    : canEdit
                      ? "No one is attending yet. Add people in Settings."
                      : "No one is attending yet."}
                </p>
              ) : (
                <Grid
                  day={day}
                  attendees={shown}
                  periods={detail.periods.filter((p) => p.day === day.day)}
                  roles={roles}
                  cells={cells}
                  buttons={editing ? tools.buttons : null}
                  me={me}
                  now={now?.day === day.day ? now.slot : null}
                  onPaint={paint}
                />
              )}
              <Legend roles={detail.roles} />
            </>
          )}
        </>
      )}
    </Page>
  );
}

/** The day the page opens on: today if the event is on, else its first day. */
function todayOrFirst(detail: ScheduleDetail) {
  const today = nowAt(detail.schedule.timeZone)?.day;
  return detail.days.find((d) => d.day === today) ?? detail.days[0];
}

function Legend({ roles }: { roles: Role[] }) {
  const shown = roles.filter((r) => !r.archived);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-600">
      {shown.map((role) => (
        <li key={role.id} className="inline-flex items-center gap-1.5">
          <Swatch color={role.color} />
          {role.name}
        </li>
      ))}
    </ul>
  );
}

/** The viewer's own day: each run of a role, which friends share it, and the event's periods beside. */
function MyDay({
  detail,
  cells,
  roles,
  me,
  friends,
  day,
}: {
  detail: ScheduleDetail;
  cells: Cells;
  roles: Map<number, Role>;
  me: string;
  /** Only friends are named under "With". */
  friends: Set<string>;
  day: string;
}) {
  if (!detail.attendees.some((a) => a.userId === me)) {
    return <p className="text-sm text-secondary-500">You aren't attending this event.</p>;
  }
  const names = new Map(detail.attendees.map((a) => [a.userId, a.displayName ?? "Former member"]));
  const others = detail.attendees.map((a) => a.userId).filter((userId) => friends.has(userId));
  const mine = rowRanges(cells, me, day);
  const periods = detail.periods.filter((p) => p.day === day);

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[2fr_1fr]">
      <Card title={longDayLabel(day)}>
        {mine.length === 0 ? (
          <p className="text-sm text-secondary-500">Nothing assigned to you this day.</p>
        ) : (
          <ol className="space-y-2">
            {mine.map((range) => {
              const role = roles.get(range.roleId);
              const look = roleBlock(role?.color ?? "gray");
              const with_ = sharing(cells, others, day, range.start, range.end, range.roleId).map(
                (userId) => names.get(userId),
              );
              return (
                <li
                  key={range.start}
                  className={`rounded-lg border px-3 py-2 ${look.className}`}
                  style={look.style}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{role?.name ?? "Role"}</span>
                    <span className="text-sm">{spanLabel(range.start, range.end)}</span>
                  </div>
                  {with_.length > 0 && <p className="mt-0.5 text-xs">With {with_.join(", ")}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
      <Card title="Event">
        {periods.length === 0 ? (
          <p className="text-sm text-secondary-500">Nothing on the event's agenda this day.</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {periods.map((period) => (
              <li key={period.id} className="flex justify-between gap-3">
                <span className="font-medium text-secondary-900">{period.label}</span>
                <span className="text-secondary-500 whitespace-nowrap">
                  {spanLabel(period.start, period.end)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
