import path from 'node:path';
// ReplaceSource from webpack-sources, which can be used independently of webpack, is used as alternative to magic-string
// which is usually used in rollup plugins, because it keeps the mappings of the original sourcemap without generating
// a high resolution sourcemap for the modified code that needs to be merged with the original sourcemap.
import webpackSources from 'webpack-sources';

const { ReplaceSource } = webpackSources;

/**
 * @import { Source } from 'webpack-sources'
 */

/**
 * @typedef {{filename: string, source: Source }} ChunkInfo
 * @typedef {ChunkInfo & {
 *     translations: Record<string, string>,
 *     translationsCode: string,
 *     translationsCodePosition: number,
 * }} ParsedLanguageChunkInfo
 */

/**
 * @param {ChunkInfo} languageChunk
 * @returns {ParsedLanguageChunkInfo}
 */
function parseLanguageChunk(languageChunk) {
    const chunkCode = languageChunk.source.source();
    if (typeof chunkCode !== 'string') throw new Error('Failed to parse language file.');
    const translationObjectRegex = generateTranslationObjectRegex();
    let match = chunkCode.match(translationObjectRegex);
    if (!match) throw new Error('Failed to parse language file.');
    const translationsCode = match[0];
    const translationsCodePosition = Number(match.index);

    // Parse translations
    /** @type {Record<string, string>} */
    const translations = {};
    const translationEntryRegex = generateTranslationEntryRegex();
    while ((match = translationEntryRegex.exec(translationsCode)) !== null) {
        const [, matchedTranslationKey, , matchedTranslation] = match;
        const translationKey = normalizeString(matchedTranslationKey);
        translations[translationKey] = normalizeString(matchedTranslation);
    }

    return {
        ...languageChunk,
        translations,
        translationsCode,
        translationsCodePosition,
    };
}

/**
 * @param {ChunkInfo[]} languageChunkInfos
 * @param {ChunkInfo[]} otherChunkInfos
 * @param {(filename: string, source: Source) => void} updateChunk
 * @param {(message: string) => void} emitWarning
 */
export function processChunks(languageChunkInfos, otherChunkInfos, updateChunk, emitWarning) {
    if (!languageChunkInfos.length) return;

    const parsedLanguageChunkInfos = languageChunkInfos.map(parseLanguageChunk);

    const { missingTranslations, unusedTranslations } = optimizeChunks(parsedLanguageChunkInfos, otherChunkInfos);
    for (const { filename, source } of [...parsedLanguageChunkInfos, ...otherChunkInfos]) {
        updateChunk(filename, source);
    }

    reportMissingAndUnusedTranslations(missingTranslations, unusedTranslations, emitWarning);
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

    // The reference language file is for example en.js or en-[hash].js
    const referenceLanguageChunkInfo = languageChunkInfos.find(({ filename }) =>
        /\ben[-.]/.test(path.basename(filename)),
    );
    if (!referenceLanguageChunkInfo) throw 'English reference language file not found.';

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
        const { missingTranslations: missingChunkTranslations, usedTranslations } = optimizeTranslationUsages(
            chunkInfo,
            translationKeyIndexMap,
        );
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
    const translationEntryRegex = generateTranslationEntryRegex();
    let match;

    while ((match = translationEntryRegex.exec(translationsCode)) !== null) {
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
            const translationPosition = matchPosition + matchedTranslationKey.length + matchedDoubleColon.length;
            source.replace(
                translationPosition, // start, inclusive
                translationPosition + matchedTranslation.length - 1, // end, inclusive,
                encodeAsStringLiteral(fallbackTranslation), // replacement
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
            `${hasTrailingComma ? '' : ','}${translationKeyIndex}:${encodeAsStringLiteral(fallbackTranslation)}`,
        );
        hasTrailingComma = false;
    }

    languageChunkInfo.source = source;
}

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
    const translationUsageRegex = generateTranslationUsageRegex();
    let match;

    while ((match = translationUsageRegex.exec(originalCode)) !== null) {
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
            `'${translationKeyIndex}'`, // replacement
        );
    }

    chunkInfo.source = source;

    return {
        missingTranslations,
        usedTranslations,
    };
}

// Whitespace between tokens
const ws = '\\s*';

/**
 * @returns {RegExp}
 */
function generateTranslationEntryRegex() {
    const str = matchString(null);
    // Capturing groups in this regex are used in parseLanguageChunk and optimizeLanguageChunk
    return new RegExp(
        `([^{,\\s"'\`:]+?|${str})` + // translation key (either as direct object key or string key)
            `(${ws}:${ws})` + // double colon
            `(${str})`, // translation with string delimiters
        'g',
    );
}

/**
 * @returns {RegExp}
 */
function generateTranslationObjectRegex() {
    const translationEntry = generateTranslationEntryRegex().source;
    return new RegExp(
        `\\{${ws}` + // object's opening bracket
            `(?:${translationEntry}${ws},${ws})*` + // arbitrary number of comma separated translation entries
            `(?:${translationEntry}${ws},?${ws})?` + // after last entry, comma is optional. Also allow 0 entries.
            `${ws}}`, // object's closing bracket
    );
}

/**
 * @returns {RegExp}
 */
