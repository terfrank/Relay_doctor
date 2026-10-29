import { redactSecretsInString } from '../utils/redact.js';
const KNOWN_DRIFT_SIGNATURES = [
    // 1. Issue #1432, PR #1439: Pin shadows fleet enrollments
    {
        id: 'drift-pin-shadows-fleet-enrollments',
        signatureName: 'Issue #1432: Project Pin Shadows Fleet Enrollments',
        status: 'WARN',
        source: 'Issue #1432, PR #1439, packages/cli/src/cli/commands/node.ts:207-212',
        pattern: /This project is pinned to a workspace with no enrolled node id, so (?:stored Cloud fleet enrollments|\d+ stored Cloud fleet enrollment\(s\)) will be ignored/i,
        diagnose: () => ({
            diagnosis: 'The project workspace-key.json pin is missing an enrolledNodeId, causing `relay node up` to ignore all stored Cloud fleet enrollments. The broker starts in the pinned workspace and the machine will not serve its Cloud fleet node.',
            remediation: "Mint a fresh enrollment token from the Cloud dashboard and run 'agent-relay cloud enroll --token <token>' (enrollment tokens are one-time and cannot be re-used), or export RELAY_NODE_ID and RELAY_NODE_TOKEN and start with 'relay node up --broker-name <node>'.",
        }),
    },
    // 2. Issue #1432, PR #1439: Cleared enrolled node on workspace move
    {
        id: 'drift-cleared-enrolled-node-workspace-move',
        signatureName: 'Issue #1432: Enrolled Node Cleared On Workspace Move',
        status: 'WARN',
        source: 'Issue #1432, PR #1439, packages/cli/src/cli/lib/workspace-session.ts:63-71',
        pattern: /Cleared this project's enrolled fleet node \(([^)]+)\): it belongs to the workspace you moved away from/i,
        diagnose: (match) => {
            const nodeId = match[1] ?? 'unknown';
            return {
                diagnosis: `The project switched or joined a new workspace, automatically clearing enrolled fleet node (${nodeId}) to prevent serving credentials from the previous workspace.`,
                remediation: "Mint a fresh enrollment token from the Cloud dashboard and run 'agent-relay cloud enroll --token <token>' in the new workspace.",
            };
        },
    },
    // 3. Issue #1432, PR #1439: Cross-workspace source conflict
    {
        id: 'drift-cross-workspace-source-conflict',
        signatureName: 'Issue #1432: Repository Pin and Fleet Enrollment Conflict',
        status: 'FAIL',
        source: 'Issue #1432, PR #1439, packages/cli/src/cli/commands/node.ts:149-161',
        pattern: /Refusing to start: this repository and the stored Fleet enrollment select different workspaces/i,
        diagnose: () => ({
            diagnosis: 'The repository pin (.agentworkforce/relay/workspace-key.json) and stored fleet enrollment select different workspaces. Starting with this mismatch would cause split state or credential leakage.',
            remediation: 'Run `agent-relay workspace rebind <name>` to repin this project and clear the stale enrolled-node association, pass --workspace-key, or re-enroll this node in the pinned workspace.',
        }),
    },
    // 4. Incomplete enrollment credentials (fail-closed check)
    {
        id: 'drift-incomplete-enrollment-credentials',
        signatureName: 'Incomplete Cloud Enrollment Credentials',
        status: 'FAIL',
        source: 'packages/cli/src/cli/lib/broker-lifecycle.ts:1298 (PR #1291, commit 5cccf7b16)',
        pattern: /Cloud enrollment credentials are incomplete: RELAY_NODE_ID is required when RELAY_NODE_TOKEN is set/i,
        diagnose: () => ({
            diagnosis: 'Environment variable RELAY_NODE_TOKEN is set without RELAY_NODE_ID. Relay fails closed to prevent half-configured enrollment startups.',
            remediation: 'Export both RELAY_NODE_ID and RELAY_NODE_TOKEN, or clear RELAY_NODE_TOKEN before starting.',
        }),
    },
    // 5. Failed broker cleanup after enrollment failure
    {
        id: 'drift-failed-enrollment-cleanup',
        signatureName: 'Failed Broker Termination After Enrollment Startup Failure',
        status: 'FAIL',
        source: 'packages/cli/src/cli/lib/broker-lifecycle.ts:1328-1331 (PR #1291, commit 5cccf7b16)',
        pattern: /Failed to stop broker process after Cloud enrollment startup failed \(pid: (\d+)\)/i,
        diagnose: (match) => {
            const pid = match[1] ?? 'unknown';
            return {
                diagnosis: `Broker process (PID ${pid}) failed during Cloud enrollment startup and could not be terminated automatically.`,
                remediation: 'Run `agent-relay node down --force` (or `agent-relay down --force`) to forcefully stop orphaned broker processes.',
            };
        },
    },
    // 6. Issue #1289, PR #1291: Cloud enrollment readiness failure / delivery socket failure
    {
        id: 'drift-cloud-enrollment-readiness-failure',
        signatureName: 'Issue #1289: Cloud Enrollment Readiness Failure',
        status: 'FAIL',
        source: 'Issue #1289, PR #1291, packages/cli/src/cli/lib/broker-lifecycle.ts:1074-1077, 1313',
        pattern: /(?:Cloud enrollment did not become ready|enrolled node delivery never connects)/i,
        diagnose: () => ({
            diagnosis: 'Broker started but Cloud fleet node delivery (/v1/node/ws) failed to connect or report readiness.',
            remediation: 'Check network connectivity and verify the Cloud enrollment credentials are active and valid.',
        }),
    },
    // 7. Node Claim Ownership Conflict
    {
        id: 'drift-node-claim-conflict',
        signatureName: 'Node Claim Exclusive Ownership Conflict',
        status: 'FAIL',
        source: 'packages/cli/src/cli/commands/node.ts:318-332',
        pattern: /Refusing to start: node ([^\s]+) is already served by a live broker on this machine/i,
        diagnose: (match) => {
            const nodeId = match[1] ?? 'unknown';
            return {
                diagnosis: `The enrolled node (${nodeId}) is already being served by another active broker process on this machine. Running multiple brokers with the same node ID evicts delivery sockets.`,
                remediation: 'Stop the running broker with `agent-relay node down --state-dir <path>` or use `agent-relay node up --force` to take over.',
            };
        },
    },
    // 8. Missing persisted enrollment
    {
        id: 'drift-persisted-enrollment-missing',
        signatureName: 'Persisted Enrollment Record Missing In Store',
        status: 'WARN',
        source: 'packages/cli/src/cli/commands/node.ts:256-258',
        pattern: /Persisted enrollment for node "([^"]+)" was not found; resuming the pinned workspace without that node identity/i,
        diagnose: (match) => {
            const nodeId = match[1] ?? 'unknown';
            return {
                diagnosis: `Project workspace pin references enrolled node "${nodeId}", but no matching enrollment record exists in the local fleet enrollment store.`,
                remediation: "Mint a fresh enrollment token from the Cloud dashboard and run 'agent-relay cloud enroll --token <token>', or repin with `agent-relay workspace rebind <name>`.",
            };
        },
    },
];
const CLEAN_SUCCESS_PATTERNS = [
    /Using persisted Cloud enrollment for node "([^"]+)"/i,
    /Broker started\./i,
];
export function explainLog(inputLog) {
    const sanitizedInput = redactSecretsInString(inputLog);
    const lines = sanitizedInput.split(/\r?\n/);
    const findings = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        for (const sig of KNOWN_DRIFT_SIGNATURES) {
            const match = trimmed.match(sig.pattern);
            if (match) {
                if (findings.some((f) => f.id === sig.id && f.matchedLogLine === trimmed)) {
                    continue;
                }
                const { diagnosis, remediation } = sig.diagnose(match, trimmed);
                findings.push({
                    id: sig.id,
                    status: sig.status,
                    source: sig.source,
                    signature: sig.signatureName,
                    diagnosis,
                    matchedLogLine: trimmed,
                    remediation,
                });
            }
        }
    }
    // If no drift signatures matched, check if it's a clean successful run
    if (findings.length === 0) {
        const hasSuccess = CLEAN_SUCCESS_PATTERNS.some((pat) => pat.test(sanitizedInput));
        const hasErrorMarkers = /error|fatal|fail|exception|refusing/i.test(sanitizedInput);
        if (hasSuccess && !hasErrorMarkers) {
            return {
                status: 'PASS',
                summary: 'Log indicates node and workspace started cleanly with no drift.',
                findings: [
                    {
                        id: 'drift-none-clean-startup',
                        status: 'PASS',
                        source: 'packages/cli/src/cli/commands/node.ts:179-181',
                        signature: 'Clean Node/Workspace Operation',
                        diagnosis: 'No node or workspace drift detected. Broker started cleanly.',
                    },
                ],
            };
        }
        // Must NOT guess!
        return {
            status: 'UNKNOWN',
            summary: 'UNKNOWN: No recognizable node/workspace drift patterns found in input log.',
            findings: [
                {
                    id: 'drift-unknown',
                    status: 'UNKNOWN',
                    source: 'N/A (unmatched)',
                    signature: 'Unrecognized Log Signature',
                    diagnosis: 'UNKNOWN: The provided log does not match any known node/workspace drift signatures. Relay-doctor will not guess.',
                    remediation: 'Verify whether this log is from `agent-relay node` or `agent-relay workspace`, or run `relay-doctor check --cwd <path>` directly.',
                },
            ],
        };
    }
    // Determine aggregate status
    let overallStatus = 'PASS';
    if (findings.some((f) => f.status === 'FAIL')) {
        overallStatus = 'FAIL';
    }
    else if (findings.some((f) => f.status === 'WARN')) {
        overallStatus = 'WARN';
    }
    else if (findings.some((f) => f.status === 'UNKNOWN')) {
        overallStatus = 'UNKNOWN';
    }
    const summary = overallStatus === 'FAIL'
        ? 'Critical node/workspace drift failure detected in log.'
        : overallStatus === 'WARN'
            ? 'Node/workspace drift warning detected in log.'
            : 'Node/workspace drift checks passed.';
    return {
        status: overallStatus,
        summary,
        findings,
    };
}
