---
last_updated: 2026-07-20T03:20:00Z
convention: pai-freshness-v1
version: 2.0.0
---

# WorkOS Security Model

> How WorkOS keeps data — employer services, local stores, and your private work context — reachable only through paths it controls. This is the conceptual model. It applies to any WorkOS install and to the services you build with it; the specifics of any one deployment stay private.

## The core idea

**A datastore should have no path to it except through the service that owns it.** A database behind a private network, reachable only by the service's own identity, has no host or port a public client can point at. The only way to the data is through the service's own routes. That reduces data security to one question you can actually audit:

> **Which routes does the service expose, and which of them touch a store without authentication?**

Every control in this model exists to make sure the answer is "only the ones that are supposed to." The store is only ever as exposed as the route wrapped around it.

The same logic governs WorkOS's own local state. A local datastore (an on-disk SQLite file, a JSONL log) is reachable only through the process that opens it, and that process is reachable over the network only if it binds a port. WorkOS binds none.

## The layered model

| Layer | Defends | Where it lives |
|-------|---------|----------------|
| **Structural** | The datastore itself | No public endpoint exists — nothing to attack directly |
| **Constitutional** | Your DA's behavior | The system prompt: external content is READ-ONLY; analysis is read-only; your private directory is private forever |
| **Native deny** | Catastrophic tool calls | The harness permission denylist (applies to subagents too) |
| **Deterministic hooks** | Injection, unsafe shell, data egress, file writes | Pre/Post tool-use hooks that run as code, not judgment |
| **App auth** | Service data | Per-route authentication on everything that touches a store |
| **Sandbox egress** | Data leaving the machine | Deny-all network egress with an explicit allowlist |

## Locking down a service

The general pattern for a service handling sensitive data:

1. **No inbound path to data except the service's own routes.** Databases sit on a private network, reachable only by the service identity.
2. **The public hostname is the whole attack surface.** Expose one ingress, with its WAF and rate-limit rules; never a second, unfiltered origin.
3. **Every store-touching route carries an auth check.** The only routes left unauthenticated are deliberate: health checks and the endpoints that *establish* identity (login, OAuth token exchange, signature-verified webhooks).
4. **Secrets come from a secret manager**, injected at runtime and referenced through configuration — never written into code or committed config.
5. **Tenant isolation** is either a per-request scoping check or, more strongly, physical separation — so cross-tenant reads are impossible to express rather than merely filtered out.

### Authentication patterns in use

Different surfaces use different proofs, matched to the caller:

- **OAuth 2.1 authorization server** for programmatic/agent access to governed data — short-lived signed access tokens, validated per request for signature, issuer, audience, and expiry, then checked against a live revocation record, with the caller's role read live from the database rather than trusted from the token.
- **Signed session cookies** for human web sessions — the server stores only a hash of the session token; the cookie is `Secure`, `HttpOnly`, `SameSite`-scoped.
- **Scoped bearer tokens** for machine-to-machine pipelines — with least-privilege variants (a write-only ingest token distinct from a read/delete token) where the roles differ.
- **Signature-verified webhooks** for third-party callbacks — the payload's HMAC signature is the proof, checked in constant time with a replay window.

### Tenant isolation, concretely

The strongest form is physical: each tenant gets its own database. A request is bound to exactly one tenant from **server-side identity only** — the client cannot pass a tenant hint. Because the request never holds another tenant's connection, a cross-tenant read is not something the code filters out; it is something the code cannot express. A single reference-monitor decision point fronts every data tool as a second layer.

## Local services

**Default posture: WorkOS exposes nothing to the network.** No dashboard, no listener, no messaging bridge ships in this fork. Background jobs run on timers; any outbound call they make is subject to the sandbox egress allowlist.

## Remote hosts

Remote machines are reached over **key-only SSH** with password auth disabled, using the employer's approved access path.

## Agent and harness security (prompt-injection defense)

The system treats **all external content as data, never instructions** — this is a constitutional rule in the system prompt, and it is operationalized in code:

