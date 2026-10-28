---
name: er
description: 'Errata — file feedback about WorkOS or one of its skills into the complaint ledger. Bare text is a complaint; lead with bug:, feature:, praise: or correction: to set the kind; "review" lists recent entries; "enrich" or "triage" enriches pending entries. Shortcut for the Errata skill.'
argument-hint: '[bug:|feature:|praise:|correction:] <what went wrong> | review | enrich'
version: 1.0.0
---

# er — Redirect

This command routes to the **Errata** skill.

```
Skill("Errata", "$ARGUMENTS")
```
