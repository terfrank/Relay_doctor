# relay-doctor

A diagnostic utility built in TypeScript for detecting and explaining **Agent Relay node and workspace drift**.

## Core Problem & Motivation

In Agent Relay, node execution and workspace selection depend on:
1. **Per-repository workspace pins**: `<projectRoot>/.agentworkforce/relay/workspace-key.json`
2. **Machine-global fleet node enrollments**: `~/.agentworkforce/relay/fleet-enrollments.json`
3. **Legacy directory states**: `.agent-relay/` versus canonical `.agentworkforce/relay/`

Existing `agent-relay doctor` diagnostics focus on SQLite drivers, disk permissions, and broker socket responsiveness, leaving critical node and workspace drift conditions undetected until a silent failure or startup refusal occurs (#1432, #1289).

`relay-doctor` covers these gaps with static drift inspection and log diagnosis.

## Features

- **Drift Detection (`check`)**:
  - Detects `workspace-key.json` pins lacking `enrolledNodeId` while `fleet-enrollments.json` contains active records (#1432).
  - Detects legacy `.agent-relay` directories left beside modern `.agentworkforce/relay` state.
  - Detects cross-workspace conflicts between repository pins and enrolled fleet nodes.
  - Detects incomplete environment credentials (`RELAY_NODE_TOKEN` without `RELAY_NODE_ID`, #1289).
- **Log Diagnostic (`explain`)**:
  - Classifies log outputs into `PASS`, `WARN`, `FAIL`, or `UNKNOWN`.
  - Explains root causes for Issue #1432 and Issue #1289 drift signatures.
  - **Does not guess**: Unrecognized error streams strictly report `UNKNOWN`.
- **Zero Secret Leakage**:
  - Tokens and keys (`rk_live_*`, `nt_*`, `br_*`, `ocl_*`, `tok_*`, `arr_*`, and sensitive JSON fields) are strictly redacted before output.

## CLI Usage

### Check Workspace & Node Drift
```bash
relay-doctor check --cwd <path-to-project>
# or structured JSON:
relay-doctor check --cwd <path-to-project> --json
```

### Explain Error Logs
```bash
relay-doctor explain --input <path-to-logfile-or-string>
# or structured JSON:
relay-doctor explain --input <path-to-logfile-or-string> --json
```

## Running Tests

```bash
npm test
npm run build
```
