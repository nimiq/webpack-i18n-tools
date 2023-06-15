const po2json = require('po2json');
const utils = require('loader-utils');

/**
 * @this {import('webpack').LoaderContext<object>}
 * @param {string | Buffer} source
 * @returns {string}
 */
module.exports = function(source) {
    const options = utils.getOptions(this) || {};

    if (!('format' in options)) {
        options.format = 'mf';
    }

    if (!('fallback-to-msgid' in options)) {
        options['fallback-to-msgid'] = true;
    }

    // Note: the spaces here are important for distinguishing a dev build from a minified production build in
    // parseLanguageFile in plugin/index.js.
    return `module.exports = ${po2json.parse(source, {
        ...options,
        stringify: true,
    })}`;
};
