import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  CheckItem,
  CheckResult,
  FleetNodeEnrollmentStore,
  ProjectWorkspaceSession,
  Status,
} from '../types.js';
import { redactSecretsInString } from '../utils/redact.js';

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
export function resolveRelayHome(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.AGENT_RELAY_HOME?.trim()) {
    return path.resolve(env.AGENT_RELAY_HOME.trim());
  }

  if (env.AGENT_RELAY_DATA_DIR?.trim()) {
    return path.resolve(env.AGENT_RELAY_DATA_DIR.trim());
  }

  const resolvedHome = path.resolve(homeDir);
  const candidates: string[] = [];

  if (platform === 'win32') {
    if (env.APPDATA?.trim()) {
      candidates.push(path.join(env.APPDATA.trim(), 'agentworkforce', 'relay'));
    }
  } else if (platform === 'darwin') {
    candidates.push(path.join(resolvedHome, 'Library', 'Application Support', 'agentworkforce', 'relay'));
  } else {
    // Linux and other Unix
    if (env.XDG_DATA_HOME?.trim()) {
      candidates.push(path.join(env.XDG_DATA_HOME.trim(), 'agentworkforce', 'relay'));
    } else {
      candidates.push(path.join(resolvedHome, '.local', 'share', 'agentworkforce', 'relay'));
    }
  }

  // Fallback: ~/.agentworkforce/relay
  candidates.push(path.join(resolvedHome, '.agentworkforce', 'relay'));

  // Prefer candidate that already exists on disk
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? path.join(resolvedHome, '.agentworkforce', 'relay');
}

/**
 * Resolves legacy global home paths following Relay's platform conventions:
 * - ~/.agent-relay
 * - Windows: APPDATA/agent-relay
 * - Linux: XDG_DATA_HOME/agent-relay or ~/.local/share/agent-relay
 */
