import {
  DndContext,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export function SortableTiers({
  ids,
  onMove,
  children,
}: {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from >= 0 && to >= 0) onMove(from, to);
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="tier-board">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

export function SortableTierRow({
  id,
  name,
  onItemDrop,
  children,
}: {
  id: string;
  name: string;
  onItemDrop: () => void;
  children: (handle: ReactNode) => ReactNode;
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
    <div
      ref={setNodeRef}
      className={`tier-row${isDragging ? " tier-row-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onItemDrop();
      }}
    >
      {children(
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="tier-drag-handle"
          aria-label={`Reorder ${name} tier`}
          title="Drag to reorder tier, or press Space and use arrow keys"
        >
          <GripVertical size={20} />
        </button>,
      )}
    </div>
  );
}
