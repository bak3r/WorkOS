---
provenance: template
---

# Creating Your DA Identity

1. Copy this `_example/` directory and rename it (e.g., `{da-name}/`, `aria/`, `max/`)
2. Edit `identity.md` — the YAML frontmatter at the top holds your DA's structured configuration; the markdown body below holds personality and style prose
3. Register your DA in `../_registry.yaml`
4. Reference your DA in your `CLAUDE.md` via `@WORKOS/USER/DA/{name}/identity.md`

## Template Variables

Replace these placeholders with your values:
- `{DA_IDENTITY.NAME}` — Your DA's name
- `{DA_IDENTITY.DISPLAY_NAME}` — Display name (often uppercase)
- `{PRINCIPAL.NAME}` — Your name

## Multiple DAs

WorkOS supports multiple DA identities. Set `role: primary` for your main assistant.
Additional DAs can have `role: secondary` or specialized roles.
