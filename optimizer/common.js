const path = require('path');
const JSON5 = require('json5');
// There is currently a discrepancy between the latest @types/webpack-sources and the types that webpack defines
// internally for webpack-sources. ReplaceSource from webpack-sources is compatible with Webpack 4 and Webpack 5.
// As it can also be used independently of Webpack, we also use it for our rollup builds, as alternative to magic-string
// which is usually used in rollup plugins.
const ReplaceSource = /** @type {typeof import('webpack5').sources.ReplaceSource} */ (
    /** @type {unknown} */ (require('webpack-sources').ReplaceSource));

/**
 * @typedef {import('webpack5').sources.Source} Source - Actually is from webpack-sources, but use types from webpack5
 * @typedef {{filename: string, source: Source}} ChunkInfo
 * @typedef {ChunkInfo & { moduleCode?: string }} LanguageChunkInfo
 * @typedef {LanguageChunkInfo & {
 *     translations: Record<string, string>,
 *     translationsCode: string,
 *     translationsCodePosition: number,
 * }} ParsedLanguageChunkInfo
 */

// Groups in this regex are capturing groups as they're used in optimizeLanguageChunk
const TRANSLATION_ENTRY_REGEX = new RegExp(
    `([^{,\\s"'\`]+?|${matchString()})` // translation key (either as direct object key or string key)
    + '(\\s*:\\s*)' // double colon
    + `(${matchString()})`, // translation with string delimiters
    'g',
);

const TRANSLATION_OBJECT_REGEX = new RegExp(
    '\\{\\s*' // object's opening bracket
    + `(?:${TRANSLATION_ENTRY_REGEX.source}\\s*,\\s*)*` // arbitrary number of comma separated translation entries
    + `(?:${TRANSLATION_ENTRY_REGEX.source}\\s*,?\\s*)?` // after last entry, comma is optional. Also allow 0 entries.
    + '\\s*}', // object's closing bracket
);

/**
 * @param {LanguageChunkInfo} languageChunk
 * @returns {ParsedLanguageChunkInfo}
 */
function parseLanguageChunk(languageChunk) {
    const chunkCode = languageChunk.source.source();
    if (typeof chunkCode !== 'string') throw new Error('Failed to parse language file.');
    const match = chunkCode.match(TRANSLATION_OBJECT_REGEX);
    if (!match) throw new Error('Failed to parse language file.');
    const translationsCode = match[0];
    const translationsCodePosition = match.index;
    const translations = JSON5.parse(languageChunk.moduleCode // parse less processed code
        ? languageChunk.moduleCode.match(TRANSLATION_OBJECT_REGEX)?.[0] || 'null'
        : translationsCode);
    if (!translationsCodePosition || !translations) throw new Error('Failed to parse language file.');
    return {
        ...languageChunk,
        translations,
        translationsCode,
        translationsCodePosition,
    };
}

/**
 * @param {LanguageChunkInfo[]} languageChunkInfos
 * @param {ChunkInfo[]} otherChunkInfos
 * @param {(filename: string, source: Source) => void} updateChunk
 * @param {(message: string) => void} emitWarning
 */
module.exports = function processChunks(languageChunkInfos, otherChunkInfos, updateChunk, emitWarning) {
    const parsedLanguageChunkInfos = languageChunkInfos.map(parseLanguageChunk);

    const { missingTranslations, unusedTranslations } = optimizeChunks(parsedLanguageChunkInfos, otherChunkInfos);
    for (const {filename, source} of [...parsedLanguageChunkInfos, ...otherChunkInfos]) {
        updateChunk(filename, source);
    }

    reportMissingAndUnusedTranslations(
        missingTranslations,
        unusedTranslations,
        emitWarning,
    );
}

/**
 * @param {ParsedLanguageChunkInfo[]} languageChunkInfos
 * @param {ChunkInfo[]} otherChunkInfos
 * @returns {{missingTranslations: Set<string>, unusedTranslations: Set<string>}}
 */
function optimizeChunks(languageChunkInfos, otherChunkInfos) {
    /** @type {Record<string, number>} */
    const translationKeyIndexMap = {};
    /** @type {Record<string, string>} */
    const fallbackTranslations = {};

    const referenceLanguageChunkInfo = languageChunkInfos
        .find(({ filename }) => /\ben[-.]/.test(path.basename(filename))); // dash in regex for webpack, dot for rollup
    if (!referenceLanguageChunkInfo) throw('English reference language file not found.');

    Object.entries(referenceLanguageChunkInfo.translations).forEach(([key, value], index) => {
        const normalizedKey = normalizeString(key);
        translationKeyIndexMap[normalizedKey] = index;
        fallbackTranslations[normalizedKey] = normalizeString(value);
    });

    /** @type {Set<string>} */
    const missingTranslations = new Set();
    const unusedTranslations = new Set(Object.keys(translationKeyIndexMap));

    for (const languageChunkInfo of languageChunkInfos) {
        optimizeLanguageChunk(languageChunkInfo, translationKeyIndexMap, fallbackTranslations);
    }
    for (const chunkInfo of otherChunkInfos) {
        const { missingTranslations: missingChunkTranslations, usedTranslations } =
            optimizeTranslationUsages(chunkInfo, translationKeyIndexMap);
        missingChunkTranslations.forEach((translationKey) => missingTranslations.add(translationKey));
        usedTranslations.forEach((translationKey) => unusedTranslations.delete(translationKey));
    }

    return { missingTranslations, unusedTranslations };
}

