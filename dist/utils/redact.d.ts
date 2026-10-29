/**
 * Redact sensitive token strings in text.
 */
export declare function redactSecretsInString(text: string): string;
/**
 * Deeply redact secret fields and strings in an object/array/value.
 */
export declare function redactSecretsDeep<T>(val: T): T;
