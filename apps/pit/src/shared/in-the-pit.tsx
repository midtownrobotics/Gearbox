import { apiPath, appUrl } from "@g3/site-config";
import { appOn, useAppOn } from "@g3/ui";
import { useEffect, useState } from "react";

// "In the pit now": who has a Pit role at this moment on the team's published Schedule, read
// through Schedule's own API. Only while the team has Schedule on; otherwise nothing shows.

export type PersonInThePit = {
  userId: string;
  displayName: string | null;
  roleName: string;
  /** When their role ends, as the event's own clock time ("12:15"). */
  until: string;
};

const REFRESH_MS = 60_000;

/** The people in the pit now; throws when Schedule can't be asked. */
async function fetchInThePit(): Promise<PersonInThePit[]> {
  const res = await fetch(`${apiPath("schedule")}/now?type=pit`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch who's in the pit (${res.status})`);
  return ((await res.json()) as { people: PersonInThePit[] }).people;
}

/**
 * Who's in the pit now: `false` while the team has Schedule off (show nothing), `null` until
 * Schedule has answered. Refreshed every minute; a failed refresh keeps what it last had.
 */
export function useInThePit(): PersonInThePit[] | null | false {
  const on = useAppOn("schedule");
  const [people, setPeople] = useState<PersonInThePit[] | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      if (document.visibilityState !== "visible" || !(await appOn("schedule"))) return;
      await fetchInThePit().then(
        (data) => current && setPeople(data),
        () => {},
      );
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  return on === false ? false : people;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "12:15" → "12:15 PM", in the viewer's own format. */
export function untilLabel(until: string): string {
  const [hour, minute] = until.split(":").map(Number);
  return clock.format(new Date(2000, 0, 1, hour, minute));
}

/** Schedule's home, where the team's event schedules are. */
export const scheduleUrl = () => appUrl("schedule");
