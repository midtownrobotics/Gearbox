import { TextField } from "@g3/ui";
import { useEffect, useId, useState } from "react";
import { api } from "./api";
import { clearInputError, showTeamNumberError } from "./input-validation";

type TeamSuggestion = { number: string; name: string };
const teamSearchCache = new Map<string, { teams: TeamSuggestion[]; message?: string | null }>();

export function TeamLookupInput({
  value,
  onChange,
  required = true,
  placeholder = "Team number or name",
  inputMode = "search",
  readOnly = false,
  size = "md",
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  inputMode?: "numeric" | "search";
  readOnly?: boolean;
  size?: "md" | "lg";
}) {
  const [query, setQuery] = useState(value);
  const [teams, setTeams] = useState<TeamSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const listId = useId();

  useEffect(() => {
    if (value === query) return;
    if (readOnly || /^\d+$/.test(value)) setQuery(value);
  }, [value, query, readOnly]);

  useEffect(() => {
    const search = query.trim();
    if (!search) {
      setTeams([]);
      setMessage("");
      setSelectedName("");
      return;
    }
    const timer = window.setTimeout(() => {
      const cached = teamSearchCache.get(search.toLowerCase());
      if (cached) {
        setTeams(cached.teams);
        setMessage(cached.message ?? "");
        const exact = cached.teams.find((team) => team.number === value);
        setSelectedName(exact?.name ?? "");
        return;
      }
      api<{ teams: TeamSuggestion[]; message?: string | null }>(
        `/teams/search?q=${encodeURIComponent(search)}`,
      )
        .then(({ teams: matches, message }) => {
          if (teamSearchCache.size >= 100)
            teamSearchCache.delete(teamSearchCache.keys().next().value ?? "");
          teamSearchCache.set(search.toLowerCase(), { teams: matches, message });
          setTeams(matches);
          setMessage(message ?? "");
          const exact = matches.find((team) => team.number === value);
          setSelectedName(exact?.name ?? "");
        })
        .catch(() => {
          setTeams([]);
          setMessage("Could not load teams from TBA.");
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, value]);

  return (
    <div className="team-lookup">
      <TextField
        typeable
        className={`team-number-input ${size === "lg" ? "!text-3xl" : ""}`}
        list={listId}
        required={required}
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setSelectedName("");
          setMessage("");
          onChange(/^\d+$/.test(next.trim()) ? next.trim() : "");
        }}
        onInput={clearInputError}
        onInvalid={showTeamNumberError}
        placeholder={placeholder}
        inputMode={inputMode}
        enterKeyHint="next"
        autoComplete="off"
        readOnly={readOnly}
      />
      <datalist id={listId}>
        {teams.map((team) => (
          <option value={team.number} key={team.number}>
            {team.name}
          </option>
        ))}
      </datalist>
      {selectedName && <span className="selected-team-name">{selectedName}</span>}
      {message && !selectedName && <span className="team-suggestion-message">{message}</span>}
    </div>
  );
}
