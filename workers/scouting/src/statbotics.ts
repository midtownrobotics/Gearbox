const REQUEST_TIMEOUT_MS = 3000;
const inFlight = new Map<string, Promise<unknown[]>>();

type CachedMatches = { matches: unknown[] } | { error: string };

/** Cache only public match data. A submitted pick must bypass the display cache. */
export async function statboticsMatches(eventKey: string, fresh = false): Promise<unknown[]> {
  const url = `https://api.statbotics.io/v3/matches?event=${encodeURIComponent(eventKey)}&limit=500`;
  const cache = await caches.open("scouting-statbotics");
  if (!fresh) {
    const cached = await cache.match(url);
    if (cached) {
      const result = await cached.json<CachedMatches>();
      if ("error" in result) throw new Error(result.error);
      return result.matches;
    }
  }
  const pending = inFlight.get(url);
  if (pending) return pending;
  const request = (async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Gearbox-Strategy/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(
          `Statbotics is temporarily unavailable (${response.status}). Try again shortly.`,
        );
      const matches: unknown = await response.json();
      if (!Array.isArray(matches)) throw new Error("Statbotics returned an unexpected response.");
      await cache.put(
        url,
        Response.json({ matches }, { headers: { "Cache-Control": "max-age=30" } }),
      );
      return matches;
    } catch (cause) {
      const error =
        cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
          ? "Statbotics took too long to respond. Try again shortly."
          : cause instanceof Error
            ? cause.message
            : "Statbotics is unavailable. Try again shortly.";
      // A short failure cache prevents every scout from repeatedly hitting a failing service.
      await cache.put(
        url,
        Response.json({ error }, { headers: { "Cache-Control": "max-age=10" } }),
      );
      throw new Error(error);
    }
  })();
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}