function generateTranslationUsageRegex() {
    const prefixPart =
        `[$.]t[ec]?${ws}\\(${ws}` + // Search for $t / $tc / $te calls
        '|' + // or
        // for vue2 compatible vue-i18n <v9 <i18n> interpolation components' paths in vue-template-compiler compiled
        // template render functions
        `${matchString('i18n')}${ws},${ws}\\{.*?` + // detected within the i18n component
        `(?:attrs|${matchString('attrs')})${ws}:${ws}\\{.*?` + // attributes which contain
        `(?:path|${matchString('path')})${ws}:${ws}` + // path which is the translation key
        '|' + // or
        // for vue3 compatible vue-i18n >=v9 <i18n-t> interpolation components' keypath in @vue/compiler-sfc compiled
        // template render functions
        `[[,]${ws}\\w{1,3}\\(${ws}` + // vue3's createVNode (which render functions' h is a wrapper for) or createBlock
        // (which is a private utility similar to createVNode with dynamic children, see vue source code) call, which is
        // minified to an arbitrary identifier. To make the regex more efficient we make it more specific by specifying
        // what char to expect before the identifier and by limiting the length of minified identifiers to 3 chars. This
        // way, the number of potential match candidates is reduced to avoid the need of unnecessary backtracking in
        // case of invalid candidates. Previously, we matched \w+ which matched a lot of invalid candidates which could
        // only be rejected later when the expected ( was not found, or even later when eventually the keypath was not
        // found, leading to a lot of backtracking. After backtracking, the same search was repeated on the next char
        // matching \w+ again and eventually backtracked, and so on, resulting in quadratic runtime in the length of the
        // \w+ match, which can be very long for inlined base64 content, e.g. inlined sourcemaps during dev.
        `\\w{1,3}${ws},${ws}` + // first argument to createVNode/createBlock which is the node type, here i18n-t definition
        // which gets imported in advance via resolveComponent into a variable which is minified to an arbitrary name
        '\\{[^}]*?' + // second argument to createVNode/createBlock which is an object containing the prop definitions
        `(?:keypath|${matchString('keypath')})${ws}:${ws}`; // keypath prop definition
    // Match the translation key which is a (potentially concatenated) string
    const str = matchString(null);
    const translationKeyPart = `(?:${str}${ws}\\+${ws})*${str}`;
    return new RegExp(`(${prefixPart})(${translationKeyPart})`, 'gs');
}

/**
 * @param {string | null} expectedString
 * @returns {string}
 */
function matchString(expectedString) {
    const bs = '\\\\'; // single literal backslash; note \\\\ in string becomes \\ in regex which matches a literal \
    if (expectedString === null) {
        // Match arbitrary string '...', "..." or `...`, where ... is allowed to include escaped string delimiters.
        const alternatives = [`'(?:${bs}'|[^'])*?'`, `"(?:${bs}"|[^"])*?"`, `\`(?:${bs}\`|[^\`])*?\``];
        return `(?:${alternatives.join('|')})`;
    } else {
        const escapedString = expectedString
            .replace(/\\/g, bs)
            .replace(/\n/g, `${bs}n`) // Search newlines as \n escape sequences in code.
            .replace(/[.*+?^${}()|[\]]/g, '\\$&'); // Escape regex special chars, excluding \ already escaped via bs
        const alternatives = [
            `'${escapedString.replace(/'/g, `${bs}'`)}'`,
            `"${escapedString.replace(/"/g, `${bs}"`)}"`,
            `\`${escapedString.replace(/`/g, `${bs}\``)}\``,
        ];
        return `(?:${alternatives.join('|')})`;
    }
}

/**
 * @param {string} str
 * @returns {string}
 */
function normalizeString(str) {
    return str
        .replace(/\\n/g, '\n') // unescape newlines
        .replace(/\\u00a0/g, ' ') // unescape non breaking spaces
        .replace(/^["'`](.*)["'`]$/gs, '$1') // remove outer string delimiters
        .replace(/['"`]\s*\+\s*['"`]/g, '') // resolve concatenations
        .replace(/\\(['"`])/g, '$1'); // unescape inner string delimiter chars
}

/**
 * @param {string} str
 */
function encodeAsStringLiteral(str) {
    str = str
        .replace(/\n/g, '\\n') // escape newlines
        .replace(/ /g, '\\u00a0') // escape non breaking spaces
        .replace(/(?<!\\)['"`]/g, '\\$&'); // escape inner string delimiter chars
    return `'${str}'`;
}

/**
 * @param {Set<string>} missingTranslations
 * @param {Set<string>} unusedTranslations
 * @param {(message: string) => void} emitWarning
 */
function reportMissingAndUnusedTranslations(missingTranslations, unusedTranslations, emitWarning) {
    let warnMessage = '';
    if (missingTranslations.size) {
        warnMessage +=
            'The following translations appear in the bundled code but not in the language files:\n' +
            [...missingTranslations].reduce((result, translationKey) => `${result}  ${translationKey}\n`, '');
    }
    if (unusedTranslations.size) {
        warnMessage +=
            'The following translations appear in the language files but not in the bundled code:\n' +
            [...unusedTranslations].reduce((result, translationKey) => `${result}  ${translationKey}\n`, '');
    }
    if (missingTranslations.size || unusedTranslations.size) {
        warnMessage += '\nPlease extract the newest language reference file from the source code.';
    }
    if (warnMessage) {
        emitWarning(warnMessage);
    }
}
