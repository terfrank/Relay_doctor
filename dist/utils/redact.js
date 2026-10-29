const SECRET_REGEX_PATTERNS = [
    // Workspace keys (e.g. rk_live_xyz, rk_test_xyz)
    /\brk_[a-zA-Z0-9_-]{8,}\b/g,
    // Node tokens (e.g. nt_xyz)
    /\bnt_[a-zA-Z0-9_-]{8,}\b/g,
    // Broker API keys (e.g. br_xyz)
    /\bbr_[a-zA-Z0-9_-]{8,}\b/g,
    // Enrollment tokens (e.g. ocl_node_enr_xyz)
    /\bocl_[a-zA-Z0-9_-]{8,}\b/g,
    // Agent tokens (e.g. tok_xyz)
    /\btok_[a-zA-Z0-9_-]{8,}\b/g,
    // Result tokens (e.g. arr_xyz)
    /\barr_[a-zA-Z0-9_-]{8,}\b/g,
    // Bearer tokens in headers
    /Bearer\s+[a-zA-Z0-9._~+/-]{10,}/gi,
];
const SECRET_KEY_NAMES = new Set([
    'workspacekey',
    'nodetoken',
    'apikey',
    'api_key',
    'relaycastapikey',
    'relay_node_token',
    'relay_workspace_key',
    'relay_api_key',
    'token',
    'secret',
    'password',
    'authorization',
]);
/**
 * Redact sensitive token strings in text.
 */
export function redactSecretsInString(text) {
    if (!text || typeof text !== 'string')
        return text;
    let result = text;
    for (const pattern of SECRET_REGEX_PATTERNS) {
        result = result.replace(pattern, '[REDACTED_SECRET]');
    }
    return result;
}
/**
 * Deeply redact secret fields and strings in an object/array/value.
 */
export function redactSecretsDeep(val) {
    if (val === null || val === undefined)
        return val;
    if (typeof val === 'string') {
        return redactSecretsInString(val);
    }
    if (Array.isArray(val)) {
        return val.map((item) => redactSecretsDeep(item));
    }
    if (typeof val === 'object') {
        const copy = {};
        for (const [k, v] of Object.entries(val)) {
            const lowerKey = k.toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (SECRET_KEY_NAMES.has(lowerKey)) {
                copy[k] = '[REDACTED_SECRET]';
            }
            else {
                copy[k] = redactSecretsDeep(v);
            }
        }
        return copy;
    }
    return val;
}
