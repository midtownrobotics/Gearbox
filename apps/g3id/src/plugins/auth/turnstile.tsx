// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from "react";

// Cloudflare Turnstile's check, which someone signing up with Google or GitHub passes first
// (workers/g3id/src/lib/open-signup.ts). The script is loaded once, only on a page that shows it;
// `onToken` gets each token (null when it expires or fails), which the worker checks once.

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error()));
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile didn't load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function Turnstile({
  siteKey,
  onToken,
  onError,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The latest callbacks, so the widget isn't drawn again when they change.
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    let id: string | null = null;
    let gone = false;
    loadTurnstile()
      .then((api) => {
        if (gone || !box.current) return;
        id = api.render(box.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "error-callback": () => {
            handlers.current.onToken(null);
            handlers.current.onError();
          },
        });
      })
      .catch(() => handlers.current.onError());
    return () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey]);

  return <div ref={box} className="flex min-h-16 justify-center" />;
}
