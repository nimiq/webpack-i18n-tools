import { createFilter } from '@rollup/pluginutils';
import { po } from 'gettext-parser';

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
export function poLoader(options = {}) {
    const filter = createFilter(options.include, options.exclude);

    return {
        name: 'po-loader',

        transform: {
            filter: { id: /\.po$/ }, // hook filter, for Rolldown and Rollup >= 4.38 to skip other modules efficiently
            handler(code, id) {
                if (!id.endsWith('.po') || !filter(id)) return null;

                return {
                    code: `export default ${JSON.stringify(parseTranslations(code))};`,
                    map: null,
                    moduleSideEffects: false,
                };
            },
        },
    };
}

/**
 * Parse the translations of a .po file into an object of translation keys and translations. Keys of translations with
 * a context are prefixed with the context and \u0004 as separator. For untranslated and fuzzy translations, the
 * translation key is used as translation. This is the format of po2json with options format: 'mf' and
 * 'fallback-to-msgid': true, which was used previously.
 *
 * @param {string | Buffer} content
 * @returns {Record<string, string>}
 */
export function parseTranslations(content) {
    const { translations } = po.parse(content, { defaultCharset: 'utf8' });
    /** @type {Record<string, string>} */
    const result = {};
    for (const [context, contextTranslations] of Object.entries(translations)) {
        for (const [key, translation] of Object.entries(contextTranslations)) {
            if (!context && !key) continue; // the header entry
            const isFuzzy = !!translation.comments?.flag?.includes('fuzzy');
            result[context ? `${context}\u0004${key}` : key] =
                isFuzzy || translation.msgstr[0] === '' ? key : translation.msgstr[0];
        }
    }
    return result;
}
