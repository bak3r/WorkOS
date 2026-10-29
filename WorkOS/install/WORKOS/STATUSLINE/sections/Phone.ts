import type { State } from "../State";
import { fit } from "../Width";
import { sessionForms } from "./Header";

/** The phone layout under the header: the session row and nothing else. Context, work and the model ladder stay off the phone. */
export function renderPhone(state: State): string {
  if (!state.geometry.phone) return "";
  // The phone layout has no label, so the unlabelled forms only.
  const session = sessionForms(state, state.geometry.content).slice(1);
  return session.length ? `${fit(state.geometry.content, ...session)}\n` : "";
}
