import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

export function KioskLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    const token = localStorage.getItem("kiosk_token");
    if (!token) {
      const redirect = searchParams.get("redirect");
      const path = redirect
        ? `/kiosk/activate?redirect=${encodeURIComponent(redirect)}`
        : "/kiosk/activate";
      navigate(path);
    }
  }, [navigate, searchParams]);

  async function submitPin(fullPin: string) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("kiosk_token");
      if (!token) {
        setError("No kiosk token found");
        setPin("");
        loadingRef.current = false;
        setLoading(false);
        return;
      }
      const body = JSON.stringify({ pin: fullPin });
      console.log("Submitting PIN:", { fullPin, token, apiBase, body });
      const res = await fetch(`${apiBase}/auth/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kiosk-Token": token,
        },
        body,
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("kiosk_token");
          const redirect = searchParams.get("redirect");
          const path = redirect
            ? `/kiosk/activate?redirect=${encodeURIComponent(redirect)}`
            : "/kiosk/activate";
          navigate(path);
          return;
        }
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Invalid PIN");
        setPin("");
        loadingRef.current = false;
        setLoading(false);
        return;
      }

      const redirect = searchParams.get("redirect") || "/";
      window.location.href = redirect;
    } catch (err) {
      setError("Login failed");
      setPin("");
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function addDigit(digit: string) {
    if (pin.length < 3 && !loading) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 3) {
        submitPin(newPin);
      }
    }
  }

  function removeDigit() {
    setPin(pin.slice(0, -1));
  }

  return (
    <div className="flex-1 bg-secondary-50 flex items-start justify-center px-4 pt-8">
      <div className="w-full max-w-xs space-y-3">
        <div className="text-center mb-2">
          <h1 className="text-3xl font-bold text-secondary-900">Enter PIN</h1>
        </div>

        <div className="flex justify-center gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-16 h-16 rounded-lg bg-white border-2 border-secondary-300 flex items-center justify-center"
            >
              <span className="text-3xl font-bold text-secondary-900">{pin[i] ? "●" : "○"}</span>
            </div>
          ))}
        </div>

        {error && <p className="text-primary-500 text-center text-sm font-medium">{error}</p>}

        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => addDigit(num.toString())}
              disabled={loading || pin.length >= 3}
              className="h-16 rounded-lg bg-white hover:bg-secondary-50 disabled:opacity-50 border border-secondary-300 text-secondary-900 text-2xl font-bold transition-colors active:bg-secondary-100"
            >
              {num}
            </button>
          ))}

          <button
            type="button"
            onClick={() => addDigit("0")}
            disabled={loading || pin.length >= 3}
            className="col-span-3 h-14 rounded-lg bg-white hover:bg-secondary-50 disabled:opacity-50 border border-secondary-300 text-secondary-900 text-xl font-bold transition-colors active:bg-secondary-100"
          >
            0
          </button>
        </div>

        <button
          type="button"
          onClick={removeDigit}
          disabled={loading || pin.length === 0}
          className="w-full h-12 rounded-lg bg-white hover:bg-secondary-50 disabled:opacity-50 border border-secondary-300 text-secondary-900 text-sm font-semibold transition-colors active:bg-secondary-100"
        >
          Clear
        </button>

        <Link
          to="/kiosk/remove"
          className="block text-center text-xs text-secondary-400 hover:text-secondary-800 transition-colors mt-2"
        >
          Remove Device
        </Link>
      </div>
    </div>
  );
}
