import { appUrl } from "@g3/site-config";
import { Button, Card, ConfirmButton, ErrorBanner, Field, Loading, Page, inputClass } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type ActivationCode = {
  code: string;
  expiresAt: number;
};

type KioskDevice = {
  id: number;
  name: string;
  token: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

export function AdminKioskPage() {
  const [deviceName, setDeviceName] = useState("");
  const [code, setCode] = useState<ActivationCode | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  const [devices, setDevices] = useState<KioskDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  async function loadDevices() {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const res = await api.admin.kiosk.devices.$get();
      if (!res.ok) {
        setDevicesError("Failed to load devices");
        return;
      }
      const data = (await res.json()) as KioskDevice[];
      setDevices(data);
    } catch {
      setDevicesError("Failed to load devices");
    } finally {
      setDevicesLoading(false);
    }
  }

  /** Whether the team allows kiosk PINs (its Sign-in page); null while asking. */
  const [kioskOn, setKioskOn] = useState<boolean | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadDevices changes on every render but we only want to load once on mount
  useEffect(() => {
    api.team["sign-in"]
      .$get()
      .then((res) => (res.ok ? res.json() : { pin: true }))
      .then((methods) => {
        setKioskOn(methods.pin !== false);
        if (methods.pin !== false) loadDevices();
      })
      .catch(() => {
        setKioskOn(true);
        loadDevices();
      });
  }, []);

  async function handleGenerateCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeError(null);
    setCodeLoading(true);

    try {
      const res = await api.admin.kiosk.codes.$post({
        json: { deviceName },
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setCodeError(data.error ?? "Failed to generate code");
        return;
      }

      const data = (await res.json()) as ActivationCode;
      setCode(data);
      setDeviceName("");
    } catch {
      setCodeError("Failed to generate code");
    } finally {
      setCodeLoading(false);
    }
  }

  async function handleRevokeDevice(deviceId: number) {
    try {
      const res = await api.admin.kiosk.devices[":id"].$delete({
        param: { id: deviceId.toString() },
      });

      if (!res.ok) {
        setDevicesError("Couldn't revoke the device. Try again.");
        return;
      }

      await loadDevices();
    } catch {
      setDevicesError("Couldn't revoke the device. Check your connection and try again.");
    }
  }

  if (kioskOn === null) return null;
  if (!kioskOn) {
    return (
      <Page title="Kiosk Devices" width="narrow">
        <p className="text-secondary-600">
          Kiosk sign-in is off for your team, so kiosks can't be added or used. Turn it on from the{" "}
          <a
            href={`${appUrl("portal")}/admin/sign-in`}
            className="font-semibold text-primary-600 underline"
          >
            Sign-in page
          </a>
          .
        </p>
      </Page>
    );
  }

  return (
    <Page title="Kiosk Devices" width="narrow">
      <Card title="Add a kiosk">
        <form onSubmit={handleGenerateCode} className="space-y-4">
          <Field label="Device name">
            <input
              type="text"
              placeholder="e.g., Shop Register 1"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Button type="submit" className="w-full" disabled={codeLoading || !deviceName.trim()}>
            {codeLoading ? "Making a code…" : "Make an activation code"}
          </Button>
        </form>

        {codeError && (
          <div className="mt-3">
            <ErrorBanner message={codeError} />
          </div>
        )}

        {code && (
          <div className="mt-4 rounded-lg border border-secondary-300 p-4 space-y-3">
            <div>
              <p className="text-xs text-secondary-600 mb-1">Activation code (expires in 30 min)</p>
              <p className="text-3xl font-mono font-bold text-primary-500 tracking-widest text-center">
                {code.code}
              </p>
            </div>
            <p className="text-xs text-secondary-600 text-center">
              Expires: {new Date(code.expiresAt * 1000).toLocaleString()}
            </p>
            <Button variant="secondary" className="w-full" onClick={() => setCode(null)}>
              Make another code
            </Button>
          </div>
        )}
      </Card>

      <Card title="Devices">
        {devicesError && (
          <div className="mb-3">
            <ErrorBanner message={devicesError} />
          </div>
        )}

        {devicesLoading ? (
          <Loading />
        ) : devices.length === 0 ? (
          <p className="text-sm text-secondary-500">
            No kiosks yet. Make an activation code above and enter it on the device.
          </p>
        ) : (
          <div className="space-y-3">
            {devices.map((device) => (
              <div
                key={device.id}
                className="border border-secondary-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-secondary-900">{device.name}</p>
                  <p className="text-xs text-secondary-600 mt-1">
                    Created {new Date(device.createdAt * 1000).toLocaleDateString()}
                  </p>
                  {device.lastUsedAt && (
                    <p className="text-xs text-secondary-600">
                      Last used {new Date(device.lastUsedAt * 1000).toLocaleString()}
                    </p>
                  )}
                  {device.revokedAt && (
                    <p className="text-xs text-red-700 font-medium">
                      Revoked {new Date(device.revokedAt * 1000).toLocaleString()}
                    </p>
                  )}
                </div>

                {!device.revokedAt && (
                  <ConfirmButton
                    size="sm"
                    label="Revoke"
                    question={`Revoke ${device.name}? It will need a new activation code to be a kiosk again.`}
                    onConfirm={() => void handleRevokeDevice(device.id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
