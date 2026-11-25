import type { FilterPattern } from '@rollup/pluginutils';
import type { Plugin } from 'vite';
export type PoLoaderOptions = {
    /**
     * - The .po files to transform, by default all.
     */
    include?: FilterPattern;
    /**
     * - The .po files not to transform, by default none.
     */
    exclude?: FilterPattern;
};
/**
 * @import { FilterPattern } from '@rollup/pluginutils'
 * @import { Plugin } from 'vite'
 */
/**
 * @typedef {object} PoLoaderOptions
 * @property {FilterPattern} [include] - The .po files to transform, by default all.
 * @property {FilterPattern} [exclude] - The .po files not to transform, by default none.
 */
/**
 * Plugin for Vite, Rollup and Rolldown, that transforms imported .po files into modules which export the translations
 * as object of translation keys and translations, see parseTranslations.
 *
 * @param {PoLoaderOptions} [options]
 * @returns {Plugin}
 */
export declare function poLoader(options?: PoLoaderOptions): Plugin;
/**
 * Parse the translations of a .po file into an object of translation keys and translations. Keys of translations with
 * a context are prefixed with the context and \u0004 as separator. For untranslated and fuzzy translations, the
 * translation key is used as translation. This is the format of po2json with options format: 'mf' and
 * 'fallback-to-msgid': true, which was used previously.
 *
 * @param {string | Buffer} content
 * @returns {Record<string, string>}
 */
export declare function parseTranslations(content: string | Buffer): Record<string, string>;
//# sourceMappingURL=loader.d.ts.map