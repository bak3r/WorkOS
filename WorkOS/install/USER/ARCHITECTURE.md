---
provenance: template
---

# Dev Environment Architecture — User

> Bootstrap default. Run `/interview` to map your actual setup.

Your work environment — where the code runs, what the sandbox can and cannot
reach, and what depends on what. The DA reads this when suggesting commands,
debugging build or network failures, or deciding whether a tool is available.

## Workstation & sandbox

- **Host machine:** (interview — laptop / desktop, OS)
- **Sandbox:** (interview — e.g. Docker Sandboxes (sbx) Linux microVM; workspace path; `CLAUDE_CONFIG_DIR`)
- **Mounts:** (interview — which repos and config dirs are mounted, which persist across rebuilds)
- **Toolchain inside:** (interview — e.g. bun, dotnet SDK version, git, glab)
- **Not available here:** (interview — e.g. no browser, no GUI, no audio, no systemd user session)

## Network / egress

- **Policy:** (interview — e.g. deny-all egress with an allowlist)
- **Allowlisted:** (interview — e.g. GitLab host, private NuGet feed, Jira/Atlassian, model endpoint)
- **Blocked on purpose:** (interview — anything the DA must never try to reach)

## Cloud & services

- **Cloud accounts:** (interview — e.g. AWS account / region per environment)
- **Databases:** (interview — engines, which environment the sandbox may touch)
- **CI/CD:** (interview — e.g. GitLab CI pipelines, deploy stages)

## Boundaries

- **Work code and documents stay in the sandbox.** They are read in place and
  never uploaded to an external service.
- (interview — any other confidentiality rule: customer data, production access, secrets location)
