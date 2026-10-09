/** Route for a process's shop-floor view. Used everywhere a process is linked. */
export function processPath(processId: number): string {
  return `/board/process/${processId}`;
}

/** A part's shop view: its drawing and the buttons for working on it, at the machine it's at. */
export function shopViewPath(processId: number, instanceId: number): string {
  return `${processPath(processId)}?part=${instanceId}`;
}

/** A part's details view: everything about it, as the Parts page shows it. */
export function detailsViewPath(instanceId: number): string {
  return `/parts?instance=${instanceId}`;
}
