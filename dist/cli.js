#!/usr/bin/env node
import fs from 'node:fs';
import { checkNodeWorkspaceDrift } from './core/check.js';
import { explainLog } from './core/explain.js';
import { redactSecretsDeep, redactSecretsInString } from './utils/redact.js';
function printHelp() {
    console.log(`
relay-doctor - Diagnostic tool for Agent Relay node and workspace drift

Usage:
  relay-doctor check --cwd <path> [--home <path>] [--json]
  relay-doctor explain --input <path-or-string> [--json]
  relay-doctor --help

Commands:
  check     Inspect a directory for workspace pin, fleet enrollment, and legacy directory drift.
  explain   Analyze a log stream/file for known node/workspace drift signatures.

Statuses:
  PASS      No drift detected; configurations are properly aligned.
  WARN      Drift condition detected (e.g. shadowed enrollments, unmigrated directories).
  FAIL      Breaking drift detected (e.g. conflicting workspaces, incomplete credentials).
  UNKNOWN   Input pattern not recognized as known node/workspace drift (will not guess).
`);
}
function parseCliArgs(argv) {
    const args = {
        json: false,
        help: false,
    };
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
        }
        else if (arg === '--json') {
            args.json = true;
        }
        else if (arg === '--cwd') {
            args.cwd = argv[++i];
        }
        else if (arg === '--home') {
            args.home = argv[++i];
        }
        else if (arg === '--input') {
            args.input = argv[++i];
        }
        else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }
    if (positional.length > 0) {
        args.command = positional[0];
    }
    return args;
}
export async function runCli(argv = process.argv.slice(2)) {
    const args = parseCliArgs(argv);
    if (args.help || !args.command) {
        printHelp();
        return 0;
    }
    if (args.command === 'check') {
        const cwd = args.cwd ?? process.cwd();
        const result = checkNodeWorkspaceDrift({
            cwd,
            homeDir: args.home,
        });
        if (args.json) {
            console.log(JSON.stringify(redactSecretsDeep(result), null, 2));
        }
        else {
            console.log('');
            console.log(`Relay Doctor Check: ${cwd}`);
            console.log('='.repeat(50));
            console.log(`Status: [${result.status}] - ${result.summary}`);
            console.log('');
            console.log('Checks:');
            for (const check of result.checks) {
                console.log(`  [${check.status}] ${check.name} (${check.id})`);
                console.log(`    Source:  ${check.source}`);
                console.log(`    Message: ${check.message}`);
                if (check.remediation) {
                    console.log(`    Fix:     ${check.remediation}`);
                }
            }
            console.log('');
        }
        if (result.status === 'FAIL')
            return 1;
        if (result.status === 'UNKNOWN')
            return 2;
        return 0;
    }
    if (args.command === 'explain') {
        if (!args.input) {
            console.error('Error: --input <log-file-or-string> is required for explain command.');
            return 1;
        }
        let logContent = args.input;
        if (fs.existsSync(args.input)) {
            try {
                logContent = fs.readFileSync(args.input, 'utf-8');
            }
            catch {
                // Never print err.message
                console.error('Error: Could not read input log file.');
                return 1;
            }
        }
        const result = explainLog(logContent);
        if (args.json) {
            console.log(JSON.stringify(redactSecretsDeep(result), null, 2));
        }
        else {
            console.log('');
            console.log('Relay Doctor Explain Log');
            console.log('='.repeat(50));
            console.log(`Status: [${result.status}] - ${result.summary}`);
            console.log('');
            console.log('Findings:');
            for (const finding of result.findings) {
                console.log(`  [${finding.status}] ${finding.signature} (${finding.id})`);
                console.log(`    Source:    ${finding.source}`);
                console.log(`    Diagnosis: ${finding.diagnosis}`);
                if (finding.matchedLogLine) {
                    console.log(`    Log Match: ${finding.matchedLogLine}`);
                }
                if (finding.remediation) {
                    console.log(`    Fix:       ${finding.remediation}`);
                }
            }
            console.log('');
        }
        if (result.status === 'FAIL')
            return 1;
        if (result.status === 'UNKNOWN')
            return 2;
        return 0;
    }
    console.error(`Unknown command: ${redactSecretsInString(args.command ?? '')}`);
    printHelp();
    return 1;
}
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
    runCli().then((code) => {
        process.exit(code);
    });
}
