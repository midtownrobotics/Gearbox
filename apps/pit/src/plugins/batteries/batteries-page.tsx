import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Field,
  Loading,
  Page,
  focusRing,
  inputClass,
} from "@g3/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { ElapsedTime, STATE_TONES, voltageColor } from "../../shared/battery-display";
import { generateBatteryAndStatesPDF } from "../../shared/generate-state-labels";
import { fetchBatteries } from "../../shared/getters/batteries";
import type { Battery, BatteryState } from "../../shared/getters/types";

const POLL_INTERVAL_MS = 10_000;

const STATE_ORDER: Record<BatteryState, number> = {
  "In Robot": 0,
  "Next Up": 1,
  Charging: 2,
  Idle: 3,
  Broken: 4,
};

const STATES: BatteryState[] = ["Charging", "Next Up", "In Robot", "Idle", "Broken"];

const STATE_LABELS = [
  { code: "ST-IDLE", label: "Idle" },
  { code: "ST-CHAR", label: "Charging" },
  { code: "ST-NXUP", label: "Next Up" },
  { code: "ST-BRKN", label: "Broken" },
  { code: "ST-ROBT", label: "In Robot" },
];

const textButton = `rounded text-xs font-semibold text-secondary-500 underline hover:text-secondary-900 ${focusRing}`;

function sortBatteries(batteries: Battery[]): Battery[] {
  return [...batteries].sort((a, b) => {
    const orderDiff = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (orderDiff !== 0) return orderDiff;
    return a.stateSince - b.stateSince;
  });
}

