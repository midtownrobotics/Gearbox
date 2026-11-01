// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Debounces the door microswitch circuit. `true` means the GPIO pin is
 * grounded (door closed); `false` means open circuit (door open).
 */
export class SwitchDetector {
  private rawGrounded = true;
  private stableGrounded = true;
  private rawChangedAt: number | null = null;

  constructor(private readonly debounceMilliseconds: number) {}

  /** Set startup state without treating an already-open door as a new opening. */
  reset(grounded: boolean) {
    this.rawGrounded = grounded;
    this.stableGrounded = grounded;
    this.rawChangedAt = null;
  }

  sample(grounded: boolean, now = Date.now()) {
    if (grounded !== this.rawGrounded) {
      this.rawGrounded = grounded;
      this.rawChangedAt = now;
    }

    if (
      this.rawGrounded !== this.stableGrounded &&
      this.rawChangedAt !== null &&
      now - this.rawChangedAt >= this.debounceMilliseconds
    ) {
      const wasGrounded = this.stableGrounded;
      this.stableGrounded = this.rawGrounded;
      return { changed: true, triggered: wasGrounded && !this.stableGrounded };
    }

    return { changed: false, triggered: false };
  }

  state() {
    return { rawGrounded: this.rawGrounded, grounded: this.stableGrounded };
  }
}