export function resolveLegacyHomeCandidates(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const resolvedHome = path.resolve(homeDir);
  const candidates: string[] = [path.join(resolvedHome, '.agent-relay')];

  if (platform === 'win32') {
    if (env.APPDATA?.trim()) {
      candidates.push(path.join(env.APPDATA.trim(), 'agent-relay'));
    }
  } else if (platform !== 'darwin') {
    if (env.XDG_DATA_HOME?.trim()) {
      candidates.push(path.join(env.XDG_DATA_HOME.trim(), 'agent-relay'));
    } else {
      candidates.push(path.join(resolvedHome, '.local', 'share', 'agent-relay'));
    }
  }

  return [...new Set(candidates.filter((p) => fs.existsSync(p)))];
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function checkNodeWorkspaceDrift(options: CheckOptions): CheckResult {
  const cwd = path.resolve(options.cwd);
  const home = options.homeDir ? path.resolve(options.homeDir) : os.homedir();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const checks: CheckItem[] = [];

  // 1. Check legacy directory state drift
  const legacyProjectDir = path.join(cwd, '.agent-relay');
  const modernProjectDir = path.join(cwd, '.agentworkforce', 'relay');
  const canonicalHomeDir = resolveRelayHome(home, env, platform);
  const legacyHomes = resolveLegacyHomeCandidates(home, env, platform);

  const hasLegacyProject = fs.existsSync(legacyProjectDir);
  const hasModernProject = fs.existsSync(modernProjectDir);

  if (hasLegacyProject && hasModernProject) {
    let legacyBrokerRunning = false;
    let legacyPid: number | undefined;
    const legacyConnFile = path.join(legacyProjectDir, 'connection.json');
    if (fs.existsSync(legacyConnFile)) {
      try {
        const raw = fs.readFileSync(legacyConnFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          typeof parsed.pid === 'number' &&
          parsed.pid > 0 &&
          isPidAlive(parsed.pid)
        ) {
          legacyBrokerRunning = true;
          legacyPid = parsed.pid;
        }
      } catch {
        // Corrupt connection file in legacy folder is handled as inactive
      }
    }

    if (legacyBrokerRunning) {
      checks.push({
        id: 'legacy-active-broker',
        name: 'Legacy Project State',
        status: 'FAIL',
        source: 'packages/cli/src/cli/lib/doctor.ts:160-171, CHANGELOG.md:120',
        message: `Legacy directory .agent-relay has an active broker running (PID ${legacyPid}) alongside modern .agentworkforce/relay.`,
        remediation: 'Stop the legacy broker with `agent-relay node down --force` and remove .agent-relay.',
      });
    } else {
      checks.push({
        id: 'legacy-project-directory-drift',
        name: 'Legacy Project State',
        status: 'WARN',
        source: 'CHANGELOG.md:120',
        message: 'Legacy directory .agent-relay exists alongside modern .agentworkforce/relay.',
        remediation: 'Remove stale .agent-relay directory to prevent state split and accidental fallback.',
      });
    }
  } else if (hasLegacyProject && !hasModernProject) {
    checks.push({
      id: 'legacy-project-unmigrated',
      name: 'Legacy Project State',
      status: 'WARN',
      source: 'CHANGELOG.md:120',
      message: 'Found legacy directory .agent-relay, but no modern .agentworkforce/relay.',
      remediation: 'Run `agent-relay node up` to initialize modern runtime state under .agentworkforce/relay, then remove .agent-relay.',
    });
  } else {
    checks.push({
      id: 'legacy-project-clean',
      name: 'Legacy Project State',
      status: 'PASS',
      source: 'packages/config/src/project-namespace.ts:15',
      message: 'No stale legacy project state (.agent-relay) detected.',
    });
  }

  // Check global legacy home directory
  if (legacyHomes.length > 0 && fs.existsSync(canonicalHomeDir)) {
    checks.push({
      id: 'legacy-global-home-drift',
      name: 'Legacy Global Home State',
      status: 'WARN',
      source: 'CHANGELOG.md:121',
      message: `Legacy global home directory exists (${legacyHomes.join(', ')}) alongside canonical ${canonicalHomeDir}.`,
      remediation: 'Remove legacy global home directory to avoid stale auth and daemon drift.',
    });
  }

  // 2. Read workspace-key.json and fleet-enrollments.json
  const pinFilePath = path.join(modernProjectDir, 'workspace-key.json');
  let pin: ProjectWorkspaceSession | null = null;
  const pinFileExists = fs.existsSync(pinFilePath);

  if (pinFileExists) {
    try {
      const raw = fs.readFileSync(pinFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        checks.push({
          id: 'workspace-pin-invalid-format',
          name: 'Workspace Key Pin',
          status: 'FAIL',
          source: 'packages/cloud/src/project-workspace-key.ts:119-123',
          message: 'Workspace pin file has invalid structure: expected a JSON object.',
          remediation: 'Rebind project workspace with `agent-relay workspace rebind <name>`.',
        });
      } else if (
        !('workspaceKey' in parsed) ||
        typeof parsed.workspaceKey !== 'string' ||
        !parsed.workspaceKey.trim()
      ) {
        checks.push({
          id: 'workspace-pin-missing-key',
          name: 'Workspace Key Pin',
          status: 'FAIL',
          source: 'packages/cloud/src/project-workspace-key.ts:122-123',
          message: 'Workspace pin file exists but is missing a valid "workspaceKey".',
          remediation: 'Rebind project workspace with `agent-relay workspace rebind <name>`.',
        });
      } else {
        pin = parsed as ProjectWorkspaceSession;
      }
    } catch {
      // Never print err.message: Node JSON.parse error messages can leak file contents/secrets
      checks.push({
        id: 'workspace-pin-corrupt',
        name: 'Workspace Key Pin',
        status: 'FAIL',
        source: 'packages/cloud/src/project-workspace-key.ts:119-123',
        message: 'Workspace pin file is not valid JSON or cannot be read.',
        remediation: 'Repair or remove corrupt workspace-key.json and rebind workspace with `agent-relay workspace rebind <name>`.',
      });
    }
  }

  // Read fleet-enrollments.json
  const fleetStorePath = path.join(canonicalHomeDir, 'fleet-enrollments.json');
  let fleetStore: FleetNodeEnrollmentStore | null = null;
  const fleetStoreExists = fs.existsSync(fleetStorePath);

  if (fleetStoreExists) {
    try {
      const raw = fs.readFileSync(fleetStorePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Strictly reject null, primitives, arrays, and objects with invalid nodes property
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        checks.push({
          id: 'fleet-store-invalid-format',
          name: 'Fleet Enrollment Store',
          status: 'FAIL',
          source: 'packages/cloud/src/fleet.ts:262',
          message: 'Fleet enrollment store file has invalid structure: expected a JSON object.',
          remediation:
            'Remove or repair fleet-enrollments.json, obtain a fresh token from Cloud dashboard, and re-enroll with `agent-relay cloud enroll --token <token>`.',
        });
      } else if (
        !('nodes' in parsed) ||
        parsed.nodes === null ||
        typeof parsed.nodes !== 'object' ||
        Array.isArray(parsed.nodes)
      ) {
        checks.push({
          id: 'fleet-store-invalid-format',
          name: 'Fleet Enrollment Store',
          status: 'FAIL',
          source: 'packages/cloud/src/fleet.ts:266',
          message: 'Fleet enrollment store file has invalid structure: `nodes` must be a JSON object.',
          remediation:
            'Remove or repair fleet-enrollments.json, obtain a fresh token from Cloud dashboard, and re-enroll with `agent-relay cloud enroll --token <token>`.',
        });
      } else {
        fleetStore = parsed as FleetNodeEnrollmentStore;
      }
    } catch {
      // Never print err.message: Node JSON.parse error messages can leak file contents/secrets
      checks.push({
        id: 'fleet-store-corrupt',
        name: 'Fleet Enrollment Store',
        status: 'FAIL',
        source: 'packages/cloud/src/fleet.ts:258-295',
        message: 'Fleet enrollment store file is not valid JSON or cannot be read.',
        remediation:
          'Remove corrupt fleet-enrollments.json, obtain a fresh token from Cloud dashboard, and re-enroll with `agent-relay cloud enroll --token <token>`.',
      });
    }
  }

  const enrollmentCount = fleetStore ? Object.keys(fleetStore.nodes).length : 0;

  // 3. Workspace pin vs Fleet enrollment drift analysis
  if (pin && typeof pin.workspaceKey === 'string' && pin.workspaceKey.trim()) {
    const enrolledNodeId = pin.enrolledNodeId?.trim();

    if (!enrolledNodeId && enrollmentCount > 0) {
      // Issue #1432, PR #1439: Pin without enrolledNodeId shadows fleet enrollments
      checks.push({
        id: 'pin-shadows-fleet-enrollment',
        name: 'Workspace Pin vs Fleet Enrollment',
        status: 'WARN',
        source: 'Issue #1432, PR #1439, packages/cli/src/cli/commands/node.ts:193-213',
        message:
          `Project workspace-key.json is pinned to a workspace with no enrolledNodeId, ` +
          `shadowing ${enrollmentCount} stored Cloud fleet enrollment(s). ` +
          `relay node up will ignore stored fleet enrollments and not serve Cloud fleet nodes.`,
        remediation:
          "Mint a fresh enrollment token from the Cloud dashboard and run 'agent-relay cloud enroll --token <token>' " +
          "(enrollment tokens are one-time and cannot be re-used), or export RELAY_NODE_ID and RELAY_NODE_TOKEN and " +
          "start with 'relay node up --broker-name <node>'.",
      });
    } else if (enrolledNodeId && fleetStore) {
      // Find matching node in fleet-enrollments.json
      const matchingRecord = Object.values(fleetStore.nodes).find(
        (node) =>
          node &&
          typeof node === 'object' &&
          !Array.isArray(node) &&
          'nodeId' in node &&
          typeof node.nodeId === 'string' &&
          node.nodeId === enrolledNodeId
      );

      if (!matchingRecord) {
        checks.push({
          id: 'pin-enrolled-node-missing-in-store',
          name: 'Workspace Pin vs Fleet Enrollment',
          status: 'WARN',
          source: 'packages/cli/src/cli/commands/node.ts:254-259',
          message: `Project pin references enrolledNodeId "${enrolledNodeId}", but no matching record exists in ${fleetStorePath}.`,
          remediation:
            "Mint a fresh enrollment token from Cloud dashboard and re-enroll with 'agent-relay cloud enroll --token <token>', or rebind with `agent-relay workspace rebind <name>`.",
        });
      } else {
        // Cross-workspace conflict check (Issue #1432, PR #1439)
        const pinnedWorkspaceId = pin.workspaceId?.trim();
        const enrolledWorkspaceId = matchingRecord.relayWorkspaceId?.trim();

        if (pinnedWorkspaceId && enrolledWorkspaceId && pinnedWorkspaceId !== enrolledWorkspaceId) {
          checks.push({
            id: 'pin-workspace-conflict',
            name: 'Workspace Pin vs Fleet Enrollment',
            status: 'FAIL',
            source: 'Issue #1432, PR #1439, packages/cli/src/cli/commands/node.ts:137-162',
            message:
              `Refusing to start: repository pin (${pinFilePath} -> workspace ${pinnedWorkspaceId}) ` +
              `and stored Fleet enrollment (${fleetStorePath} -> workspace ${enrolledWorkspaceId}, node ${matchingRecord.nodeId}) ` +
              `select different workspaces.`,
            remediation:
              'Run `agent-relay workspace rebind <name>` to repin this project and clear the stale enrolled-node association, ' +
              'pass --workspace-key, or re-enroll this node in the pinned workspace.',
          });
        } else {
          checks.push({
            id: 'pin-fleet-enrollment-aligned',
            name: 'Workspace Pin vs Fleet Enrollment',
            status: 'PASS',
            source: 'packages/cli/src/cli/commands/node.ts:221-226',
            message: `Project pin and Fleet enrollment are aligned on node "${matchingRecord.nodeName || matchingRecord.nodeId}".`,
          });
        }
      }
    } else if (!enrolledNodeId && enrollmentCount === 0) {
      checks.push({
        id: 'pin-local-only-consistent',
        name: 'Workspace Pin vs Fleet Enrollment',
        status: 'PASS',
        source: 'packages/cli/src/cli/commands/node.ts:202-204',
        message: 'Project is pinned to local workspace; no fleet enrollments exist to shadow.',
      });
    }
  } else if (!pinFileExists && enrollmentCount > 0) {
    checks.push({
      id: 'unpinned-fleet-node-available',
      name: 'Workspace Pin vs Fleet Enrollment',
      status: 'PASS',
      source: 'packages/cli/src/cli/commands/node.ts:232-235',
      message: `No project workspace pin; ${enrollmentCount} stored Fleet enrollment(s) available for default adoption.`,
    });
  }

  // 4. Check incomplete environment credentials
  const envNodeToken = env.RELAY_NODE_TOKEN?.trim();
  const envNodeId = env.RELAY_NODE_ID?.trim();

  if (envNodeToken && !envNodeId) {
    checks.push({
      id: 'incomplete-env-credentials-token-without-id',
      name: 'Environment Enrollment Credentials',
      status: 'FAIL',
      source: 'packages/cli/src/cli/lib/broker-lifecycle.ts:1298 (PR #1291, commit 5cccf7b16)',
      message: 'Cloud enrollment credentials are incomplete: RELAY_NODE_ID is required when RELAY_NODE_TOKEN is set.',
      remediation: 'Export both RELAY_NODE_ID and RELAY_NODE_TOKEN, or clear RELAY_NODE_TOKEN before starting.',
    });
  } else if (!envNodeToken && envNodeId) {
    checks.push({
      id: 'incomplete-env-credentials-id-without-token',
      name: 'Environment Enrollment Credentials',
      status: 'WARN',
      source: 'packages/cli/src/cli/lib/broker-lifecycle.ts:1294-1296',
      message: 'RELAY_NODE_ID is set in environment without RELAY_NODE_TOKEN.',
      remediation: 'Export RELAY_NODE_TOKEN alongside RELAY_NODE_ID to serve an enrolled fleet node.',
    });
  }

  // Determine overall status
  let overallStatus: Status = 'PASS';
  if (checks.some((c) => c.status === 'FAIL')) {
    overallStatus = 'FAIL';
  } else if (checks.some((c) => c.status === 'WARN')) {
    overallStatus = 'WARN';
  } else if (checks.some((c) => c.status === 'UNKNOWN')) {
    overallStatus = 'UNKNOWN';
  }

  const summary =
    overallStatus === 'PASS'
      ? 'All node and workspace drift checks passed.'
      : overallStatus === 'WARN'
        ? 'Node or workspace drift warnings detected.'
        : 'Node or workspace drift failures detected.';

  const sanitizedChecks = checks.map((c) => ({
    ...c,
    message: redactSecretsInString(c.message),
    remediation: c.remediation ? redactSecretsInString(c.remediation) : undefined,
  }));

  return {
    status: overallStatus,
    summary,
    checks: sanitizedChecks,
  };
}
