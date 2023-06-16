const JSON5 = require('json5');
// There is currently a discrepancy between the latest @types/webpack-sources and the types that webpack defines
// internally for webpack-sources. ReplaceSource from webpack-sources is compatible with Webpack 4 and Webpack 5.
const ReplaceSource = /** @type {typeof import('webpack5').sources.ReplaceSource} */ (
    /** @type {unknown} */ (require('webpack-sources').ReplaceSource));
// Import WebpackError in a fashion that's compatible with Webpack 4 and Webpack 5 (Webpack 4 does not expose
// require('webpack').WebpackError).
// @ts-expect-error: no type definitions for file import. Assume Webpack 5 types because not defined in @types/webpack@4
const WebpackError = /** @type {typeof import('webpack5').WebpackError} */ (require('webpack/lib/WebpackError'));

/**
 * @typedef {import('tapable1types').Tapable.Plugin} Webpack4Plugin
 * @typedef {import('webpack4types').Compiler} Webpack4Compiler
 * @typedef {import('webpack4types').compilation.Compilation} Webpack4Compilation
 *
 * @typedef {import('webpack5').WebpackPluginInstance} Webpack5Plugin
 * @typedef {import('webpack5').Compiler} Webpack5Compiler
 * @typedef {import('webpack5').Compilation} Webpack5Compilation
 * @typedef {typeof import('webpack5').Compilation} Webpack5CompilationConstructor
 *
 * @typedef {Webpack4Compiler|Webpack5Compiler} WebpackCompiler
 * @typedef {Webpack4Compilation|Webpack5Compilation} WebpackCompilation
 *
 * @typedef {import('webpack5').sources.Source} Source - Actually is from webpack-sources and is compatible with 4 and 5
 * @typedef {{filename: string, source: Source}} AssetInfo
 * @typedef {AssetInfo & {translationsCode: string, prefix: string, suffix: string}} LanguageFileInfo
 */

/**
 * Webpack plugin that optimizes language files and their usage by replacing translation keys by shorter numbers while
 * preserving proper sourcemaps.
 *
 * Note that we use a plugin and not a webpack loader as loaders should not depend on other assets and plugins are
 * generally more powerful.
 *
 * Useful documentation for writing webpack plugins (listed in recommended read order):
 * - Overview over assets, chunks, modules and dependencies: https://webpack.js.org/contribute/plugin-patterns/
 * - Introduction on how to write a plugin: https://webpack.js.org/contribute/writing-a-plugin/
 * - Plugin Api: https://webpack.js.org/api/plugins/
 * - Compiler hooks: https://webpack.js.org/api/compiler-hooks/
 * - Compilation hooks: https://webpack.js.org/api/compilation-hooks/
 * - Compilation Api: https://webpack.js.org/api/compilation-object/
 * - Javascript Parser hooks: https://webpack.js.org/api/parser/
 *
 * To get a better feeling for the build process and when a hook is invoked, search the webpack code base for
 * hooks.<hookName>.call
 *
 * Useful utilities for writing a plugin:
 * - Changing sources without breaking sourcemaps: https://github.com/webpack/webpack-sources
 *
 * Useful example plugins for a better understanding of different approaches to writing plugins:
 * - BannerPlugin: https://github.com/webpack/webpack/blob/master/lib/BannerPlugin.js
 *   Simple source code manipulation via webpack-sources and straight forward usage of compilation hooks
 * - DefinePlugin: https://github.com/webpack/webpack/blob/master/lib/DefinePlugin.js
 *   Code manipulation via the Javascript parser using ConstDependency instances (created by toConstDependency from
 *   https://github.com/webpack/webpack/blob/master/lib/javascript/JavascriptParserHelpers.js) as compiler template
 *   dependencies which get applied by the compiler and perform code replacements at module code generation time (see
 *   https://github.com/webpack/webpack/blob/master/lib/dependencies/ConstDependency.js#L72).
 *   See https://stackoverflow.com/a/52906440 for a reduction of this approach to the essential parts (but without
 *   involving the parser).
 *
 *   @implements {Webpack4Plugin}
 *   @implements {Webpack5Plugin}
 */
