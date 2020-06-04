const fs = require('fs');
const glob = require('glob');
const JSON5 = require('json5');
const { ReplaceSource } = require('webpack-sources');

/**
 * Webpack plugin that optimizes language files and their usage by replacing translation keys by shorter numbers while
 * preserving proper sourcemaps.
 *
 * Note that we use a plugin and not a webpack loader as loaders should not depend on other assets and plugins are
 * generally more powerful. We also take advantage of code minification concatenating translation keys which we use to
 * normalize the keys in the source code before replacing them.
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
 */
class I18nOptimizerPlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, compilation => {
            if (compilation.hooks.processAssets) {
                // Webpack >= 5
                // TODO This is untested. Need to check whether code minification runs before our turn.
                compilation.hooks.processAssets.tap(
                    {
                        name: this.constructor.name,
                        stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
                    },
                    () => this.optimizeAssets(compilation),
                );
            } else {
                // Webpack < 5
                // We want to run after code minification by other plugins, however note that the optimizeAssets hook is
                // too late as it is invoked after sourcemap generation, therefore we use afterOptimizeChunkAssets.
                compilation.hooks.afterOptimizeChunkAssets.tap(
                    this.constructor.name,
                    () => this.optimizeAssets(compilation),
                );
            }
        });
    }

    optimizeAssets(compilation) {
        const assets = compilation.assets; // maps filename -> source
        // categorize assets and parse language files
        let referenceLanguageFileInfo;
        const languageFileInfos = [];
        const otherAssetInfos = [];
        for (const [filename, source] of Object.entries(assets)) {
            if (!filename.endsWith('.js')) continue;
            if (/-po(?:-legacy)?(?:\.[^.]*)?\.js$/.test(filename)) {
                const languageFileInfo = {
                    filename,
                    source,
                    ...this.parseLanguageFile(source.source()),
                };
                languageFileInfos.push(languageFileInfo);
                if (filename.includes('en-po')) {
                    referenceLanguageFileInfo = languageFileInfo;
                }
            } else {
                otherAssetInfos.push({ filename, source });
            }
        }

        if (!referenceLanguageFileInfo) return;

        const fallbackTranslations = JSON5.parse(referenceLanguageFileInfo.translationsCode);
        const translationKeys = Object.keys(fallbackTranslations);

        this.optimizeLanguageFiles(languageFileInfos, translationKeys, fallbackTranslations);
        this.optimizeTranslationUsages(otherAssetInfos, translationKeys);

        for (const { filename, source } of [...languageFileInfos, ...otherAssetInfos]) {
            this.updateAsset(compilation, filename, source);
        }
    }

    optimizeLanguageFiles(languageFileInfos, translationKeys, fallbackTranslations) {
        // Replace the keys of the translations object by shorter numbers and fill in fallback translations where no
        // translation is available.
        const entryRegexs = translationKeys.map((translationKey) => new RegExp(
            `(${this.generateKeyRegex(translationKey, true)})` // translation key
                + '(\\s*:\\s*)' // double colon
                + '("(?:[^"]|\\")*"|\'(?:[^\']|\\\')*\'|`(?:[^`]|\\`)*`)', // translation with string delimiters
        ));

        for (const languageFileInfo of languageFileInfos) {
            const { translationsCode, prefix } = languageFileInfo;
            // Make code modifications using ReplaceSource to automatically update sourcemaps
            const source = new ReplaceSource(languageFileInfo.source);

            // Note that all positions are relative to the original source, regardless of replacements.
            const insertionPosition = prefix.length + translationsCode.length - 1; // before } of translations object
            let hasTrailingComma = translationsCode[translationsCode.length - 2] === ',';

            for (let i = 0; i < translationKeys.length; ++i) {
                const translationKey = translationKeys[i];
                const entryRegex = entryRegexs[i];
                const fallbackTranslation = (fallbackTranslations[translationKey] || translationKey)
                    .replace(/\n/g, '\\n');

                const match = translationsCode.match(entryRegex);
                if (match !== null) {
                    const [, matchedTranslationKey, matchedDoubleColon, matchedTranslation] = match;
                    const matchPosition = prefix.length + match.index;
                    source.replace(
                        matchPosition, // start, inclusive
                        matchPosition + matchedTranslationKey.length - 1, // end, inclusive
                        i.toString(), // replacement
                    );

                    // Use fallback translation if translation is empty (consist only of string separators). Note that
                    // this case does not actually appear when using the po loader as it automatically assigns the key
                    // as translation if the translation is empty.
                    if (matchedTranslation.length === 2) {
                        const translationPosition = matchPosition + matchedTranslationKey.length
                            + matchedDoubleColon.length;
                        source.replace(
                            translationPosition, // start, inclusive
                            translationPosition + matchedTranslation.length - 1, // end, inclusive,
                            `"${fallbackTranslation}"`, // replacement
                        );
                    }
                } else {
                    // Entry not found. create it with fallback translation.
                    source.insert(
                        insertionPosition,
                        `${hasTrailingComma ? '' : ','}${i}:"${fallbackTranslation}"`,
                    );
                    hasTrailingComma = false;
                }
            }

            languageFileInfo.source = source;
        }
    }

    optimizeTranslationUsages(assetInfos, translationKeys) {
        // Replace translation keys in translation usages with the shorter numbers compatible with the optimized
        // language files.
        const usageRegexPrefixPart = '[$.]t[ec]?\\s*\\(\\s*' // Search for $t / $tc / $te calls
            + '|' // or
            // for i18n interpolation components' paths in vue-loader compiled template render functions
            + `${this.generateKeyRegex('i18n', false)}\\s*,.*?` // detected within the i18n component
            + `${this.generateKeyRegex('attrs', true)}\\s*:.*?` // attributes which contain
            + `${this.generateKeyRegex('path', true)}\\s*:\\s*`; // the path which is the translation key
        const usageRegexs = translationKeys.map((translationKey) => new RegExp(
            `(${usageRegexPrefixPart})` // prefix
            + `(${this.generateKeyRegex(translationKey, false)})`, // translation key
            'gs'));

        for (const assetInfo of assetInfos) {
            const source = new ReplaceSource(assetInfo.source);
            // note that all replacement positions are relative to initialCode, regardless of other replacements
            const initialCode = source.source();
            for (let i = 0; i < translationKeys.length; ++i) {
                const usageRegex = usageRegexs[i];
                let match;

                while ((match = usageRegex.exec(initialCode)) !== null) {
                    const [, matchedPrefix, matchedTranslationKey] = match;
                    const translationKeyPosition = match.index + matchedPrefix.length;
                    source.replace(
                        translationKeyPosition, // start, inclusive
                        translationKeyPosition + matchedTranslationKey.length - 1, // end, inclusive
                        i.toString(), // replacement
                    );
                }
            }

            assetInfo.source = source;
        }
    }

    generateKeyRegex(key, allowNonStringKey) {
        const escapedKey = key.replace(/\n/g, '\\n') // Search newlines as \n escape sequences in code.
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars.
        const keyDelimiters = ['\'', '"', '`'];
        if (allowNonStringKey && !/\s/.test(key)) {
            // A key without whitespaces can be encoded as simple object key instead of string.
            keyDelimiters.push('');
        }
        return `(?:${keyDelimiters.map((delimiter) => `${delimiter}${escapedKey}${delimiter}`).join('|')})`;
    }

    parseLanguageFile(code) {
        const PREFIX_BUILD = /^.*?exports=/s;
        const SUFFIX_BUILD = /}}]\);.*$/s;

        const PREFIX_SERVE = /^.*?exports = /s;
        const SUFFIX_SERVE = /\n{2}\/\*{3}\/ }\).*$/s;

        let prefix = '', suffix = '';
        if (!code.match(PREFIX_BUILD)) {
            prefix = code.match(PREFIX_SERVE)[0];
            suffix = code.match(SUFFIX_SERVE)[0];
        } else {
            prefix = code.match(PREFIX_BUILD)[0];
            suffix = code.match(SUFFIX_BUILD)[0];
        }

        const translationsCode = code.substring(prefix.length, code.length - suffix.length);

        return {
            translationsCode,
            prefix,
            suffix,
        };
    }

    updateAsset(compilation, filename, source) {
        if (compilation.updateAsset) {
            // Webpack >= 4.40
            compilation.updateAsset(filename, source);
        } else {
            compilation.assets[filename] = source;
        }
    }
}

module.exports = I18nOptimizerPlugin;
