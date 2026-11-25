import { createFilter } from '@rollup/pluginutils';
import po2json from 'po2json';

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
export function poLoader(options = {}) {
    const filter = createFilter(options.include, options.exclude);

    return {
        name: 'po-loader',

        transform: {
            filter: { id: /\.po$/ }, // hook filter, for Rolldown and Rollup >= 4.38 to skip other modules efficiently
            handler(code, id) {
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
        },
    };
}
