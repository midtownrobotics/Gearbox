import { AlertCircle, Loader2 } from "lucide-react";
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
        setError("Admin login required.");
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
        <div className="text-center space-y-4">
          <Loader2 size={48} className="text-primary-500 mx-auto animate-spin" />
          <p className="text-secondary-900 text-lg font-semibold">Checking credentials...</p>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full flex items-center justify-center">
        <div className="bg-white border border-secondary-200 rounded-lg p-8 space-y-6 w-full text-center">
          <div className="space-y-2">
            <AlertCircle size={48} className="text-primary-500 mx-auto" />
            <h1 className="text-2xl font-bold text-secondary-900">Admin Access Required</h1>
            <p className="text-secondary-600">{error}</p>
          </div>

          {needsLogin && (
            <>
              <button
                type="button"
                onClick={handleLoginRedirect}
                className="block w-full py-3 px-4 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold transition-colors"
              >
                Proceed to Log In
              </button>

              <Link
                to="/kiosk/login"
                className="block text-sm text-secondary-400 hover:text-secondary-800 transition-colors"
              >
                Cancel
              </Link>
            </>
          )}

          {!needsLogin && (
            <Link
              to="/kiosk/login"
              className="block w-full py-3 px-4 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-secondary-900 font-semibold transition-colors"
            >
              Back to Kiosk Login
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full flex items-center justify-center">
      <div className="bg-white border border-secondary-200 rounded-lg p-8 space-y-6 w-full">
        <div className="text-center space-y-2">
          <AlertCircle size={48} className="text-primary-500 mx-auto" />
          <h1 className="text-2xl font-bold text-secondary-900">Remove Kiosk Device</h1>
          <p className="text-secondary-600">
            This action will permanently remove this device and clear its authentication.
          </p>
        </div>

        {error && (
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <p className="text-primary-500 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleRemoveDevice}
            disabled={loading}
            className="w-full py-3 px-4 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? "Removing Device..." : "Remove Device"}
          </button>

          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            disabled={loading}
            className="w-full py-3 px-4 rounded-lg bg-secondary-100 hover:bg-secondary-200 disabled:opacity-50 text-secondary-900 font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>

        <p className="text-xs text-secondary-500 text-center">
          You will be logged out after the device is removed.
        </p>
      </div>
    </main>
  );
}
