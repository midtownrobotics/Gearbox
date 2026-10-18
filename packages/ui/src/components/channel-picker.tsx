import { apiPath, appUrl, site } from "@g3/site-config";
import { useEffect, useId, useMemo, useRef, useState } from "react";

// Choosing one of the team's channels by name, on its chat: Slack or Discord, whichever it uses
// (G3ID's /admin/chat/channels, through /api/~id; admins only). Gives back the channel's ID,
// which is what's saved. When the channels can't be listed (no chat yet, or a Slack connection
// from before the bot could read them), it says what to do and takes an ID typed in instead, so a
// page still works. Styled by channel-picker.css: plain CSS, like the top bar, so it's the same in
// every app.

export type ChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  /** The bot can post there (Slack: it's in the channel). */
  canPost: boolean;
};

type Provider = "slack" | "discord";

type Listing =
  | { state: "loading" }
  | { state: "ready"; provider: Provider; channels: ChannelOption[] }
  | { state: "unavailable"; code: string; error: string };

/** Asked once per page load and shared by every picker on the page. */
let listing: Promise<Listing> | null = null;

function loadChannels(): Promise<Listing> {
  listing ??= fetch(`${apiPath("id")}/admin/chat/channels`, { credentials: "include" })
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        provider?: Provider;
        channels?: ChannelOption[];
        code?: string;
        error?: string;
      };
      if (res.ok && data.channels && data.provider) {
        return { state: "ready", provider: data.provider, channels: data.channels } as const;
      }
      return {
        state: "unavailable",
        code: data.code ?? "error",
        error: data.error ?? "Couldn't list your team's channels.",
      } as const;
    })
    .catch(
      () =>
        ({
          state: "unavailable",
          code: "error",
          error: "Couldn't list your team's channels.",
        }) as const,
    );
  // Try again next time if it failed for a reason that might pass.
  listing.then((l) => {
    if (l.state === "unavailable" && l.code !== "no_chat" && l.code !== "reconnect") listing = null;
  });
  return listing;
}

/**
 * A channel ID: Slack's (C or G, then 8 or more capitals and digits: C0123456789) or Discord's
 * (17 to 20 digits).
 */
const CHANNEL_ID = /^(?:[CG][A-Z0-9]{8,}|\d{17,20})$/;
const SHOWN = 50;

