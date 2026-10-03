import { site } from "@g3/site-config";
import type { FormEvent } from "react";

export function showTeamNumberError(event: FormEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  input.setCustomValidity(
    input.validity.valueMissing
      ? "Enter a team number."
      : `Team numbers can contain digits only—for example, ${site.team.number}.`,
  );
}

export function clearInputError(event: FormEvent<HTMLInputElement>) {
  event.currentTarget.setCustomValidity("");
}
