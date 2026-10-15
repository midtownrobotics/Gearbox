import { redirectToSignIn } from "@g3/ui";
import type { ScheduleApp } from "@g3/worker-schedule";
import { type InferResponseType, hc } from "hono/client";

export const api = hc<ScheduleApp>(import.meta.env.VITE_API_BASE_URL ?? "", {
  init: { credentials: "include" },
});

/** Off to the team's ID sign-in page, coming back here (the same for every app). */
export function redirectToLogin(): void {
  redirectToSignIn();
}

export async function getErrorMessage(res: {
  status: number;
  json(): Promise<unknown>;
}): Promise<string> {
  if (res.status === 401) {
    redirectToLogin();
    return "Redirecting to sign in…";
  }
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `Request failed (${res.status}).`;
}

/**
 * A call's JSON, or an error with the message to show: what every page does with an answer.
 * `getErrorMessage` sends a signed-out member to sign in.
 */
export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(
  call: Promise<R>,
): Promise<Answer<R>> {
  const res = await call;
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return (await res.json()) as Answer<R>;
}

/** What a call answers when it works: its JSON, without the error shapes. */
type Answer<R extends { json(): Promise<unknown> }> = Exclude<
  Awaited<ReturnType<R["json"]>>,
  { error: string }
>;

export type ScheduleDetail = InferResponseType<(typeof api.schedules)[":id"]["$get"], 200>;
export type ScheduleListItem = InferResponseType<(typeof api.schedules)["$get"], 200>[number];
export type Role = ScheduleDetail["roles"][number];
export type Attendee = ScheduleDetail["attendees"][number];
export type Range = ScheduleDetail["assignments"][number];
export type Period = ScheduleDetail["periods"][number];
export type Day = ScheduleDetail["days"][number];
export type Member = InferResponseType<(typeof api.members)["$get"], 200>[number];
export type Change = {
  userIds: string[];
  day: string;
  start: number;
  end: number;
  roleId: number | null;
};
export type Friend = InferResponseType<(typeof api.friends)["$get"], 200>[number];
export type Person = InferResponseType<(typeof api.friends.people)["$get"], 200>[number];
