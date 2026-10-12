import { Button, ErrorBanner, buttonClass, inputClass } from "@g3/ui";
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
          <h1 className="text-4xl text-secondary-900 mb-2">Activate Kiosk</h1>
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
              className={`${inputClass} !px-4 !py-3 text-center !text-2xl tracking-widest`}
            />
          </div>

          {error && <ErrorBanner message={error} />}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || code.length !== 6}
          >
            {loading ? "Activating…" : "Activate device"}
          </Button>

          <Link to="/" className={`${buttonClass("secondary", "lg")} w-full`}>
            Cancel
          </Link>
        </form>
      </div>
    </div>
  );
}
