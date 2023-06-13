// Simplified from https://github.com/json5/json5/blob/main/lib/parse.d.ts.
declare module 'json5' {
    export function parse<T = any>(text: string): T;
}