/**
 * @param {ParsedLanguageChunkInfo} languageChunkInfo
 * @param {Record<string, number>} translationKeyIndexMap
 * @param {Record<string, string>} fallbackTranslations
 */
function optimizeLanguageChunk(languageChunkInfo, translationKeyIndexMap, fallbackTranslations) {
    // Replace the keys of the translations object by shorter numbers and fill in fallback translations where no
    // translation is available.

    const missingTranslations = new Set(Object.keys(translationKeyIndexMap));
    const { source: originalSource, translationsCode, translationsCodePosition } = languageChunkInfo;

    // Make code modifications using ReplaceSource to automatically update sourcemaps.
    // Note that all positions are relative to the original source, regardless of replacements. Therefor always create
    // a new ReplaceSource, even if originalSource is one (which it typically shouldn't be).
    const source = new ReplaceSource(originalSource);
    let match;

    while ((match = TRANSLATION_ENTRY_REGEX.exec(translationsCode)) !== null) {
        const [, matchedTranslationKey, matchedDoubleColon, matchedTranslation] = match;
        const matchPosition = translationsCodePosition + match.index;
        const translationKey = normalizeString(matchedTranslationKey);
        const translationKeyIndex = translationKeyIndexMap[translationKey];
        if (translationKeyIndex === undefined) continue;
        missingTranslations.delete(translationKey);

        source.replace(
            matchPosition, // start, inclusive
            matchPosition + matchedTranslationKey.length - 1, // end, inclusive
            translationKeyIndex.toString(), // Replacement. No need for extra handling of 0 here.
        );

        // Use fallback translation if translation is empty (consists only of string separators). Note that this
        // case does not actually appear when using the po loader as it automatically assigns the key as
        // translation if the translation is empty.
        if (matchedTranslation.length === 2) {
            const fallbackTranslation = fallbackTranslations[translationKey] || translationKey;
            const translationPosition = matchPosition + matchedTranslationKey.length
                + matchedDoubleColon.length;
            source.replace(
                translationPosition, // start, inclusive
                translationPosition + matchedTranslation.length - 1, // end, inclusive,
                `"${fallbackTranslation}"`, // replacement
            );
        }
    }

    // Add fallback translations for missing translations
    const insertionPosition = translationsCodePosition + translationsCode.length - 1; // before } of translations object
    let hasTrailingComma = /,\s*};?$/.test(translationsCode);
    for (const missingTranslationKey of missingTranslations) {
        const translationKeyIndex = translationKeyIndexMap[missingTranslationKey]; // guaranteed to exist
        const fallbackTranslation = fallbackTranslations[missingTranslationKey] || missingTranslationKey;
        source.insert(
            insertionPosition,
            `${hasTrailingComma ? '' : ','}${translationKeyIndex}:"${fallbackTranslation}"`,
        );
        hasTrailingComma = false;
    }

    languageChunkInfo.source = source;
}

const TRANSLATION_USAGE_REGEX_PREFIX_PART = '[$.]t[ec]?\\s*\\(\\s*' // Search for $t / $tc / $te calls
    + '|' // or
    // for vue2 compatible vue-i18n <v9 <i18n> interpolation components' paths in vue-template-compiler compiled
    // template render functions
    + `${matchString('i18n')}\\s*,.*?` // detected within the i18n component
    + `(?:attrs|${matchString('attrs')})\\s*:.*?` // attributes which contain
    + `(?:path|${matchString('path')})\\s*:\\s*` // the path which is the translation key
    + '|' // or
    // for vue3 compatible vue-i18n >=v9 <i18n-t> interpolation components' keypath in @vue/compiler-sfc compiled
    // template render functions
    + '\\w+\\(\\s*' // vue3's createVNode (which render functions' h is a wrapper for) or createBlock (which is a
        // private utility similar to createVNode with dynamic children, see vue source code) call, which is minified to
        // an arbitrary name
    + '\\w+\\s*,\\s*' // first argument to createVNode/createBlock which is the node type, here i18n-t definition which
        // gets imported in advance via resolveComponent into a variable which is minified to an arbitrary name
    + '\\{[^}]*?' // second argument to createVNode/createBlock which is an object containing the prop definitions
    + `(?:keypath|${matchString('keypath')})\\s*:\\s*`; // the keypath prop definition which is the translation key
