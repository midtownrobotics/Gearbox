import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type PortalTileKey,
  type TeamUiSettings,
  completeAppOrder,
  portalAppLabels,
  teamUiLinkLabels,
} from "@g3/site-config";

const labelOf = (key: PortalTileKey, idName: string) =>
  key === "id"
    ? idName
    : key in portalAppLabels
      ? portalAppLabels[key as keyof typeof portalAppLabels]
      : teamUiLinkLabels[key as keyof typeof teamUiLinkLabels];

/**
 * The order of Portal's grid (Team Appearance): drag a tile by its handle, or focus the handle and
 * use Space and the arrow keys. Links that are hidden or empty keep their place but don't show.
 */
export function AppOrder({
  settings,
  idName,
  onChange,
}: {
  settings: TeamUiSettings;
  /** The sign-in app's name for this team ("G3ID"). */
  idName: string;
  onChange: (order: PortalTileKey[]) => void;
}) {
  const order = completeAppOrder(settings.appOrder);
  const sensors = useSensors(
    // A small nudge first, so clicking the handle doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const hidden = (key: PortalTileKey) =>
    key in settings.links &&
    (settings.hiddenLinks.includes(key as keyof typeof settings.links) ||
      !settings.links[key as keyof typeof settings.links]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = order.indexOf(active.id as PortalTileKey);
        const to = order.indexOf(over.id as PortalTileKey);
        onChange(arrayMove(order, from, to));
      }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className="divide-y divide-line rounded-md border border-line">
          {order.map((key, i) => (
            <Tile
              key={key}
              id={key}
              place={i + 1}
              label={labelOf(key, idName)}
              hidden={hidden(key)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function Tile({
  id,
  place,
  label,
  hidden,
}: {
  id: PortalTileKey;
  place: number;
  label: string;
  hidden: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-center gap-3 px-3 py-2 text-sm ${
        isDragging ? "relative z-10 bg-surface shadow-lg" : "bg-surface"
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${label}`}
        title="Drag to reorder"
        className={`flex h-6 w-5 touch-none items-center justify-center rounded text-secondary-400 hover:text-secondary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
          {[3, 8, 13].map((y) => (
            <g key={y}>
              <circle cx="2.5" cy={y} r="1.5" />
              <circle cx="7.5" cy={y} r="1.5" />
            </g>
          ))}
        </svg>
      </button>
      <span className="w-6 text-right tabular-nums text-secondary-400">{place}</span>
      <span className={hidden ? "text-secondary-400" : "text-secondary-900"}>{label}</span>
      {hidden && <span className="text-xs text-secondary-400">(hidden or empty)</span>}
    </li>
  );
}
