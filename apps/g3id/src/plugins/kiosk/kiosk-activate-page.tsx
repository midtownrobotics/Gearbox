import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

export function KioskActivatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("kiosk_token");
    if (savedToken) {
      const redirect = searchParams.get("redirect");
      const path = redirect
        ? `/kiosk/login?redirect=${encodeURIComponent(redirect)}`
        : "/kiosk/login";
      navigate(path);
    }
  }, [navigate, searchParams]);

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${apiBase}/kiosk/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Activation failed");
        return;
      }

      const data = (await res.json()) as { token: string; deviceId?: number };
      localStorage.setItem("kiosk_token", data.token);
      if (data.deviceId) {
        localStorage.setItem("kiosk_device_id", data.deviceId.toString());
      }
      const redirect = searchParams.get("redirect");
      const path = redirect
        ? `/kiosk/login?redirect=${encodeURIComponent(redirect)}`
        : "/kiosk/login";
      navigate(path);
    } catch (err) {
      setError("Failed to activate device");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-secondary-900 mb-2">Activate Kiosk</h1>
          <p className="text-secondary-600">Enter the 6-digit code from your admin</p>
        </div>

        <form onSubmit={handleActivate} className="space-y-6">
          <div>
            <label
              htmlFor="activation-code"
              className="block text-sm font-medium text-secondary-700 mb-2"
            >
              Activation Code
            </label>
            <input
              id="activation-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full px-4 py-3 text-center text-2xl tracking-widest rounded-lg bg-surface border border-secondary-300 text-secondary-900 placeholder-secondary-400 focus:outline-none focus:border-primary-500"
            />
          </div>

          {error && <p className="text-primary-500 text-center text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full py-3 px-4 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
          >
            {loading ? "Activating..." : "Activate Device"}
          </button>

          <Link
            to="/"
            className="block text-center py-3 px-4 rounded-lg bg-surface border border-secondary-300 hover:bg-secondary-50 text-secondary-900 font-semibold transition-colors"
          >
            Cancel
          </Link>
        </form>
      </div>
    </div>
  );
}
