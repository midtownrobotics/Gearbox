import { Button, ErrorBanner, Loading, buttonClass } from "@g3/ui";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

export function KioskRemovePage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kioskDeviceId, setKioskDeviceId] = useState<number | null>(null);
  const [status, setStatus] = useState<"checking" | "ready" | "error">("checking");
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    const deviceIdStr = localStorage.getItem("kiosk_device_id");
    const deviceId = deviceIdStr ? Number.parseInt(deviceIdStr, 10) : null;

    if (!deviceId) {
      setStatus("error");
      setNeedsLogin(false);
      setError("Could not identify kiosk device.");
      return;
    }

    api.auth.me.$get().then(async (res) => {
      if (!res.ok) {
        setStatus("error");
        setNeedsLogin(true);
        setError("An admin has to sign in first.");
        return;
      }
      const data = (await res.json()) as { isAdmin?: boolean };
      if (!data.isAdmin) {
        setStatus("error");
        setNeedsLogin(false);
        setError("Admin access required to remove this device.");
        return;
      }
      setKioskDeviceId(deviceId);
      setStatus("ready");
    });
  }, []);

  function handleLoginRedirect() {
    const redirectUri = `${window.location.origin}/kiosk/remove`;
    navigate(`/login?redirect=${encodeURIComponent(redirectUri)}`);
  }

  async function handleRemoveDevice() {
    if (!kioskDeviceId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.admin.kiosk.devices[":id"].$delete({
        param: { id: kioskDeviceId.toString() },
      });

      if (!res.ok) {
        setError("Failed to remove device");
        setLoading(false);
        return;
      }

      // Remove kiosk token and device ID, then log out
      localStorage.removeItem("kiosk_token");
      localStorage.removeItem("kiosk_device_id");
      await api.auth.logout.$post();
      navigate("/kiosk/login");
    } catch (err) {
      setError("Failed to remove device");
      setLoading(false);
    }
  }

  if (status === "checking") {
    return (
      <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full flex items-center justify-center">
        <Loading />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full flex items-center justify-center">
        <div className="bg-surface border border-secondary-200 rounded-xl p-8 space-y-6 w-full text-center">
          <div className="space-y-2">
            <AlertCircle size={48} className="text-red-600 mx-auto" />
            <h1 className="text-4xl text-secondary-900">Admin Access Required</h1>
            <p className="text-secondary-600">{error}</p>
          </div>

          {needsLogin && (
            <>
              <Button size="lg" className="w-full" onClick={handleLoginRedirect}>
                Sign in
              </Button>

              <Link
                to="/kiosk/login"
                className="block text-sm text-secondary-400 hover:text-secondary-800 transition-colors"
              >
                Cancel
              </Link>
            </>
          )}

          {!needsLogin && (
            <Link to="/kiosk/login" className={`${buttonClass("secondary", "lg")} w-full`}>
              Back to kiosk sign-in
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full flex items-center justify-center">
      <div className="bg-surface border border-secondary-200 rounded-xl p-8 space-y-6 w-full">
        <div className="text-center space-y-2">
          <AlertCircle size={48} className="text-red-600 mx-auto" />
          <h1 className="text-4xl text-secondary-900">Remove Kiosk Device</h1>
          <p className="text-secondary-600">This permanently removes the device.</p>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="space-y-3">
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            onClick={handleRemoveDevice}
            disabled={loading}
          >
            {loading ? "Removing…" : "Remove device"}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => navigate("/kiosk/login")}
            disabled={loading}
          >
            Keep it
          </Button>
        </div>

        <p className="text-xs text-secondary-500 text-center">
          You will be signed out after the device is removed.
        </p>
      </div>
    </main>
  );
}
