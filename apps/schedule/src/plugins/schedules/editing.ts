import { useState } from "react";

// Whether an editor has editing on. Off whenever the app is opened or reloaded, so nothing is
// painted by accident; kept in memory, so it stays as they left it while they move around the app.

let editingOn = false;

export function useEditing(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(editingOn);
  return [
    on,
    (next) => {
      editingOn = next;
      setOn(next);
    },
  ];
}
