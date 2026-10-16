import { describe, expect, it } from "vitest";
import {
  activateKiosk,
  cookieFrom,
  createUser,
  createUserWithPin,
  g3id,
  sessionCookie,
  testEnv,
  unusedPin,
} from "./helpers";

describe("kiosk devices", () => {
  it("activates a device once with an admin's code", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const codeRes = await g3id("/admin/kiosk/codes", {
      method: "POST",
      cookie: admin,
      body: { deviceName: "Lathe" },
    });
    const { code } = (await codeRes.json()) as { code: string };
    expect(code).toMatch(/^\d{6}$/);

    const first = await g3id("/kiosk/activate", { method: "POST", body: { code } });
    expect(first.status).toBe(200);
    const { token } = (await first.json()) as { token: string };
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const again = await g3id("/kiosk/activate", { method: "POST", body: { code } });
    expect(again.status).toBe(400);

    const verify = await g3id("/kiosk/verify", { kioskToken: token });
    expect(await verify.json()).toMatchObject({ valid: true, deviceName: "Lathe" });
  });

  it("only lets admins make activation codes", async () => {
    const student = await sessionCookie(await createUser());
    const res = await g3id("/admin/kiosk/codes", {
      method: "POST",
      cookie: student,
      body: { deviceName: "Sneaky" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects expired codes and unknown tokens", async () => {
    const adminId = await createUser({ isAdmin: true });
    await testEnv.DB.prepare(
      "INSERT INTO kiosk_activation_codes (team_id, code, created_by, device_name, expires_at, created_at) SELECT team_id, '111111', id, 'Old', 1, 0 FROM core_users WHERE id = ?",
    )
      .bind(adminId)
      .run();
    expect(
      (await g3id("/kiosk/activate", { method: "POST", body: { code: "111111" } })).status,
    ).toBe(400);
    expect((await g3id("/kiosk/verify")).status).toBe(401);
    expect((await g3id("/kiosk/verify", { kioskToken: "nope" })).status).toBe(401);
  });

  it("stops working once an admin revokes it", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const token = await activateKiosk(admin);
    const devices = (await (await g3id("/admin/kiosk/devices", { cookie: admin })).json()) as {
      id: number;
      token: string;
    }[];
    const device = devices.find((d) => d.token === token);
    const revoke = await g3id(`/admin/kiosk/devices/${device?.id}`, {
      method: "DELETE",
      cookie: admin,
    });
    expect(revoke.status).toBe(200);
    expect((await g3id("/kiosk/verify", { kioskToken: token })).status).toBe(401);
  });
});

describe("kiosk PIN sign-in", () => {
  const signInWithPin = (pin: string, kioskToken?: string) =>
    g3id("/auth/pin", { method: "POST", kioskToken, body: { pin } });

  it("signs in with a PIN on an activated kiosk, as a PIN session", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const token = await activateKiosk(admin, "Mill");
    const { id, pin } = await createUserWithPin({ displayName: "Pat" });

    const res = await signInWithPin(pin, token);
    expect(res.status).toBe(200);
    const me = await g3id("/auth/me", { cookie: cookieFrom(res) as string });
    expect(await me.json()).toMatchObject({ id, sessionType: "pin", kioskDeviceName: "Mill" });
  });

  it("needs a kiosk token, a known PIN and an active user", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const token = await activateKiosk(admin);
    const { pin } = await createUserWithPin();
    const { pin: pendingPin } = await createUserWithPin({ status: "pending" });

    expect((await signInWithPin(pin)).status).toBe(401);
    expect((await signInWithPin(pin, "not-a-token")).status).toBe(401);
    expect((await signInWithPin(await unusedPin(), token)).status).toBe(400);
    expect((await signInWithPin(pendingPin, token)).status).toBe(403);
  });

  it("gives PIN sessions no admin or mentor powers", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const token = await activateKiosk(admin);
    const { pin } = await createUserWithPin({ isAdmin: true, isMentor: true });
    const cookie = cookieFrom(await signInWithPin(pin, token)) as string;

    expect(await (await g3id("/auth/me", { cookie })).json()).toMatchObject({
      isAdmin: false,
      isMentor: false,
    });
    const adminRoute = await g3id("/admin/users", { cookie });
    expect(adminRoute.status).toBe(403);
    expect(await adminRoute.json()).toEqual({ error: "Admin access not allowed from kiosk." });
  });

  it("lets a PIN session neither see nor change the PIN", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const token = await activateKiosk(admin);
    const { pin } = await createUserWithPin();
    const cookie = cookieFrom(await signInWithPin(pin, token)) as string;

    expect((await g3id("/auth/pin/me", { cookie })).status).toBe(403);
    expect((await g3id("/auth/pin/regenerate", { method: "POST", cookie })).status).toBe(403);
  });

  it("lets a normal session see and change its PIN", async () => {
    const { id, pin } = await createUserWithPin();
    const cookie = await sessionCookie(id);
    expect(await (await g3id("/auth/pin/me", { cookie })).json()).toEqual({ pin });
    const res = await g3id("/auth/pin/regenerate", { method: "POST", cookie });
    const { pin: newPin } = (await res.json()) as { pin: string };
    expect(newPin).toMatch(/^\d{3}$/);
    expect(await (await g3id("/auth/pin/me", { cookie })).json()).toEqual({ pin: newPin });
  });

  it("tells the app a PIN session's logout was a kiosk one", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const token = await activateKiosk(admin);
    const { pin } = await createUserWithPin();
    const res = await signInWithPin(pin, token);
    const logout = await g3id("/auth/logout", {
      method: "POST",
      cookie: cookieFrom(res) as string,
    });
    expect(await logout.json()).toEqual({ ok: true, isKiosk: true });
  });
});
