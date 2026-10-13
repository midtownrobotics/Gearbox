// Shared by the shop worker and the shop app (imported as "@g3/worker-shop/process-rules"),
// so keep this dependency-free.

type Step = { name: string; type: string };

const EXAMPLES = "e.g. CAM + Router, or Slice + Print";

function listNames(steps: Step[]): { names: string; plural: boolean } {
  const names = [...new Set(steps.map((s) => s.name))];
  return { names: names.join(" and "), plural: names.length > 1 };
}

/**
 * A File Producer step makes files that a File Consumer step then uses, so a part's processes
 * need both or neither, and each File Consumer step comes after a File Producer one, with one
 * after every File Producer step. `steps` are in the order the part goes through them. Returns
 * the error, or null.
 */
export function fileStepError(steps: Step[]): string | null {
  const producers = steps.filter((s) => s.type === "file_producer");
  const consumers = steps.filter((s) => s.type === "file_consumer");
  if (producers.length > 0 && consumers.length === 0) {
    const { names, plural } = listNames(producers);
    return `${names} ${plural ? "make" : "makes"} files, so the part also needs a File Consumer process to use them — ${EXAMPLES}.`;
  }
  if (consumers.length > 0 && producers.length === 0) {
    const { names, plural } = listNames(consumers);
    return `${names} ${plural ? "use" : "uses"} files, so the part also needs a File Producer process to make them — ${EXAMPLES}.`;
  }
  const early = steps.find(
    (s, i) =>
      s.type === "file_consumer" && !steps.slice(0, i).some((b) => b.type === "file_producer"),
  );
  if (early) {
    return `${early.name} uses a file, so it has to come after the File Producer process that makes it — ${EXAMPLES}.`;
  }
  const unused = steps.find(
    (s, i) =>
      s.type === "file_producer" && !steps.slice(i + 1).some((a) => a.type === "file_consumer"),
  );
  if (unused) {
    return `${unused.name} makes a file, so a File Consumer process has to come after it — ${EXAMPLES}.`;
  }
  return null;
}