// Match the translation key which is a (potentially concatenated) string
const TRANSLATION_USAGE_REGEX_TRANSLATION_KEY_PART = `(?:${matchString()}\\s*\\+\\s*)*${matchString()}`;
const TRANSLATION_USAGE_REGEX = new RegExp(
    `(${TRANSLATION_USAGE_REGEX_PREFIX_PART})(${TRANSLATION_USAGE_REGEX_TRANSLATION_KEY_PART})`,
    'gs',
);

/**
 * @param {ChunkInfo} chunkInfo
 * @param {Record<string, number>} translationKeyIndexMap
 * @returns {{missingTranslations: Set<string>, usedTranslations: Set<string>}}
 */
function optimizeTranslationUsages(chunkInfo, translationKeyIndexMap) {
    // Replace translation keys in translation usages with the shorter numbers compatible with the optimized
    // language files.

    /** @type {Set<string>} */
    const missingTranslations = new Set();
    /** @type {Set<string>} */
    const usedTranslations = new Set();

    const originalCode = chunkInfo.source.source();
    if (typeof originalCode !== 'string') return { missingTranslations, usedTranslations }; // Binary file.
    // Note that all replacement positions are relative to originalCode, regardless of other replacements.
    const source = new ReplaceSource(chunkInfo.source);
    let match;

    while ((match = TRANSLATION_USAGE_REGEX.exec(originalCode)) !== null) {
        const [, matchedPrefix, matchedTranslationKey] = match;
        const translationKeyPosition = match.index + matchedPrefix.length;
        const normalizedTranslationKey = normalizeString(matchedTranslationKey);
        const translationKeyIndex = translationKeyIndexMap[normalizedTranslationKey];
        if (translationKeyIndex === undefined) {
            missingTranslations.add(normalizedTranslationKey);
            continue;
        }
        usedTranslations.add(normalizedTranslationKey);

        source.replace(
            translationKeyPosition, // start, inclusive
            translationKeyPosition + matchedTranslationKey.length - 1, // end, inclusive
            // Replacement. 0 requires string delimiter as 0 otherwise treated as falsy / missing key
            translationKeyIndex === 0 ? '"0"' : `'${translationKeyIndex.toString()}'`,
        );
    }

    chunkInfo.source = source;

    return {
        missingTranslations,
        usedTranslations,
    };
}

/**
 * @param {Set<string>} missingTranslations
 * @param {Set<string>} unusedTranslations
 * @param {(message: string) => void} emitWarning
 */
function reportMissingAndUnusedTranslations(missingTranslations, unusedTranslations, emitWarning) {
    let warnMessage = '';
    if (missingTranslations.size) {
        warnMessage += 'The following translations appear in the bundled code but not in the language files:\n'
            + [...missingTranslations].reduce((result, translationKey) => `${result}  ${translationKey}\n`, '');
    }
    if (unusedTranslations.size) {
        warnMessage += 'The following translations appear in the language files but not in the bundled code:\n'
            + [...unusedTranslations].reduce((result, translationKey) => `${result}  ${translationKey}\n`, '');
    }
    if (missingTranslations.size || unusedTranslations.size) {
        warnMessage += '\nPlease extract the newest language reference file from the source code.';
    }
    if (warnMessage) {
        emitWarning(warnMessage);
    }
}

/**
 * @param {string} str
 * @returns {string}
 */
function normalizeString(str) {
    return str.replace(/['"`]\s*\+\s*['"`]/g, '') // resolve concatenations
        .replace(/^["'`]|["'`]$/g, '') // remove outer string delimiters
        .replace(/(?<!\\)(['"`])/g, (match, delimiter) => `\\${delimiter}`) // escape inner string delimiter chars
        .replace(/\n/g, '\\n') // escape newlines
        .replace(/\u00a0/g, '\\u00a0'); // escape non breaking spaces
}

/**
 * @param {string | null} [expectedString]
 * @returns {string}
 */
function matchString(expectedString = null) {
    if (expectedString === null) {
        // match arbitrary string (note \\\\ in string becomes \\ in regex which matches a literal \)
        return '(?:"(?:\\\\"|[^"])*?"|\'(?:\\\\\'|[^\'])*?\'|`(?:\\\\`|[^`])*?`)';
    } else {
        const escapedString = expectedString.replace(/\n/g, '\\n') // Search newlines as \n escape sequences in code.
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars.
        return `(?:"${escapedString}"|'${escapedString}'|\`${escapedString}\`)`;
    }
}
