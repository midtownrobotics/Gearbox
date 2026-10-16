const REQUEST_TIMEOUT_MS = 3000;
const inFlight = new Map<string, Promise<unknown[]>>();

type FailureReason = "unavailable" | "not-found" | "timeout" | "invalid";
type CachedMatches =
  | { matches: unknown[] }
  | { error: string; reason?: FailureReason; status?: number };

export class StatboticsError extends Error {
  constructor(
    message: string,
    readonly reason: FailureReason = "unavailable",
    readonly status?: number,
  ) {
    super(message);
    this.name = "StatboticsError";
  }
}

export function statboticsFailureMessage(error: unknown, eventName: string) {
  if (!(error instanceof StatboticsError))
    return `Predictions for ${eventName} could not be loaded. Try refreshing.`;
  if (error.reason === "not-found") return `No Statbotics event page found for ${eventName}.`;
  if (error.reason === "timeout")
    return `Statbotics took too long to load ${eventName} predictions. Try again shortly.`;
  if (error.reason === "invalid")
    return `Statbotics returned unreadable predictions for ${eventName}. Try again shortly.`;
  const status = error.status
    ? ` (${error.status >= 500 ? "server error" : "error"} ${error.status})`
    : "";
  return `Statbotics couldn't load ${eventName} predictions${status}. Try again shortly.`;
}

/** Cache only public match data. A submitted pick must bypass the display cache. */
export async function statboticsMatches(eventKey: string, fresh = false): Promise<unknown[]> {
  const url = `https://api.statbotics.io/v3/matches?event=${encodeURIComponent(eventKey)}&limit=500`;
  const cache = await caches.open("scouting-statbotics");
  if (!fresh) {
    const cached = await cache.match(url);
    if (cached) {
      const result = await cached.json<CachedMatches>();
      if ("error" in result) throw new StatboticsError(result.error, result.reason, result.status);
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
        throw new StatboticsError(
          `Statbotics is temporarily unavailable (${response.status}). Try again shortly.`,
          response.status === 404 ? "not-found" : "unavailable",
          response.status,
        );
      const matches: unknown = await response.json();
      if (!Array.isArray(matches))
        throw new StatboticsError("Statbotics returned an unexpected response.", "invalid");
      await cache.put(
        url,
        Response.json({ matches }, { headers: { "Cache-Control": "max-age=30" } }),
      );
      return matches;
    } catch (cause) {
      const failure =
        cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
          ? new StatboticsError(
              "Statbotics took too long to respond. Try again shortly.",
              "timeout",
            )
          : cause instanceof StatboticsError
            ? cause
            : new StatboticsError("Statbotics could not be reached. Try again shortly.");
      // A short failure cache prevents every scout from repeatedly hitting a failing service.
      await cache.put(
        url,
        Response.json(
          { error: failure.message, reason: failure.reason, status: failure.status },
          { headers: { "Cache-Control": "max-age=10" } },
        ),
      );
      throw failure;
    }
  })();
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}
