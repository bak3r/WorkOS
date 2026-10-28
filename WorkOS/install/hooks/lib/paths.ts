/**
 * Centralized Path Resolution — re-export shim.
 *
 * The resolver lives in WORKOS/TOOLS/Paths.ts (since WorkOS 1.1.0, ported from upstream
 * LifeOS 8.761.0), so WORKOS/TOOLS never depends on the hooks tree: TOOLS lands at install
 * step 4.5, hooks at step 7. Hooks keep importing from here; nothing under WORKOS/TOOLS
 * may import this file. See WORKOS/TOOLS/Paths.ts for the precedence rules.
 */

export * from "../../WORKOS/TOOLS/Paths";
