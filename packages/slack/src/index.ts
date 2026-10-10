/** What the Slack app's bot needs in a workspace: commands, DMs, and members' names and emails. */
export const SLACK_BOT_SCOPES =
  "commands,chat:write,im:write,im:history,users:read,users:read.email";

export type SlackBindings = {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET?: string;
};

export async function sendDM(slackUserId: string, message: string, env: SlackBindings) {
  // Never accept channel IDs here. A DM must be addressed to a linked Slack user.
  if (!/^[UW][A-Z0-9]+$/.test(slackUserId)) {
    throw new Error("A valid linked Slack user ID is required for a direct message.");
  }

  const openResponse = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ users: slackUserId, return_im: true }),
  });
  const openResult = (await openResponse.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { id?: string; is_im?: boolean };
  };
  const dmChannelId = openResult.channel?.id;
  if (!openResult.ok || !dmChannelId || !openResult.channel?.is_im) {
    console.error("[Slack API Error] Could not open DM", {
      slackUserId,
      error: openResult.error,
    });
    throw new Error(`Slack API error: ${openResult.error ?? "could_not_open_dm"}`);
  }

  await sendMessage(dmChannelId, message, env);
}

export async function sendMessage(
  channel: string,
  message: string,
  env: SlackBindings,
): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text: message, unfurl_links: false, unfurl_media: false }),
  });

  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!data.ok) {
    console.error("[Slack API Error]", { channel, message, error: data.error });
    throw new Error(`Slack API error: ${data.error}`);
  }
}

export async function getUserInfo(
  slackUserId: string,
  env: SlackBindings,
): Promise<{ email: string | null; displayName: string }> {
  const res = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  });
  const data = (await res.json()) as {
    ok: boolean;
    user?: { real_name?: string; profile?: { email?: string; real_name?: string } };
  };
  if (!data.ok || !data.user) return { email: null, displayName: "Unknown" };
  return {
    email: data.user.profile?.email ?? null,
    displayName: data.user.profile?.real_name ?? data.user.real_name ?? "Unknown",
  };
}

export async function verifySlackSignature(
  request: Request,
  rawBody: string,
  env: SlackBindings,
): Promise<boolean> {
  const signature = request.headers.get("X-Slack-Signature");
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  if (!signature || !timestamp) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number.parseInt(timestamp, 10)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBase));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${hex}`;

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
