import { apiPath, appUrl, site } from "@g3/site-config";
import { useEffect, useId, useMemo, useRef, useState } from "react";

// Choosing one of the team's Slack channels by name (G3ID's /admin/slack/channels, through
// /api/~id; admins only). Gives back the channel's ID, which is what's saved. When the channels
// can't be listed (no Slack yet, or a connection from before the bot could read them), it says
// what to do and takes an ID typed in instead, so a page still works. Styled by
// slack-channel-picker.css: plain CSS, like the top bar, so it's the same in every app.

export type SlackChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  /** The bot is in it, so it can post there. */
  isMember: boolean;
};

type Listing =
  | { state: "loading" }
  | { state: "ready"; channels: SlackChannelOption[] }
  | { state: "unavailable"; code: string; error: string };

/** Asked once per page load and shared by every picker on the page. */
let listing: Promise<Listing> | null = null;

function loadChannels(): Promise<Listing> {
  listing ??= fetch(`${apiPath("id")}/admin/slack/channels`, { credentials: "include" })
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        channels?: SlackChannelOption[];
        code?: string;
        error?: string;
      };
      if (res.ok && data.channels) return { state: "ready", channels: data.channels } as const;
      return {
        state: "unavailable",
        code: data.code ?? "error",
        error: data.error ?? "Couldn't list your Slack channels.",
      } as const;
    })
    .catch(
      () =>
        ({
          state: "unavailable",
          code: "error",
          error: "Couldn't list your Slack channels.",
        }) as const,
    );
  // Try again next time if it failed for a reason that might pass.
  listing.then((l) => {
    if (l.state === "unavailable" && l.code !== "no_slack" && l.code !== "reconnect")
      listing = null;
  });
  return listing;
}

const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;
const SHOWN = 50;

export function SlackChannelPicker({
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

  function choose(channel: SlackChannelOption) {
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
      <div className="g3-slack-picker">
        <div className="g3-slack-chosen">
          <span className="g3-slack-name">
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
            className="g3-slack-button"
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
              className="g3-slack-button"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              Remove
            </button>
          )}
        </div>
        {chosen && !chosen.isMember && <NotInChannel name={chosen.name} />}
      </div>
    );
  }

  return (
    <div className="g3-slack-picker">
      <div className="g3-slack-search">
        <span className="g3-slack-hash" aria-hidden>
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
            className="g3-slack-button"
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
          className="g3-slack-options"
          // Scrolling the list mustn't take focus from the input (which would close it).
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.length === 0 && <div className="g3-slack-empty">No channel by that name.</div>}
          {matches.map((c, i) => (
            <div
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className="g3-slack-option"
              // Before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ChannelMark channel={c} />
              <span className="g3-slack-option-name">{c.name}</span>
              {!c.isMember && (
                <span className="g3-slack-option-note">{site.slackBotName} isn't in it</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelMark({ channel }: { channel: SlackChannelOption }) {
  return (
    <span className="g3-slack-hash" aria-label={channel.isPrivate ? "Private channel" : undefined}>
      {channel.isPrivate ? "🔒" : "#"}
    </span>
  );
}

function NotInChannel({ name }: { name: string }) {
  return (
    <p className="g3-slack-warning">
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
  const valid = !text.trim() || CHANNEL_ID.test(text.trim().toUpperCase());
  return (
    <div className="g3-slack-picker">
      <p className="g3-slack-warning">
        {list.error}{" "}
        {(list.code === "no_slack" || list.code === "reconnect") && (
          <a href={integrations}>Go to Integrations</a>
        )}
      </p>
      <input
        id={inputId}
        className="g3-slack-id"
        placeholder="Or enter the channel ID, like C0123456789"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const id = e.target.value.trim().toUpperCase();
          if (!id) onChange(null);
          else if (CHANNEL_ID.test(id)) onChange(id);
        }}
      />
      {!valid && <p className="g3-slack-error">A channel ID starts with C or G.</p>}
    </div>
  );
}