/** One battery at the top of the page: the one in the robot, the next one, the longest charging. */
function SummaryTile({
  label,
  battery,
  voltage = false,
}: { label: string; battery: Battery; voltage?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${STATE_TONES[battery.state]}`}>
      <p className="mb-1 text-xs font-bold uppercase tracking-widest">{label}</p>
      <p className="text-base font-bold text-secondary-900">{battery.name}</p>
      <p className="text-xs text-secondary-600">
        <ElapsedTime sinceMs={battery.stateSince} />
      </p>
      {voltage && battery.voltage != null && (
        <p className={`mt-0.5 font-mono text-xs ${voltageColor(battery.voltage)}`}>
          {battery.voltage.toFixed(2)}V
        </p>
      )}
    </div>
  );
}

export function BatteriesPage() {
  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  // Something to check that isn't an error: a voltage outside the range for a match.
  const [warning, setWarning] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");

  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());
  const [editingVoltageId, setEditingVoltageId] = useState<number | null>(null);
  const [voltageInput, setVoltageInput] = useState("");

  const [showLabelsModal, setShowLabelsModal] = useState(false);
  const [selectedForLabels, setSelectedForLabels] = useState<Set<number>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [generatingLabels, setGeneratingLabels] = useState(false);

  const voltageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchBatteries()
      .then(setBatteries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    let requestInFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      try {
        setBatteries(await fetchBatteries());
      } catch {
        // Keep the last successful data visible while a refresh fails.
      } finally {
        requestInFlight = false;
      }
    };
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loading]);

  useEffect(() => {
    if (editingVoltageId !== null) voltageInputRef.current?.focus();
  }, [editingVoltageId]);

  async function handleAddBattery() {
    if (!newName.trim()) {
      setAddError("Name is required.");
      return;
    }
    const res = await api.batteries.$post({ json: { name: newName.trim() } });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setAdding(false);
    setNewName("");
    setAddError("");
    setBanner(null);
    fetchBatteries()
      .then(setBatteries)
      .catch(() => {});
  }

  async function handleDeleteBattery(id: number) {
    setBatteries((prev) => prev.filter((b) => b.id !== id));
    const res = await api.batteries[":id"].$delete({ param: { id: String(id) } });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      fetchBatteries()
        .then(setBatteries)
        .catch(() => {});
    }
  }

  async function handleSetState(battery: Battery, state: BatteryState) {
    if (battery.state === state) return;
    // Switching to a state without voltage closes the editor
    const nextHasVoltage = state === "In Robot" || state === "Next Up";
    if (editingVoltageId === battery.id && !nextHasVoltage) {
      setEditingVoltageId(null);
      setVoltageInput("");
    }
    const tracksVoltage = state === "In Robot" || state === "Next Up";
    const enteringRobot = state === "In Robot" && battery.state !== "In Robot";
    setUpdatingIds((prev) => new Set(prev).add(battery.id));
    setBatteries((prev) =>
      prev.map((b) =>
        b.id === battery.id
          ? {
              ...b,
              state,
              stateSince: Date.now(),
              ...(!tracksVoltage ? { voltage: null } : {}),
              ...(enteringRobot ? { useCount: b.useCount + 1 } : {}),
            }
          : b,
      ),
    );
    const res = await api.batteries[":id"].state.$patch({
      param: { id: String(battery.id) },
      json: { state },
    });
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(battery.id);
      return next;
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      fetchBatteries()
        .then(setBatteries)
        .catch(() => {});
    }
  }

  async function handleSetVoltage(battery: Battery) {
    const v = Number.parseFloat(voltageInput);
    if (voltageInput.trim() !== "" && Number.isNaN(v)) {
      setBanner("Voltage must be a number.");
      return;
    }
    const voltage = voltageInput.trim() === "" ? null : v;
    setBanner(null);
    setWarning(
      voltage !== null && (voltage < 12.8 || voltage > 14)
        ? "Warning: voltage should be between 12.8V and 14V for a battery going in the robot."
        : null,
    );
    setEditingVoltageId(null);
    setVoltageInput("");
    setBatteries((prev) => prev.map((b) => (b.id === battery.id ? { ...b, voltage } : b)));
    const res = await api.batteries[":id"].voltage.$patch({
      param: { id: String(battery.id) },
      json: { voltage },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      fetchBatteries()
        .then(setBatteries)
        .catch(() => {});
    }
  }

  async function handleResetUses(battery: Battery) {
    setBatteries((prev) => prev.map((b) => (b.id === battery.id ? { ...b, useCount: 0 } : b)));
    const res = await api.batteries[":id"]["reset-uses"].$post({
      param: { id: String(battery.id) },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      fetchBatteries()
        .then(setBatteries)
        .catch(() => {});
    }
  }

  function closeLabels() {
    setShowLabelsModal(false);
    setSelectedForLabels(new Set());
    setSelectedStates(new Set());
  }

  async function handleGenerateLabels() {
    const batteriesToPrint = batteries.filter((b) => selectedForLabels.has(b.id));
    const statesToPrint = Array.from(selectedStates);
    setGeneratingLabels(true);
    try {
      await generateBatteryAndStatesPDF(batteriesToPrint, statesToPrint);
      closeLabels();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to generate labels");
    } finally {
      setGeneratingLabels(false);
    }
  }

  function toggleBatterySelection(batteryId: number) {
    const updated = new Set(selectedForLabels);
    if (updated.has(batteryId)) {
      updated.delete(batteryId);
    } else {
      updated.add(batteryId);
    }
    setSelectedForLabels(updated);
  }

  function toggleStateSelection(state: string) {
    const updated = new Set(selectedStates);
    if (updated.has(state)) {
      updated.delete(state);
    } else {
      updated.add(state);
    }
    setSelectedStates(updated);
  }

  if (loading) {
    return (
      <Page title="Batteries" width="narrow">
        <Loading />
      </Page>
    );
  }

  const sorted = sortBatteries(batteries);
  const inRobot = batteries.find((b) => b.state === "In Robot");
  const nextUp = batteries.find((b) => b.state === "Next Up");
  const longestCharging = batteries
    .filter((b) => b.state === "Charging")
    .sort((a, b) => a.stateSince - b.stateSince)[0];

  return (
    <Page
      title="Batteries"
      width="narrow"
      actions={
        !adding && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowLabelsModal(true)}>
              Print labels
            </Button>
            <Button
              onClick={() => {
                setAdding(true);
                setBanner(null);
              }}
            >
              Add a battery
            </Button>
          </div>
        )
      }
    >
      {banner && <ErrorBanner message={banner} />}
      {warning && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {warning}
        </p>
      )}

      {/* Summary strip */}
      {(inRobot || nextUp || longestCharging) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {inRobot && <SummaryTile label="In Robot" battery={inRobot} voltage />}
          {nextUp && <SummaryTile label="Next Up" battery={nextUp} voltage />}
          {longestCharging && <SummaryTile label="Longest Charging" battery={longestCharging} />}
        </div>
      )}

      {adding && (
        <Card title="New battery" className="space-y-3">
          <Field label="Name">
            <input
              type="text"
              placeholder="e.g. A1"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setAddError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddBattery();
                if (e.key === "Escape") setAdding(false);
              }}
              className={inputClass}
              // biome-ignore lint/a11y/noAutofocus: intentional
              autoFocus
            />
          </Field>
          {addError && <p className="text-xs text-red-700">{addError}</p>}
          <div className="flex gap-2">
            <Button onClick={handleAddBattery}>Add</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setNewName("");
                setAddError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {batteries.length === 0 && !adding && (
        <p className="text-sm text-secondary-500">No batteries yet. Add one above.</p>
      )}

      <div className="space-y-3">
        {sorted.map((battery) => {
          const isUpdating = updatingIds.has(battery.id);
          const tracksVoltage = battery.state === "In Robot" || battery.state === "Next Up";
          return (
            <Card key={battery.id} className="space-y-4">
              {/* Header */}
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-secondary-900">{battery.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-secondary-500">
                    <Badge colors={STATE_TONES[battery.state]}>{battery.state}</Badge>
                    <span>
                      for <ElapsedTime sinceMs={battery.stateSince} />
                    </span>
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-secondary-500">
                    <span>
                      Used in robot{" "}
                      <span className="font-semibold text-secondary-700">{battery.useCount}×</span>
                    </span>
                    {battery.useCount > 0 && (
                      <button
                        type="button"
                        onClick={() => handleResetUses(battery)}
                        className={textButton}
                      >
                        Reset
                      </button>
                    )}
                  </p>
                </div>

                {/* Voltage — shown for In Robot and Next Up */}
                {tracksVoltage &&
                  (editingVoltageId === battery.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        ref={voltageInputRef}
                        type="number"
                        step="0.01"
                        placeholder="12.60"
                        aria-label="Voltage"
                        value={voltageInput}
                        onChange={(e) => setVoltageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSetVoltage(battery);
                          if (e.key === "Escape") {
                            setEditingVoltageId(null);
                            setVoltageInput("");
                          }
                        }}
                        className={`${inputClass} !w-24 [appearance:textfield]`}
                      />
                      <Button onClick={() => handleSetVoltage(battery)}>Set</Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingVoltageId(null);
                          setVoltageInput("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditingVoltageId(battery.id);
                        setVoltageInput(battery.voltage != null ? String(battery.voltage) : "");
                      }}
                      title="Set voltage"
                    >
                      {battery.voltage != null ? (
                        <span className={`font-mono tabular-nums ${voltageColor(battery.voltage)}`}>
                          {battery.voltage.toFixed(2)}V
                        </span>
                      ) : (
                        "Set voltage"
                      )}
                    </Button>
                  ))}

                <ConfirmButton
                  size="sm"
                  label="Delete"
                  question={`Delete ${battery.name}? This can't be undone.`}
                  onConfirm={() => handleDeleteBattery(battery.id)}
                />
              </div>

              {/* State buttons */}
              <div className="flex flex-wrap gap-2">
                {STATES.map((s) => (
                  <Chip
                    key={s}
                    selected={battery.state === s}
                    disabled={isUpdating}
                    onClick={() => handleSetState(battery, s)}
                    className="!py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Labels pop-up (batteries and states) */}
      {showLabelsModal && (
        <Dialog title="Print labels" onClose={closeLabels}>
          <p className="text-sm text-secondary-500">
            Select batteries and/or states to print on a single PDF.
          </p>

          <div>
            <h3 className="mb-2 font-sans text-sm font-semibold text-secondary-900">Batteries</h3>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {batteries.length === 0 ? (
                <p className="text-sm text-secondary-500">No batteries available</p>
              ) : (
                batteries.map((battery) => (
                  <label
                    key={battery.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-secondary-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedForLabels.has(battery.id)}
                      onChange={() => toggleBatterySelection(battery.id)}
                      className="h-4 w-4"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-secondary-900">{battery.name}</p>
                      <p className="text-xs text-secondary-500">
                        BAT-{String(battery.id).padStart(4, "0")}
                      </p>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-sans text-sm font-semibold text-secondary-900">States</h3>
            <div className="space-y-1">
              {STATE_LABELS.map((state) => (
                <label
                  key={state.code}
                  className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-secondary-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedStates.has(state.code)}
                    onChange={() => toggleStateSelection(state.code)}
                    className="h-4 w-4"
                  />
                  <div>
                    <p className="text-sm font-medium text-secondary-900">{state.label}</p>
                    <p className="text-xs text-secondary-500">{state.code}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {(selectedForLabels.size > 0 || selectedStates.size > 0) && (
            <p className="text-xs text-secondary-500">
              {selectedForLabels.size} batteries, {selectedStates.size} states
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-secondary-200 pt-4">
            <Button variant="secondary" onClick={closeLabels}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerateLabels}
              disabled={
                (selectedForLabels.size === 0 && selectedStates.size === 0) || generatingLabels
              }
            >
              {generatingLabels ? "Generating…" : "Generate PDF"}
            </Button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
