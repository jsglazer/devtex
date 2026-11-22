/**
 * Debouncer with an injected scheduler (deterministic under fake timers).
 * The editor uses it to coalesce keystrokes before posting a snapshot to the
 * preview worker; the worker never re-renders synchronously per keystroke.
 */
import type { Scheduler } from './bbt.js';

export class Debouncer<T> {
  private handle: unknown = null;
  private pendingValue: { v: T } | null = null;

  constructor(
    private readonly scheduler: Scheduler,
    private readonly delayMs: number,
    private readonly fire: (value: T) => void,
  ) {}

  push(value: T): void {
    this.pendingValue = { v: value };
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = this.scheduler.schedule(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    const p = this.pendingValue;
    this.pendingValue = null;
    if (p !== null) this.fire(p.v);
  }

  cancel(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.pendingValue = null;
  }

  get pending(): boolean {
    return this.pendingValue !== null;
  }
}
