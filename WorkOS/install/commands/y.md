---
name: y
description: Shortcut for yes — do the action just proposed. Bare "y" means the same thing.
argument-hint: "[optional: which proposed action, if more than one is open]"
version: 1.0.0
---

# y — Yes, do it

The principal typing `/y` (or a bare `y`) IS them saying **"yes, do it"** to the action the DA just proposed. The approval is given; do not re-ask.

- When the DA asked several questions or proposed several actions, a bare `y` is yes to every one of them, each taken as the DA recommended. `$ARGUMENTS` narrows it to one when given.
- When nothing was proposed but work stopped mid-flight, `y` means continue, exactly as `/c`: resume where it stopped and keep going until done or truly blocked.
- When nothing was proposed and nothing is in flight, say what you would do and proceed only if it is unambiguous.
- `y` never bypasses a gate. A push, a release, a write to GitLab or Jira, or anything else in the Permission Boundaries table keeps its own ask unless the proposal named that exact action; `y` only removes the ask for what was proposed.
- `y` never starts a Workflow. A multi-agent Workflow needs the principal's own words asking for one, so a stray "y" cannot launch an expensive run.

Report done with the evidence, in the standard format.
