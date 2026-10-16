import type { NodeState } from "../../shared/progress";
import { STATE } from "../../shared/status";
import { layoutGraph, metricsFor } from "./layout";

export type GraphNode = {
  id: number;
  label: string;
  sub: string;
  /** The nodes this one comes after (drawn above it). */
  prereqs: number[];
  state: NodeState;
};

/** Boxes joined by lines, each colored by its state; a line takes the color of where it starts. */
export function TreeGraph({
  nodes,
  compact,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  /** Phone-sized boxes. */
  compact: boolean;
  selectedId?: number | null;
  onSelect: (id: number) => void;
}) {
  const metrics = metricsFor(compact ? 1 : 1.5);
  const layout = layoutGraph(nodes, metrics);
  const stateOf = new Map(nodes.map((node) => [node.id, node.state]));

  return (
    <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
      <svg
        className="absolute inset-0 overflow-visible pointer-events-none"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}-${edge.to}`}
            d={edge.path}
            fill="none"
            strokeWidth={2}
            className={STATE[stateOf.get(edge.from) ?? "locked"].stroke}
          />
        ))}
      </svg>
      {nodes.map((node) => {
        const at = layout.positions.get(node.id);
        if (!at) return null;
        const state = STATE[node.state];
        const selected = node.id === selectedId;
        return (
          <button
            key={node.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(node.id)}
            style={{
              left: at.x,
              top: at.y,
              width: metrics.nodeWidth,
              minHeight: metrics.nodeHeight,
            }}
            className={`absolute flex flex-col justify-center rounded-xl border-2 text-left transition-transform hover:-translate-y-0.5 ${
              compact ? "px-2.5 py-2" : "px-4 py-3"
            } ${state.className} ${
              selected ? "z-10 outline outline-2 outline-offset-2 outline-primary-500" : ""
            }`}
          >
            <span className="flex items-start justify-between gap-2">
              <span
                className={`font-semibold leading-tight ${compact ? "text-xs" : "text-[15px]"}`}
              >
                {node.label}
              </span>
              <span className="shrink-0 text-xs leading-tight" aria-hidden="true">
                {state.icon}
              </span>
            </span>
            {node.sub && (
              <span
                className={`mt-1 leading-snug opacity-75 ${compact ? "text-[10px]" : "text-xs"}`}
              >
                {node.sub}
              </span>
            )}
            <span className="sr-only">{state.label}</span>
          </button>
        );
      })}
    </div>
  );
}
