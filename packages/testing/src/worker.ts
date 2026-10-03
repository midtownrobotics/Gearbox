import { exports } from "cloudflare:workers";
import { type TestUser, asUser } from "./users";

// Requests to the worker under test (its default export), from inside the Workers runtime.

const worker = () => (exports as unknown as { default: Fetcher }).default;

/** A request to the worker under test. */
export function call(path: string, init?: RequestInit): Promise<Response> {
  return worker().fetch(new Request(`http://worker.test${path}`, init));
}

/** A request signed in as `user`; a non-string `body` is sent as JSON. */
export function callAs(
  user: TestUser,
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<Response> {
  return call(path, asUser(user, init));
}

/** The JSON body of a request signed in as `user`, failing the test unless the status is `status`. */
export async function jsonAs<T = unknown>(
  user: TestUser,
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
  status = 200,
): Promise<T> {
  const res = await callAs(user, path, init);
  if (res.status !== status) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: expected ${status}, got ${res.status}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}
