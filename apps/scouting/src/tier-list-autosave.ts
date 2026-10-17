export type SaveStatus = { pending: boolean; saving: boolean; error: string };

/** Coalesce edits per list and serialize writes, including edits made during a request. */
export class TierListAutosave<T> {
  private pending = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private error = "";
  private listeners = new Set<(status: SaveStatus) => void>();
  private write: (id: string, value: T) => Promise<void>;

  constructor(write: (id: string, value: T) => Promise<void>) {
    this.write = write;
  }

  get status(): SaveStatus {
    return { pending: this.pending.size > 0, saving: !!this.running, error: this.error };
  }

  subscribe(listener: (status: SaveStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener(this.status);
  }

  enqueue(id: string, value: T) {
    this.pending.set(id, value);
    this.error = "";
    this.schedule(600);
    this.notify();
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, delay);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    // Start on a microtask so running is assigned before notifications or completion.
    this.running = Promise.resolve()
      .then(async () => {
        this.notify();
        while (this.pending.size) {
          const [id, value] = this.pending.entries().next().value as [string, T];
          try {
            await this.write(id, value);
            if (this.pending.get(id) === value) this.pending.delete(id);
            this.error = "";
          } catch (error) {
            this.error = error instanceof Error ? error.message : "Could not save list.";
            this.schedule(3000);
            break;
          }
        }
      })
      .finally(() => {
        this.running = undefined;
        this.notify();
      });
    return this.running;
  }
}
