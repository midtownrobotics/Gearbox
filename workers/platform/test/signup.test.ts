import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { platformUrl, site, teamKey } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";

// Team sign-up (roadmap 2.7). G3ID and Slack are stubbed in vitest.config.mts.

const call = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  exports.default.fetch(
    new Request(`http://platform/api${path}`, {
      redirect: "manual",
      ...init,
      headers: init.json === undefined ? init.headers : { "Content-Type": "application/json" },
      body: init.json === undefined ? init.body : JSON.stringify(init.json),
    }),
  );

const newNumber = () => 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000);

const details = (teamNumber: number) => ({
  teamNumber,
  name: "The Testers",
  country: "us",
  timeZone: "America/Chicago",
  acceptTerms: true,
});

async function signUp(teamNumber: number): Promise<string> {
  const res = await call("/signup", { method: "POST", json: details(teamNumber) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { signupId: string }).signupId;
}

/** Slack's "Add to Slack" for the sign-up, with the workspace it picks. */
async function connectSlack(signupId: string, workspace: string) {
  const start = await call(`/signup/${signupId}/slack`);
  const slack = new URL(start.headers.get("Location") as string);
  expect(slack.searchParams.get("redirect_uri")).toBe(`${platformUrl}/api/signup/slack/callback`);
  return call(
    `/signup/slack/callback?code=ws:${workspace}&state=${slack.searchParams.get("state")}`,
  );
}

const testEnv = env as unknown as AppEnv["Bindings"];

const team = (teamNumber: number) =>
  testEnv.PLATFORM_DB.prepare("SELECT * FROM teams WHERE team_number = ?").bind(teamNumber).first();

describe("signing a team up", () => {
  it("takes the team's details, its Slack, and its founder's code, then signs them in", async () => {
    const number = newNumber();
    const signupId = await signUp(number);
    expect(await (await call(`/signup/${signupId}`)).json()).toMatchObject({
      teamNumber: number,
      step: "slack",
    });
    // Pending teams have no addresses yet.
    expect((await call(`/teams/frc${number}`)).status).toBe(404);

    const back = await connectSlack(signupId, "TNEW1");
    expect(back.headers.get("Location")).toBe(`${platformUrl}/signup?id=${signupId}`);
    expect(await (await call(`/signup/${signupId}`)).json()).toMatchObject({
      step: "code",
      workspaceName: "Workspace TNEW1",
    });

    const code = await call(`/signup/${signupId}/code`, { method: "POST" });
    expect(await code.json()).toEqual({ code: "1234" });
    expect(await (await call(`/signup/${signupId}/status`)).json()).toEqual({ status: "pending" });

    const done = (await (await call(`/signup/${signupId}/status`)).json()) as {
      status: string;
      signInUrl: string;
    };
    expect(done.status).toBe("done");
    const signIn = new URL(done.signInUrl);
    expect(signIn.origin).toBe(`https://${number}-id.${site.platformDomain}`);
    expect(signIn.pathname).toBe("/api/auth/slack/complete");
    expect(signIn.searchParams.get("redirect")).toBe(`https://${number}.${site.platformDomain}/`);

    expect(await team(number)).toMatchObject({
      status: "active",
      founder_user_id: "u-founder",
      country: "US",
      time_zone: "America/Chicago",
    });
    expect(await (await call(`/teams/frc${number}`)).json()).toMatchObject({ teamNumber: number });
  });

  it("checks the details and the terms", async () => {
    for (const bad of [
      { teamNumber: 0 },
      { name: "" },
      { country: "USA" },
      { timeZone: "Mars/Olympus" },
      { acceptTerms: false },
    ]) {
      const res = await call("/signup", {
        method: "POST",
        json: { ...details(newNumber()), ...bad },
      });
      expect(res.status).toBe(400);
    }
  });

  it("won't sign up a team that's already on the platform", async () => {
    const res = await call("/signup", { method: "POST", json: details(site.team.number) });
    expect(res.status).toBe(409);
    expect(await (await call(`/teams/${teamKey}`)).json()).toMatchObject({
      teamNumber: site.team.number,
    });
  });

  it("lets only one person at a time take a team number past Slack", async () => {
    const number = newNumber();
    const first = await signUp(number);
    // Before Slack, a new attempt takes over (the first may have given up).
    const second = await signUp(number);
    expect((await call(`/signup/${first}`)).status).toBe(404);
    await connectSlack(second, "TNEW2");
    const third = await call("/signup", { method: "POST", json: details(number) });
    expect(third.status).toBe(409);
  });

  it("won't connect a workspace that's another team's", async () => {
    const signupId = await signUp(newNumber());
    const back = await connectSlack(signupId, "TTAKEN");
    expect(back.headers.get("Location")).toContain("error=");
    expect(await (await call(`/signup/${signupId}`)).json()).toMatchObject({ step: "slack" });
  });

  it("needs Slack before the code", async () => {
    const signupId = await signUp(newNumber());
    expect((await call(`/signup/${signupId}/code`, { method: "POST" })).status).toBe(409);
  });
});

describe("reporting a falsely registered team number", () => {
  const report = (body: Record<string, unknown>) =>
    call("/reports", {
      method: "POST",
      json: {
        teamNumber: 254,
        email: "mentor@example.org",
        message: "I'm a mentor on this team, and we didn't sign up.",
        ...body,
      },
    });

  it("keeps the report and the email to reach the reporter at", async () => {
    const number = newNumber();
    expect((await report({ teamNumber: number, name: "Pat" })).status).toBe(201);
    const saved = await testEnv.PLATFORM_DB.prepare(
      "SELECT email, name, message, status FROM number_reports WHERE team_number = ?",
    )
      .bind(number)
      .first();
    expect(saved).toEqual({
      email: "mentor@example.org",
      name: "Pat",
      message: "I'm a mentor on this team, and we didn't sign up.",
      status: "open",
    });
  });

  it("needs a team number, an email and a message", async () => {
    for (const bad of [{ teamNumber: "x" }, { email: "not-an-email" }, { message: "  " }]) {
      expect((await report(bad)).status).toBe(400);
    }
  });

  it("stops taking reports for a number once plenty are open", async () => {
    const number = newNumber();
    for (let i = 0; i < 20; i++) expect((await report({ teamNumber: number })).status).toBe(201);
    expect((await report({ teamNumber: number })).status).toBe(429);
  });
});
