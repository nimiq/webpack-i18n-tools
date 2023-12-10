const path = require('path');
// We also use webpack-sources for our rollup builds, as alternative to magic-string which is usually used in rollup
// plugins. There is currently a discrepancy between the latest @types/webpack-sources and the types that webpack
// defines internally for webpack-sources.
const OriginalSource = /** @type {typeof import('webpack5').sources.OriginalSource} */ (
    /** @type {unknown} */ (require('webpack-sources').OriginalSource));
const processChunks = require('./common.js');

/**
 * @typedef {import('rollup').Plugin} RollupPlugin
 * @typedef {import('rollup').OutputBundle} OutputBundle
 *
 * @typedef {import('webpack5').sources.Source} Source - Actually is from webpack-sources, but use types from webpack5
 *
 * @typedef {import('./common').ChunkInfo} ChunkInfo
 * @typedef {import('./common').LanguageChunkInfo} LanguageChunkInfo
 */

/**
 * @returns {RollupPlugin & {apply: 'build'}}
 */
module.exports = function rollupI18nOptimizerPlugin() {
    return {
        name: 'po-optimizer',

        // If used as a vite plugin, explicitly only apply it during builds, not in the dev server. This plugin is
        // executed in the output generation phase via generateBundle, and therefore does not run in vite dev servers
        // (see https://vitejs.dev/guide/api-plugin.html#universal-hooks).
        // To avoid this limitation, we could consider transforming language files and language usages in a transform
        // hook. However, this complicates things because then, en.po as reference file needs to manually be loaded
        // first via load() and caches of all modules need to be invalidated via shouldTransformCachedModule and
        // potentially be retriggered via load() of the modules. On the other hand, additional advantages would be that
        // we would not need to work on already minified code, our modifications are automatically reflected in file
        // hashes, and createFilter could be used.
        apply: 'build', // see https://vitejs.dev/guide/api-plugin.html#conditional-application

        // Augment content hashes of translation files with contents of the source language file. This is because the
        // content of the compiled translation file does not only depend on the translation po file, but also on the
        // source language file for added fallback translations and for translation indices.
        augmentChunkHash(chunk) {
            if (!chunk.facadeModuleId || !/(?<!\ben)\.po$/.test(chunk.facadeModuleId)) return; // not a translation
            const referenceLanguageModuleId = [...this.getModuleIds()].find((moduleId) => /\ben\.po$/.test(moduleId));
            const referenceLanguageModuleInfo = this.getModuleInfo(referenceLanguageModuleId || '');
            if (!referenceLanguageModuleInfo || !referenceLanguageModuleInfo.code) {
                this.error('Reference language module en.po not found');
                return;
            }
            return referenceLanguageModuleInfo.code;
        },

        generateBundle(outputOptions, bundle) {
            // categorize assets and parse language files
            /** @type {LanguageChunkInfo[]} */
            const languageChunkInfos = [];
            /** @type {ChunkInfo[]} */
            const otherChunkInfos = [];
            for (const [filename, fileInfo] of Object.entries(bundle)) {
                if (fileInfo.type !== 'chunk' || path.basename(filename).startsWith('vendor.')) continue;
                const moduleIds = Object.keys(fileInfo.modules); // in rollup 2 fileInfo.moduleIds is not available yet
                const languageFileModuleName = moduleIds.find((moduleId) => moduleId.endsWith('.po'));
                const source = new OriginalSource(fileInfo.code, filename);
                if (languageFileModuleName) {
                    try {
                        if (moduleIds.length > 1) {
                            throw new Error('Language file parsing currently only supports unbundled files.');
                        }
                        languageChunkInfos.push({
                            filename,
                            source,
                            ...parseLanguageChunk(fileInfo.code, fileInfo.modules[languageFileModuleName].code || ''),
                        });
                    } catch (e) {
                        this.error(`Failed to parse language file ${languageFileModuleName}. Note that currently `
                            + 'bundling of language files is not supported by our rollup plugin. Each language file '
                            + 'has to be its own chunk.');
                        return;
                    }
                } else {
                    otherChunkInfos.push({ filename, source });
                }
            }

            try {
                processChunks(
                    languageChunkInfos,
                    otherChunkInfos,
                    (filename, source) => updateChunk(bundle, filename, source),
                    (warning) => this.warn(warning),
                )
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                this.error(errorMessage);
            }
        },
    };
};

/**
 * @param {string} chunkCode
 * @param {string} moduleCode
 * @returns {{translationsCode: string, prefix: string, suffix: string}}
 */
function parseLanguageChunk(chunkCode, moduleCode) {
    const prefix = chunkCode.match(/^[^{]*/)?.[0];
    const suffix = chunkCode.match(/;?\s*export\s*\{\s*\w+ as default\s*};?\n?$/)?.[0];

    // Rollup modifies the module code when creating the chunk code, which can result in the translationCode not being
    // valid json, just a Javascript object definition anymore. Notably, this is the case for strings that contain \n
    // newlines, which rollup transforms into template strings with actual newlines, which are not valid JSON strings
    // though. Therefore, we extract the json, which is to be parsed later, from the original module code. Note that we
    // also still need the extracted translation code from the chunk, because that's the code that we modify in the end.
    // Alternatively, the json or parsed object could also be added as metadata by the loader plugin, which would result
    // in tighter coupling between the plugins though (https://rollupjs.org/plugin-development/#custom-module-meta-data)
    const translationsJson = moduleCode.match(/\{.+}/)?.[0];

    if (!prefix || !suffix || !translationsJson) throw new Error('Failed to parse language file.');

    const translationsCode = chunkCode.substring(prefix.length, chunkCode.length - suffix.length);

    return {
        translationsCode,
        prefix,
        suffix,
        ...(translationsJson !== translationsCode ? { translationsJson } : null),
    };
}

/**
 * @param {OutputBundle} outputBundle
 * @param {string} filename
 * @param {Source} source
 */
function updateChunk(outputBundle, filename, source) {
    const { source: code, map } = /** @type {{
        source: ReturnType<Source['sourceAndMap']>['source'],
        map: ReturnType<Source['map']>, // map is typed inaccurately as just Object in sourceAndMap
    }} */ (source.sourceAndMap());
    if (typeof code !== 'string') return; // should never happen
    const chunkInfo = outputBundle[filename];
    if (chunkInfo.type !== 'chunk') {
        chunkInfo.source = code;
    } else {
        chunkInfo.code = code;
        if (!map) return;
        chunkInfo.map = {
            // taken from rollup's SourceMap implementation
            toString() {
                return JSON.stringify(this);
            },
            toUrl() {
                return 'data:application/json;charset=utf-8;base64,' + btoa(this.toString());
            },

            ...map,
            sourcesContent: map.sourcesContent || [],
        };
    }
}
