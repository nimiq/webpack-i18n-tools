const po2json = require('po2json');
const utils = require('loader-utils');

module.exports = function(source) {
    if (this.cacheable) this.cacheable();

    const options = utils.getOptions(this) || {};

    if (!('format' in options)) {
        options.format = 'mf';
    }

    if (!('fallback-to-msgid' in options)) {
        options['fallback-to-msgid'] = true;
    }

    const json = po2json.parse(source, options);

    return 'module.exports = ' + JSON.stringify(json);
};