class I18nOptimizerPlugin {
    /**
     * @param {WebpackCompiler} compiler
     */
    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, (compilation) => {
            if (typeof compiler.options.devtool === 'string' && compiler.options.devtool.includes('eval')) {
                this.emitCompilationError(compilation, `${this.constructor.name} is currently not compatible with eval `
                    + 'devtool settings. Please use a different setting like `source-map`.');
                return;
            }

            if ('processAssets' in compilation.hooks) {
                // Webpack >= 5
                const Compilation = /** @type {Webpack5CompilationConstructor} */ (compilation.constructor);
                compilation.hooks.processAssets.tap(
                    {
                        name: this.constructor.name,
                        stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
                    },
                    () => this.optimizeAssets(compilation),
                );
            } else {
                // Webpack < 5
                compilation.hooks.optimizeChunkAssets.tap(
                    this.constructor.name,
                    () => this.optimizeAssets(compilation),
                );
            }
        });
    }

    /**
     * @param {WebpackCompilation} compilation
     */
    optimizeAssets(compilation) {
        /** @type {{[filename: string]: Source}} */
        const assets = compilation.assets; // maps filename -> source

        // categorize assets and parse language files
        let parsedReferenceLanguageFileContent;
        /** @type {LanguageFileInfo[]} */
        const languageFileInfos = [];
        /** @type {AssetInfo[]} */
        const otherAssetInfos = [];
        for (const [filename, source] of Object.entries(assets)) {
            if (!filename.endsWith('.js') || filename.includes('chunk-vendors')) continue;
            const sourceContent = source.source();
            if (typeof sourceContent !== 'string') continue;
            if (/-po(?:-legacy)?(?:\.[^.]*)?\.js$/.test(filename)) {
                try {
                    const languageFileInfo = {
                        filename,
                        source,
                        ...this.parseLanguageFile(sourceContent),
                    };
                    languageFileInfos.push(languageFileInfo);
                    if (filename.includes('en-po')) {
                        parsedReferenceLanguageFileContent = JSON5.parse(languageFileInfo.translationsCode);
                    }
                } catch (e) {
                    this.emitCompilationError(compilation, `${this.constructor.name}: Failed to parse language file `
                        + `${filename}. Note that currently bundling of language files is not supported. Each `
                        + 'language file has to be its own chunk. Also, using `EvalSourceMapDevToolPlugin` or '
                        + '`EvalDevToolModulePlugin` is currently not supported.');
                    return;
                }
            } else {
                otherAssetInfos.push({ filename, source });
            }
        }

        if (!parsedReferenceLanguageFileContent) return;

        /** @type {Record<string, number>} */
        const translationKeyIndexMap = {};
        /** @type {Record<string, string>} */
        const fallbackTranslations = {};
        Object.entries(parsedReferenceLanguageFileContent).forEach(([key, value], index) => {
            const normalizedKey = this.normalizeString(key);
            translationKeyIndexMap[normalizedKey] = index;
            fallbackTranslations[normalizedKey] = this.normalizeString(value);
        });

        this.optimizeLanguageFiles(languageFileInfos, translationKeyIndexMap, fallbackTranslations);
        const { missingTranslations, unusedTranslations } =
            this.optimizeTranslationUsages(otherAssetInfos, translationKeyIndexMap);

        for (const { filename, source } of [...languageFileInfos, ...otherAssetInfos]) {
            this.updateAsset(compilation, filename, source);
        }

        this.reportMissingAndUnusedTranslations(compilation, missingTranslations, unusedTranslations);
    }

    /**
     * @param {LanguageFileInfo[]} languageFileInfos
     * @param {Record<string, number>} translationKeyIndexMap
     * @param {Record<string, string>} fallbackTranslations
     */
    optimizeLanguageFiles(languageFileInfos, translationKeyIndexMap, fallbackTranslations) {
        // Replace the keys of the translations object by shorter numbers and fill in fallback translations where no
        // translation is available.
        const entryRegex = new RegExp(
            `([^\\s"'\`]+?|${this.matchString()})` // translation key (either as direct object key or string key)
            + '(\\s*:\\s*)' // double colon
            + `(${this.matchString()})`, // translation with string delimiters
            'g',
        );

        for (const languageFileInfo of languageFileInfos) {
            const missingTranslations = new Set(Object.keys(translationKeyIndexMap));
            const { translationsCode, prefix } = languageFileInfo;
            // Make code modifications using ReplaceSource to automatically update sourcemaps.
            // Note that all positions are relative to the original source, regardless of replacements.
            const source = new ReplaceSource(languageFileInfo.source);
            let match;

            while ((match = entryRegex.exec(translationsCode)) !== null) {
                const [, matchedTranslationKey, matchedDoubleColon, matchedTranslation] = match;
                const matchPosition = prefix.length + match.index;
                const translationKey = this.normalizeString(matchedTranslationKey);
                const translationKeyIndex = translationKeyIndexMap[translationKey];
                if (translationKeyIndex === undefined) continue;
                missingTranslations.delete(translationKey);

                source.replace(
                    matchPosition, // start, inclusive
                    matchPosition + matchedTranslationKey.length - 1, // end, inclusive
                    translationKeyIndex.toString(), // Replacement. No need for extra handling of 0 here.
                );

                // Use fallback translation if translation is empty (consist only of string separators). Note that this
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
            const insertionPosition = prefix.length + translationsCode.length - 1; // before } of translations object
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

            languageFileInfo.source = source;
        }
    }

    /**
     * @param {AssetInfo[]} assetInfos
     * @param {Record<string, number>} translationKeyIndexMap
     * @returns {{missingTranslations: Set<string>, unusedTranslations: Set<string>}}
     */
    optimizeTranslationUsages(assetInfos, translationKeyIndexMap) {
        /** @type {Set<string>} */
        const missingTranslations = new Set();
        const unusedTranslations = new Set(Object.keys(translationKeyIndexMap));
        // Replace translation keys in translation usages with the shorter numbers compatible with the optimized
        // language files.
        const usageRegexPrefixPart = '[$.]t[ec]?\\s*\\(\\s*' // Search for $t / $tc / $te calls
            + '|' // or
            // for i18n interpolation components' paths in vue-loader compiled template render functions
            + `${this.matchString('i18n')}\\s*,.*?` // detected within the i18n component
            + `(?:attrs|${this.matchString('attrs')})\\s*:.*?` // attributes which contain
            + `(?:path|${this.matchString('path')})\\s*:\\s*`; // the path which is the translation key
        // Match the translation key which is a (potentially concatenated) string
        const usageRegexTranslationKeyPart = `(?:${this.matchString()}\\s*\\+\\s*)*${this.matchString()}`;
        const usageRegex = new RegExp(`(${usageRegexPrefixPart})(${usageRegexTranslationKeyPart})`, 'gs');

        for (const assetInfo of assetInfos) {
            const source = new ReplaceSource(assetInfo.source);
            // note that all replacement positions are relative to initialCode, regardless of other replacements
            const initialCode = source.source();
            if (typeof initialCode !== 'string') continue;
            let match;

            while ((match = usageRegex.exec(initialCode)) !== null) {
                const [, matchedPrefix, matchedTranslationKey] = match;
                const translationKeyPosition = match.index + matchedPrefix.length;
                const normalizedTranslationKey = this.normalizeString(matchedTranslationKey);
                const translationKeyIndex = translationKeyIndexMap[normalizedTranslationKey];
                if (translationKeyIndex === undefined) {
                    missingTranslations.add(normalizedTranslationKey);
                    continue;
                }
                unusedTranslations.delete(normalizedTranslationKey);

                source.replace(
                    translationKeyPosition, // start, inclusive
                    translationKeyPosition + matchedTranslationKey.length - 1, // end, inclusive
                    // Replacement. 0 requires string delimiter as 0 otherwise treated as falsy / missing key
                    translationKeyIndex === 0 ? '"0"' : `'${translationKeyIndex.toString()}'`,
                );
            }

            assetInfo.source = source;
        }

        return {
            missingTranslations,
            unusedTranslations,
        };
    }

    /**
     * @param {string} str
     * @returns {string}
     */
    normalizeString(str) {
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
    matchString(expectedString = null) {
        if (expectedString === null) {
            // match arbitrary string (note \\\\ in string becomes \\ in regex which matches a literal \)
            return '(?:"(?:\\\\"|[^"])*?"|\'(?:\\\\\'|[^\'])*?\'|`(?:\\\\`|[^`])*?`)';
        } else {
            const escapedString = expectedString.replace(/\n/g, '\\n') // Search newlines as \n escape sequences in code.
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars.
            return `(?:"${escapedString}"|'${escapedString}'|\`${escapedString}\`)`;
        }
    }

    /**
     * @param {string} code
     * @returns {{translationsCode: string, prefix: string, suffix: string}}
     */
    parseLanguageFile(code) {
        const PREFIX_BUILD = /^.*?exports=/s;
        const SUFFIX_BUILD = /}}]\);.*$/s;

        const PREFIX_SERVE = /^.*?exports = /s;
        const SUFFIX_SERVE = /\n{2}\/\*{3}\/ }\).*$/s;

        let prefix = '', suffix = '';
        if (!code.match(PREFIX_BUILD)) {
            prefix = code.match(PREFIX_SERVE)?.[0] || '';
            suffix = code.match(SUFFIX_SERVE)?.[0] || '';
        } else {
            prefix = code.match(PREFIX_BUILD)?.[0] || '';
            suffix = code.match(SUFFIX_BUILD)?.[0] || '';
        }

        if (!prefix || !suffix) throw new Error('Failed to parse language file.');

        const translationsCode = code.substring(prefix.length, code.length - suffix.length);

        return {
            translationsCode,
            prefix,
            suffix,
        };
    }

    /**
     * @param {WebpackCompilation} compilation
     * @param {string} filename
     * @param {Source} source
     */
    updateAsset(compilation, filename, source) {
        if ('options' in compilation) {
            // Webpack 5
            compilation.updateAsset(filename, source);
        } else if ('updateAsset' in compilation) {
            // Webpack >= 4.40
            // Source from webpack-sources is compatible with Webpack 4 and Webpack 5, but @types/webpack@4 has
            // incompatible type definitions from outdated @types/webpack-sources.
            compilation.updateAsset(filename, /** @type {import('webpack-sources').Source} */ (source));
        } else {
            // @ts-ignore: Webpack < 4.40
            compilation.assets[filename] = source;
        }
    }

    /**
     * @param {WebpackCompilation} compilation
     * @param {Set<string>} missingTranslations
     * @param {Set<string>} unusedTranslations
     */
    reportMissingAndUnusedTranslations(compilation, missingTranslations, unusedTranslations) {
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
            this.emitCompilationError(compilation, warnMessage, 'warning');
        }
    }

    /**
     * @param {WebpackCompilation} compilation
     * @param {string} message
     * @param {'error' | 'warning'} [level]
     */
    emitCompilationError(compilation, message, level = 'error') {
        const error = new WebpackError(message);
        error.name = `${this.constructor.name}${level === 'error' ? 'Error' : 'Warning'}`;
        compilation[level === 'error' ? 'errors' : 'warnings'].push(error);
    }
}

module.exports = I18nOptimizerPlugin;
