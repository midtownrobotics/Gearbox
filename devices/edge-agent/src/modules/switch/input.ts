// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";

export interface SwitchInput {
  readonly type: "gpio" | "placeholder";
  readGrounded(): boolean;
}

/** Orange Pi 5 GPIO2_D4: GPIO 92, physical pin 22. Low means shorted to ground. */
export class GpioSwitchInput implements SwitchInput {
  readonly type = "gpio" as const;

  constructor(private readonly valuePath: string) {}

  readGrounded() {
    const value = readFileSync(this.valuePath, "utf8").trim();
    if (value === "0") return true;
    if (value === "1") return false;
    throw new Error(`Unexpected GPIO value ${JSON.stringify(value)} at ${this.valuePath}`);
  }
}

export class PlaceholderSwitchInput implements SwitchInput {
  readonly type = "placeholder" as const;
  private grounded = true;

  readGrounded() {
    return this.grounded;
  }

  setGrounded(grounded: boolean) {
    this.grounded = grounded;
  }
}
