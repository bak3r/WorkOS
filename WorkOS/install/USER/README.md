---
provenance: template
---

# USER/ — Your Identity Layer

This directory holds everything WorkOS knows about you at work: identity,
team, goals, projects, stack and conventions. Files here are loaded by
`CLAUDE.md` @-imports at every session start, so the DA boots aware of who
you are and what you're working on.

## Layout

```
WORKOS/USER/
├── PRINCIPAL/PRINCIPAL_IDENTITY.md    # Work identity (loaded at startup)
├── DIGITAL_ASSISTANT/DA_IDENTITY.md   # Your DA's name and personality (loaded at startup)
├── PROJECTS.md                        # Repo/service registry + routing aliases (loaded at startup)
├── TELOS/TELOS.md                     # Work goals — source of truth
├── TELOS/PRINCIPAL_TELOS.md           # Generated summary (loaded at startup)
├── CONFIG/OPERATIONAL_RULES.md        # Your operational rules (loaded at startup)
├── CONFIG/WORKOS_CONFIG.toml          # Main config (secrets live in <configRoot>/.env)
├── PRINCIPAL/RESUME.md                # Career detail
├── PRINCIPAL/WRITINGSTYLE.md          # How you write (MRs, docs, messages)
├── PRINCIPAL/RHETORICALSTYLE.md       # How you argue a design or review point
├── CONTACTS.md                        # Colleagues and stakeholders
├── DEFINITIONS.md                     # Domain terms, systems, acronyms
├── TECHSTACKPREFERENCES.md            # Languages, frameworks, conventions of your codebases
├── ARCHITECTURE.md                    # Dev environment: sandbox, egress, cloud, CI
├── BASICINFO.md                       # Quick facts: timezone, hours, handles
├── OPINIONS.md                        # Your DA's opinions on working with you
├── ALGOPREFS.md                       # How the Algorithm should behave for you
├── AI_WRITING_PATTERNS.md             # Writing patterns to avoid
└── (subdirs) WORK/, CUSTOMIZATIONS/, SECURITY/, SHARED/
```

## Bootstrap

Files arrive as scaffolds. Run `/interview` to populate them with your
real answers. The interview is incremental — you can stop and resume.

## Privacy

Everything in this directory is **private** and never ships in any WorkOS
release. The release builder
deletes the entire `USER/` tree from staging and overlays generic
scaffolds in its place.
