// Simplified type shim for po2json based on its README (https://github.com/mikeedwards/po2json).
declare module 'po2json' {
    export function parse(buf: string | Buffer, options: {
        stringify: true, // We make stringify mandatory and true here, in which case a string is returned.
        format?: 'mf',
        'fallback-to-msgid'?: boolean,
    }): string;
}
