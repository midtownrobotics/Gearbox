import { Badge, Card, Chip, ErrorBanner, Loading, Page, buttonClass, tones } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type Change, type Role, type ScheduleDetail, api, unwrap } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { Swatch, roleBlock } from "../../shared/role-colors";
import { dayLabel, longDayLabel, nowAt, spanLabel } from "../../shared/time";
import { useLoad } from "../../shared/use-load";
import { type Cells, rowRanges, sharing, toCells } from "./cells";
import { useMenuOnDoubleRightClick } from "./context-menu";
import { Grid, applyChange } from "./grid";
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
    <Link to="/schedules" className="text-sm text-secondary-500 hover:text-secondary-900">
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
  const day = detail.days.find((d) => d.day === params.get("day")) ?? todayOrFirst(detail);
  const roles = useMemo(() => new Map(detail.roles.map((r) => [r.id, r])), [detail.roles]);

  // Blocks as the page shows them: the worker's, with any change shown before it answers.
  const [cells, setCells] = useState<Cells>(() => toCells(detail.assignments));
  useEffect(() => setCells(toCells(detail.assignments)), [detail.assignments]);
  const tools = useTools(me, detail.roles);
  // Editors paint with the right button: the browser's menu only on a double right-click.
  useMenuOnDoubleRightClick(canEdit);
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

  async function paint(change: Change) {
    setSaveError(null);
    setCells((current) => applyChange(current, change));
    try {
      await unwrap(
        api.schedules[":id"].assignments.$put({
          param: { id: String(detail.schedule.id) },
          json: { changes: [change] },
        }),
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      reload();
    }
  }

  return (
    <Page
      title={detail.schedule.name}
      width="full"
      description={
        canEdit && (
          // Under the name, where it belongs: whether students can see it yet, and editing it.
          <span className="mt-1 inline-flex flex-wrap items-center gap-2">
            {!detail.schedule.published && <Badge colors={tones.warning}>Draft</Badge>}
            <Link
              to={`/schedules/${detail.schedule.id}/edit`}
              className={buttonClass("secondary", "sm")}
            >
              Edit
            </Link>
          </span>
        )
      }
    >
      <BackLink />
      {saveError && <ErrorBanner message={saveError} />}

      {detail.days.length === 0 || !day ? (
        <p className="text-sm text-secondary-500">
          {canEdit
            ? "No days yet. Add the event's days and hours with Edit."
            : "This event has no days yet."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip selected={view === "mine"} onClick={() => set("view", "mine")}>
              My schedule
            </Chip>
            <Chip selected={view === "everyone"} onClick={() => set("view", "everyone")}>
              Everyone
            </Chip>
            <span className="mx-1 h-5 border-l border-secondary-300" aria-hidden />
            {detail.days.map((d) => (
              <Chip key={d.day} selected={d.day === day.day} onClick={() => set("day", d.day)}>
                {dayLabel(d.day)}
              </Chip>
            ))}
          </div>

          {view === "mine" ? (
            <MyDay detail={detail} cells={cells} roles={roles} me={me} day={day.day} />
          ) : (
            <>
              {canEdit && (
                <Tools
                  roles={detail.roles}
                  tools={tools.tools}
                  buttons={tools.buttons}
                  onChange={tools.update}
                />
              )}
              {detail.attendees.length === 0 ? (
                <p className="text-sm text-secondary-500">
                  {canEdit
                    ? "No one is attending yet. Add people with Edit."
                    : "No one is attending yet."}
                </p>
              ) : (
                <Grid
                  day={day}
                  attendees={detail.attendees}
                  periods={detail.periods.filter((p) => p.day === day.day)}
                  roles={roles}
                  cells={cells}
                  buttons={canEdit ? tools.buttons : null}
                  me={me}
                  now={now?.day === day.day ? now.slot : null}
                  onPaint={(change) => void paint(change)}
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

/** The viewer's own day: each run of a role, who shares it, and the event's periods beside. */
function MyDay({
  detail,
  cells,
  roles,
  me,
  day,
}: {
  detail: ScheduleDetail;
  cells: Cells;
  roles: Map<number, Role>;
  me: string;
  day: string;
}) {
  if (!detail.attendees.some((a) => a.userId === me)) {
    return <p className="text-sm text-secondary-500">You aren't attending this event.</p>;
  }
  const names = new Map(detail.attendees.map((a) => [a.userId, a.displayName ?? "Former member"]));
  const others = detail.attendees.map((a) => a.userId).filter((userId) => userId !== me);
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
