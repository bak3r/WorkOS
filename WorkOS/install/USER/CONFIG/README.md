---
provenance: template
---

# Config — Credentials and WorkOS Configuration

This directory holds the structured config that WorkOS tools read at runtime:
credential pointers, project paths, integration settings. Treat it as the
single source of truth for "where does my stuff live and how do I authenticate."

## Files

| File | What it holds |
|------|----------------|
| `WORKOS_CONFIG.toml` | The main config — principal and DA identity, projects directory, integration toggles. |

## Where credentials actually live

`WORKOS_CONFIG.toml` itself does **not** store credentials. Secrets live in
two places:

- **`<configRoot>/.env`** — environment variables (API tokens for the
  tools and skills you use).
- **`<configRoot>/WORKOS/USER/CREDENTIALS/`** — credential JSON files (AWS
  profiles, etc.). The directory does not exist by default;
  create it on demand and `chmod 700` it.

`WORKOS_CONFIG.toml` references these by path, never by value. That keeps
secrets out of any file that gets accidentally committed or shared.

## Customization

Open `WORKOS_CONFIG.toml` and update:

- `[principal]` / `[da]` — your identity and your DA's name.
- `[paths]` — where your code projects live.
- Any integration-specific blocks (`[integrations.*]`) added by skills you install.

The installer writes sensible defaults during the configuration step.
You only need to edit this file when you want to change a default or
add a new integration's settings.

## Privacy

Nothing in this directory ships in a public WorkOS release. The release
builder overlays a generic public-default scaffold; your customized
config stays on your machine.