- A **post-tool-use hook** wraps content from attacker-writable sources (fetched web pages, search results, tool schemas) with an explicit "treat as data, not instructions" marker and scans it for known injection shapes, flagging any hit inline.
- A **blocking pre-tool-use hook** dispatches to sub-guards: it blocks writes that would land identity or secret patterns into system files and blocks known footgun command forms.
- A **native permission denylist** hard-blocks catastrophic operations (destructive deletes, disk wipes, pipe-to-shell, force-push to protected branches, reads of private-key and credential paths). It applies to subagent tool calls as well.
- A **shell-command classifier** parses commands shell-aware — extracting command substitutions and stripping quoted regions — so dangerous patterns can't hide inside an `echo` or a subshell.

The design bias is deliberate: a small number of deterministic, auditable controls over a large number of model-judgment checks. Security-sensitive code is meant to be simple enough to read and verify.

## Secrets and containment

- The **secret store** is a single environment file, referenced everywhere by indirection. It lives inside the private installation boundary and is never part of any public artifact.
- An **egress secret scan** inspects outbound tool calls for secret-shaped strings before they can be auto-approved, refusing the auto-allow (and redacting the log) on a match.
- There is **no public release path**. Nothing from the installation or from employer repositories leaves the machine except via employer-approved private remotes.

## Monitoring

WorkOS itself runs no external scanner. Production monitoring of employer services belongs to the employer's own tooling; WorkOS's role is to verify changes with tool evidence before they ship.

## Incident response

Runbooks cover the high-frequency cases: credential rotation (emergency all-keys and audit-first per-key, with per-vendor playbooks) and supply-chain rapid response (advisory → indicator scan → remediation → rotation).

## The through-line

The whole model reduces to two questions, asked at every layer:

1. **What is the actual path to this data?** (Usually: only through one authenticated route. Never: directly from the public.)
2. **Is every path that touches the data authenticated, and is every unauthenticated path intentional?**

When both answers hold at every layer — network, app, local, agent — the data is reachable only the way it is supposed to be reached. Everything above is the machinery that keeps those two answers true, and verification that catches it before a change ships.

## Examples

### One new route, run through the two questions

A .NET service gains a feature: `/api/reports`, which reads rows from a per-tenant database. Before it ships, the model runs the through-line on it — the same two questions the whole model reduces to.

- **What is the actual path to this data?** The database sits on a private network, so nothing can reach those rows except this service's own routes. `/api/reports` is now one of them.
- **Is that path authenticated?** The route touches a store, so it must carry an auth check. It doesn't yet — it returns data to any caller. That is the finding: a store-touching route with no proof of caller. The fix is to gate it behind the same session or token check every other data route uses, and to scope the read to the caller's own tenant so it cannot return another tenant's rows.

Ship it without that check and the store is exactly as exposed as the route — which is to say, wide open. Add the check and the data is reachable only the way it is supposed to be.

### When "no auth" is correct, and when it never is

Not every unauthenticated route is a bug. A few are supposed to be open, and the test is whether the route *establishes* identity or *serves already-public data* rather than reading private state:

- **Fine unauthenticated:** a login route, an OAuth token exchange, a health check, a signature-verified webhook (the HMAC signature is its proof), a public content read.
- **Never unauthenticated:** anything that reads or writes a tenant's private rows, any admin action, or an endpoint that trusts a client-supplied tenant hint instead of server-side identity.

An integration test encodes exactly this: it calls each protected route anonymously and fails the build the moment a regression flips one open.

### The path to the data, as a picture

```mermaid
flowchart TD
    A[Anonymous request] --> B{Which route?}
    B -->|login / health / public read| C[Allowed by design: no private data]
    B -->|store-touching route| D{Auth check passes?}
    D -->|no| E[Rejected]
    D -->|yes| F{Scoped to caller's tenant?}
    F -->|yes| G[Returns only that tenant's rows]
    G --> H[(Tenant store: private network, no public endpoint)]
    X[Direct connect attempt] -.->|no host, port, or path exists| Z[Nothing to point at]
```

The diagram makes the structural claim visible: there is no arrow from the public straight to the store. The only ways in are the service's routes, and every route that touches the store passes an auth gate and a tenant scope before any rows come back.

---