export function ChannelPicker({
  value,
  onChange,
  id,
  clearable = true,
  disabled,
}: {
  /** The chosen channel's ID, or "" / null for none. */
  value: string | null;
  onChange: (channelId: string | null) => void;
  /** For a <label htmlFor>. */
  id?: string;
  /** Whether "Remove" is offered (false when a channel is required). */
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [list, setList] = useState<Listing>({ state: "loading" });
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ownId = useId();
  const inputId = id ?? `${ownId}-input`;
  const listId = `${ownId}-list`;

  useEffect(() => {
    let live = true;
    loadChannels().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);

  const channels = list.state === "ready" ? list.channels : [];
  const chosen = value ? channels.find((c) => c.id === value) : undefined;

  const matches = useMemo(() => {
    const q = query.trim().replace(/^#/, "").toLowerCase();
    const found = q
      ? channels
          .filter((c) => c.name.includes(q))
          // Names that start with what's typed first.
          .sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)))
      : channels;
    return found.slice(0, SHOWN);
  }, [channels, query]);

  function choose(channel: ChannelOption) {
    onChange(channel.id);
    setEditing(false);
    setOpen(false);
    setQuery("");
  }

  if (list.state === "unavailable") {
    return <Fallback {...{ value, onChange, inputId, list, disabled }} />;
  }

  if (value && !editing) {
    return (
      <div className="g3-channel-picker">
        <div className="g3-channel-chosen">
          <span className="g3-channel-name">
            {list.state === "loading" ? (
              "Loading…"
            ) : chosen ? (
              <>
                <ChannelMark channel={chosen} />
                {chosen.name}
              </>
            ) : (
              <>A channel Gearbox can't see ({value})</>
            )}
          </span>
          <button
            type="button"
            className="g3-channel-button"
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              setOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Change
          </button>
          {clearable && (
            <button
              type="button"
              className="g3-channel-button"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              Remove
            </button>
          )}
        </div>
        {chosen && !chosen.canPost && list.state === "ready" && (
          <CantPost name={chosen.name} provider={list.provider} />
        )}
      </div>
    );
  }

  return (
    <div className="g3-channel-picker">
      <div className="g3-channel-search">
        <span className="g3-channel-hash" aria-hidden>
          #
        </span>
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          disabled={disabled || list.state === "loading"}
          placeholder={list.state === "loading" ? "Loading channels…" : "Search channels"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && matches[active]) choose(matches[active]);
            } else if (e.key === "Escape") {
              if (open) setOpen(false);
              else if (value) setEditing(false);
            }
          }}
        />
        {editing && value && (
          <button
            type="button"
            className="g3-channel-button"
            onClick={() => {
              setEditing(false);
              setQuery("");
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {open && list.state === "ready" && (
        // The input keeps focus (aria-activedescendant); -1 only so the roles count as focusable.
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="g3-channel-options"
          // Scrolling the list mustn't take focus from the input (which would close it).
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.length === 0 && <div className="g3-channel-empty">No channel by that name.</div>}
          {matches.map((c, i) => (
            <div
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className="g3-channel-option"
              // Before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ChannelMark channel={c} />
              <span className="g3-channel-option-name">{c.name}</span>
              {!c.canPost && (
                <span className="g3-channel-option-note">
                  {botName(list.provider)} can't post here
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelMark({ channel }: { channel: ChannelOption }) {
  return (
    <span
      className="g3-channel-hash"
      aria-label={channel.isPrivate ? "Private channel" : undefined}
    >
      {channel.isPrivate ? "🔒" : "#"}
    </span>
  );
}

const botName = (provider: Provider) =>
  provider === "slack" ? site.slackBotName : site.discordBotName;

function CantPost({ name, provider }: { name: string; provider: Provider }) {
  if (provider === "discord") {
    return (
      <p className="g3-channel-warning">
        {site.discordBotName} can't post in #{name} yet, so messages won't arrive. In Discord, edit
        the channel's permissions so {site.discordBotName} can view the channel and send messages.
      </p>
    );
  }
  return (
    <p className="g3-channel-warning">
      {site.slackBotName} isn't in #{name} yet, so messages won't arrive. In Slack, open the channel
      and type <code>/invite @{site.slackBotName}</code>.
    </p>
  );
}

/** When the channels can't be listed: why, and a box for the channel's ID. */
function Fallback({
  value,
  onChange,
  inputId,
  list,
  disabled,
}: {
  value: string | null;
  onChange: (channelId: string | null) => void;
  inputId: string;
  list: Extract<Listing, { state: "unavailable" }>;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const integrations = `${appUrl("portal")}/admin/integrations`;
  const valid = !text.trim() || CHANNEL_ID.test(text.trim());
  return (
    <div className="g3-channel-picker">
      <p className="g3-channel-warning">
        {list.error}{" "}
        {(list.code === "no_chat" || list.code === "reconnect") && (
          <a href={integrations}>Go to Integrations</a>
        )}
      </p>
      <input
        id={inputId}
        className="g3-channel-id"
        placeholder="Or enter the channel's ID"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const id = e.target.value.trim();
          if (!id) onChange(null);
          else if (CHANNEL_ID.test(id)) onChange(id);
        }}
      />
      {!valid && (
        <p className="g3-channel-error">
          That isn't a channel ID. In Slack it's in the channel's details; in Discord, right-click
          the channel and choose Copy Channel ID.
        </p>
      )}
    </div>
  );
}
