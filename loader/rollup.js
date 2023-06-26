const po2json = require('po2json');
const { createFilter } = require('@rollup/pluginutils');

/**
 * @typedef {import('rollup').Plugin} RollupPlugin
 * @typedef {import('@rollup/pluginutils').FilterPattern} RollupPluginFilterPattern
 * @typedef {Partial<Parameters<po2json.parse>[1]>
 *     & {include?: RollupPluginFilterPattern, exclude?: RollupPluginFilterPattern}} RollupPoLoaderOptions
 */

/**
 * @param {RollupPoLoaderOptions} options
 * @returns {RollupPlugin}
 */
module.exports = function rollupPoLoaderPlugin(options = {}) {
    const filter = createFilter(options.include, options.exclude);

    return {
        name: 'po-loader',

        transform(code, id) {
            if (!id.endsWith('.po') || !filter(id)) return null;

            return {
                code: `export default ${po2json.parse(code, {
                    // defaults
                    format: 'mf',
                    'fallback-to-msgid': true,

                    ...options,

                    // enforce stringification
                    stringify: true,
                })};`,
                map: null,
                moduleSideEffects: false,
            };
        },
    };
};
