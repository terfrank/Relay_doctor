import type { CheckResult } from '../types.js';
export interface CheckOptions {
    cwd: string;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
}
/**
 * Resolves the canonical Relay home directory following Relay's own resolution logic:
 * 1. AGENT_RELAY_HOME env override (packages/cloud/src/worker.ts:155)
 * 2. AGENT_RELAY_DATA_DIR env override (packages/config/src/relay-file-writer.ts:98)
 * 3. Platform-specific standard paths (packages/utils/src/discovery.ts:115-125):
 *    - Windows: APPDATA/agentworkforce/relay
 *    - macOS: ~/Library/Application Support/agentworkforce/relay
 *    - Linux/Unix: XDG_DATA_HOME/agentworkforce/relay or ~/.local/share/agentworkforce/relay
 * 4. Fallback ~/.agentworkforce/relay (packages/cloud/src/worker.ts:156)
 */
export declare function resolveRelayHome(homeDir: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string;
/**
 * Resolves legacy global home paths following Relay's platform conventions:
 * - ~/.agent-relay
 * - Windows: APPDATA/agent-relay
 * - Linux: XDG_DATA_HOME/agent-relay or ~/.local/share/agent-relay
 */
export declare function resolveLegacyHomeCandidates(homeDir: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
export declare function checkNodeWorkspaceDrift(options: CheckOptions): CheckResult;
