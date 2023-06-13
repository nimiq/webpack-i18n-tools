const fs = require('fs');
const parse5 = require('parse5');
const gettext = require('gettext-extractor');
const GettextExtractor = gettext.GettextExtractor;
const JsExtractors = gettext.JsExtractors;
const Readable = require('stream').Readable;
const glob = require('glob');
const Queue = require('queue').default;

module.exports = async function(writeToFile = true) {

    const extractor = new GettextExtractor();

    const selfClosingTags = [
        'area',
        'base',
        'br',
        'col',
        'command',
        'embed',
        'hr',
        'img',
        'input',
        'keygen',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr'
    ];

    /**
     * @param {string} filename
     * @returns {Promise<Array<{ code: string, line: number }>>}
     */
    const parseVueFile = (filename) => {
        return new Promise((resolve) => {
            const htmlStream = fs.createReadStream(filename, {
                encoding: 'utf8',
            });

            const htmlParser = new parse5.SAXParser({ locationInfo: true });

            let depth = 0;

            /** @type {Record<'template' | 'script', {start?: number, line?: number, end?: number} | null>} */
            const sectionLocations = {
                template: null,
                script: null,
            };

            // Get the location of the top-level `template` and `script` tags
            htmlParser.on('startTag', (name, attrs, selfClosing, location) => {
                if (depth === 0
                    && (name === 'template' || name === 'script')
                    && location) {
                    sectionLocations[name] = {
                        start: location.endOffset,
                        line: location.line,
                    };
                }

                if (!(selfClosing || selfClosingTags.indexOf(name) > -1)) {
                    depth++;
                }
            });

            htmlParser.on('endTag', (name, location) => {
                depth--;

                if (depth === 0 && (name === 'template' || name === 'script') && location) {
                    sectionLocations[name] = {
                        ...sectionLocations[name],
                        end: location.startOffset,
                    };
                }
            });

            htmlStream.on('open', () => htmlStream.pipe(htmlParser));
            htmlStream.on('end', () => {
                const content = fs.readFileSync(filename, {
                    encoding: 'utf8',
                });

                // Get the contents of the `template` and `script` sections, if present.
                // We're assuming that the content is inline, not referenced by an `src` attribute.
                // https://vue-loader.vuejs.org/en/start/spec.html
                let template = '';
                /** @type {Array<{code: string, line: number}>} */
                const snippets = [];

                if (sectionLocations.template && sectionLocations.template.start && sectionLocations.template.end) {
                    template = content.substring(sectionLocations.template.start, sectionLocations.template.end);
                }

                if (sectionLocations.script
                    && sectionLocations.script.start
                    && sectionLocations.script.end
                    && sectionLocations.script.line) {
                    snippets.push({
                        code: content.substring(sectionLocations.script.start, sectionLocations.script.end),
                        line: sectionLocations.script.line,
                    });
                }

                // Parse the template looking for JS expressions
                const templateParser = new parse5.SAXParser({ locationInfo: true });

                // Look for JS expressions in tag attributes
                templateParser.on('startTag', (name, attrs, selfClosing, location) => {
                    if (!location) return;
                    for (const attr of attrs) {
                        // We're looking for data bindings, events and directives
                        if (attr.name.match(/^(:|@|v-)/)) {
                            snippets.push({
                                code: attr.value,
                                line: location.attrs[attr.name].line,
                            });
                        }
                        // vue-i18n component interpolation, path attr
                        if (name === 'i18n' && (attr.name === 'path' || attr.name === ':path')) {
                            // wrap the path / key in a js snippet including $t for detection by the javascript parser
                            const stringDelimiter = attr.name === 'path'
                                ? ['"', '\'', '`'].find((delimiter) => !attr.value.includes(delimiter))
                                : ''; // none required as the value is already a js snippet with strings marked as such
                            const code = `$t(${stringDelimiter}${attr.value}${stringDelimiter})`;
                            snippets.push({
                                code,
                                line: location.attrs[attr.name].line,
                            });
                        }
                    }
                });

                // Look for interpolations in text contents.
                // We're assuming {{}} as delimiters for interpolations.
                // These delimiters could change using Vue's `delimiters` option.
                // https://vuejs.org/v2/api/#delimiters
                templateParser.on('text', (text, location) => {
                    if (!location) return;
                    let exprMatch;
                    let lineOffset = 0;

                    while (exprMatch = text.match(/{{([\s\S]*?)}}/)) {
                        const code = exprMatch[1];
                        const prevLinesCount = text.substring(0, exprMatch.index).split(/\r\n|\r|\n/).length;
                        const matchedLinesCount = code.split(/\r\n|\r|\n/).length;

                        lineOffset += prevLinesCount - 1;

                        snippets.push({
                            code,
                            line: location.line + lineOffset,
                        })

                        text = text.substring(/** @type {number} */ (exprMatch.index) + exprMatch[0].length);

                        lineOffset += matchedLinesCount - 1;
                    }
                });

                const templateStream = new Readable();

                templateStream.on('end', () => resolve(snippets));

                templateStream.push(template);
                templateStream.push(null);

                templateStream.pipe(templateParser);
            });
        });
    };

    const outputFile = process.argv[2];

    if (writeToFile && !outputFile) {
        console.error(
            'The path for the output file must be provided and valid.',
            'Usage: $> node node_modules/webpack-i18n-tools/index.js <output-language-file>',
        );
        process.exit(1);
    }

    const scriptParser = extractor.createJsParser([
        // Place all the possible expressions to extract here:
        JsExtractors.callExpression([
            '$t', '[this].$t', 'i18n.t', 'root.$t', 'context.root.$t', '[this].$root.$t', "context.root.$i18n.t",
            '$tc', '[this].$tc', 'i18n.tc', 'root.$tc', 'context.root.$tc', '[this].$root.$tc', "context.root.$i18n.tc",
            '$te', '[this].$te', 'i18n.te', 'root.$te', 'context.root.$te', '[this].$root.$te', "context.root.$i18n.te",
        ], {
            arguments: {
                text: 0, // the message is the first argument
            },
        }),
        JsExtractors.callExpression([
            'I18nMixin.$t'
        ], {
            arguments: {
                text: 1, // the message is the second argument
            },
        }),
    ]);

    // Parse typescript and javascript files.
    scriptParser.parseFilesGlob('./src/**/*.{ts,js}');

    // Parse vue files.
    const vueFiles = glob.sync("./src/**/*.vue");
    const vueFileQueue = new Queue({ concurrency: 1 });
    for (const vueFile of vueFiles) {
        vueFileQueue.push(async (cb) => {
            const snippets = await parseVueFile(vueFile)
            for (const { code, line } of snippets) {
                scriptParser.parseString(
                    code,
                    vueFile,
                    { lineNumberStart: line },
                );
            }

            if (!cb) return;
            cb();
        });
    }

    try {
        await new Promise((resolve, reject) => vueFileQueue.start((error) => (!error ? resolve : reject)(error)));
        extractor.printStats();

        if (writeToFile) {
            extractor.savePotFile(outputFile);
        } else {
            return extractor.getMessages();
        }
    } catch (e) {
        console.error(e);
        throw e;
    }
}
