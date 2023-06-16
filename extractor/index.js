const fs = require('fs');
const SAXParserPromise = import('parse5-sax-parser'); // es modules cannot be imported via require
const gettext = require('gettext-extractor');
const GettextExtractor = gettext.GettextExtractor;
const JsExtractors = gettext.JsExtractors;
const Readable = require('stream').Readable;
const glob = require('glob');

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
    const parseVueFile = async (filename) => {
        const { SAXParser } = await SAXParserPromise;
        return new Promise((resolve) => {
            const htmlStream = fs.createReadStream(filename, {
                encoding: 'utf8',
            });

            const htmlParser = new SAXParser({ sourceCodeLocationInfo: true });

            let depth = 0;

            /** @type {Record<'template' | 'script', {start?: number, line?: number, end?: number} | null>} */
            const sectionLocations = {
                template: null,
                script: null,
            };

            // Get the location of the top-level `template` and `script` tags
            htmlParser.on('startTag', ({ tagName, selfClosing, sourceCodeLocation }) => {
                if (depth === 0
                    && (tagName === 'template' || tagName === 'script')
                    && sourceCodeLocation) {
                    sectionLocations[tagName] = {
                        start: sourceCodeLocation.endOffset,
                        line: sourceCodeLocation.endLine,
                    };
                }

                if (!(selfClosing || selfClosingTags.indexOf(tagName) > -1)) {
                    depth++;
                }
            });

            htmlParser.on('endTag', ({ tagName, sourceCodeLocation }) => {
                depth--;

                if (depth === 0 && (tagName === 'template' || tagName === 'script') && sourceCodeLocation) {
                    sectionLocations[tagName] = {
                        ...sectionLocations[tagName],
                        end: sourceCodeLocation.startOffset,
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
                const templateParser = new SAXParser({ sourceCodeLocationInfo: true });

                // Look for JS expressions in tag attributes
                templateParser.on('startTag', ({ tagName, attrs, sourceCodeLocation }) => {
                    if (!sourceCodeLocation || !('attrs' in sourceCodeLocation)) return;
                    const { attrs: attributeLocations } = (
                        /** @type {import('parse5').StartTagLocation} */ (sourceCodeLocation));
                    for (const attr of attrs) {
                        // We're looking for data bindings, events and directives
                        if (attr.name.match(/^(:|@|v-)/)) {
                            snippets.push({
                                code: attr.value,
                                line: attributeLocations[attr.name].startLine,
                            });
                        }
                        // vue-i18n component interpolation, path attr
                        if (tagName === 'i18n' && (attr.name === 'path' || attr.name === ':path')) {
                            // wrap the path / key in a js snippet including $t for detection by the javascript parser
                            const stringDelimiter = attr.name === 'path'
                                ? ['"', '\'', '`'].find((delimiter) => !attr.value.includes(delimiter))
                                : ''; // none required as the value is already a js snippet with strings marked as such
                            const code = `$t(${stringDelimiter}${attr.value}${stringDelimiter})`;
                            snippets.push({
                                code,
                                line: attributeLocations[attr.name].startLine,
                            });
                        }
                    }
                });

                // Look for interpolations in text contents.
                // We're assuming {{}} as delimiters for interpolations.
                // These delimiters could change using Vue's `delimiters` option.
                // https://vuejs.org/v2/api/#delimiters
                templateParser.on('text', ({ text, sourceCodeLocation }) => {
                    if (!sourceCodeLocation) return;
                    let exprMatch;
                    let lineOffset = 0;

                    while (exprMatch = text.match(/{{([\s\S]*?)}}/)) {
                        const code = exprMatch[1];
                        const prevLinesCount = text.substring(0, exprMatch.index).split(/\r\n|\r|\n/).length;
                        const matchedLinesCount = code.split(/\r\n|\r|\n/).length;

                        lineOffset += prevLinesCount - 1;

                        snippets.push({
                            code,
                            line: sourceCodeLocation.startLine + lineOffset,
                        })

                        text = text.substring(/** @type {number} */ (exprMatch.index) + exprMatch[0].length);

                        lineOffset += matchedLinesCount - 1;
                    }
                });

                const templateStream = Readable.from([template]);
                templateStream.on('end', () => resolve(snippets));
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

    try {
        // Parse typescript and javascript files.
        scriptParser.parseFilesGlob('./src/**/*.{ts,js}');

        // Parse vue files.
        const vueFiles = glob.sync("./src/**/*.vue");
        for (const vueFile of vueFiles) {
            const snippets = await parseVueFile(vueFile)
            for (const { code, line } of snippets) {
                scriptParser.parseString(
                    code,
                    vueFile,
                    { lineNumberStart: line },
                );
            }
        }

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
