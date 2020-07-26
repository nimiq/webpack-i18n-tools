const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const gettext = require('gettext-extractor');
const GettextExtractor = gettext.GettextExtractor;
const JsExtractors = gettext.JsExtractors;
const Readable = require('stream').Readable;
const glob = require("glob");
const queue = require('queue');

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

    const parseVueFile = (filename) => {
        return new Promise((resolve) => {
            const readStream = fs.createReadStream(filename, {
                encoding: 'utf8',
            });

            const parser = new parse5.SAXParser({ locationInfo: true });

            let depth = 0;

            const sectionLocations = {
                template: null,
                script: null,
            };

            // Get the location of the `template` and `script` tags, which should be top-level
            parser.on('startTag', (name, attrs, selfClosing, location) => {
                if (depth === 0) {
                    if (name === 'template' || name === 'script') {
                        sectionLocations[name] = {
                            start: location.endOffset,
                            line: location.line,
                        };
                    }
                }

                if (!(selfClosing || selfClosingTags.indexOf(name) > -1)) {
                    depth++;
                }
            });

            parser.on('endTag', (name, location) => {
                depth--;

                if (depth === 0) {
                    if (name === 'template' || name === 'script') {
                        sectionLocations[name].end = location.startOffset;
                    }
                }
            });

            readStream.on('open', () => readStream.pipe(parser));
            readStream.on('end', () => {
                const content = fs.readFileSync(filename, {
                    encoding: 'utf8',
                });

                // Get the contents of the `template` and `script` sections, if present.
                // We're assuming that the content is inline, not referenced by an `src` attribute.
                // https://vue-loader.vuejs.org/en/start/spec.html
                let template = null;
                const snippets = [];

                if (sectionLocations.template) {
                    template = content.substr(
                        sectionLocations.template.start,
                        sectionLocations.template.end - sectionLocations.template.start,
                    );
                }

                if (sectionLocations.script) {
                    snippets.push({
                        code: content.substr(
                            sectionLocations.script.start,
                            sectionLocations.script.end - sectionLocations.script.start,
                        ),
                        line: sectionLocations.script.line,
                    });
                }

                // Parse the template looking for JS expressions
                const templateParser = new parse5.SAXParser({locationInfo: true});

                // Look for JS expressions in tag attributes
                templateParser.on('startTag', (name, attrs, selfClosing, location) => {
                    for (let i = 0; i < attrs.length; i++) {
                        // We're only looking for data bindings, events and directives
                        if (attrs[i].name.match(/^(:|@|v-)/)) {
                            snippets.push({
                                code: attrs[i].value,
                                line: location.attrs[attrs[i].name].line,
                            });
                        }
                        // vue-i18n component interpolation, path attr
                        if (name === 'i18n' && (attrs[i].name === 'path' || attrs[i].name === ':path')) {
                            // wrap the path / key in a js snippet including $t for detection by the javascript parser
                            const stringDelimiter = attrs[i].name === 'path'
                                ? ['"', '\'', '`'].find((delimiter) => !attrs[i].value.includes(delimiter))
                                : ''; // none required as the value is already a js snippet with strings marked as such
                            const code = `$t(${stringDelimiter}${attrs[i].value}${stringDelimiter})`;
                            snippets.push({
                                code,
                                line: location.attrs[attrs[i].name].line,
                            });
                        }
                    }
                });

                // Look for interpolations in text contents.
                // We're assuming {{}} as delimiters for interpolations.
                // These delimiters could change using Vue's `delimiters` option.
                // https://vuejs.org/v2/api/#delimiters
                templateParser.on('text', (text, location) => {
                    let exprMatch;
                    let lineOffset = 0;

                    while (exprMatch = text.match(/{{([\s\S]*?)}}/)) {
                        const prevLines = text.substr(0, exprMatch.index).split(/\r\n|\r|\n/).length;
                        const matchedLines = exprMatch[1].split(/\r\n|\r|\n/).length;

                        lineOffset += prevLines - 1;

                        snippets.push({
                            code: exprMatch[1],
                            line: location.line + lineOffset,
                        })

                        text = text.substr(exprMatch.index + exprMatch[0].length);

                        lineOffset += matchedLines - 1;
                    }
                })

                const s = new Readable;

                s.on('end', () => resolve(snippets));

                s.push(template);
                s.push(null);

                s.pipe(templateParser);
            });
        });
    };

    const q = queue({ concurrency: 1 });
    const outputFile = process.argv[2];

    if (!outputFile) {
        console.error(
            'The path for the output file must be provided and valid.',
            'For example: $> node ./node_modules/translation-key-extractor/index.js ./src/i18n/en.po',
        );
        process.exit(1);
    }

    const parser = extractor.createJsParser([
        // Place all the possible expressions to extract here:
        JsExtractors.callExpression([
            '$t', '[this].$t', 'i18n.t', 'root.$t', 'context.root.$t', '[this].$root.$t', "context.root.$i18n.t",
            '$tc', '[this].$tc', 'i18n.tc', 'root.$tc', 'context.root.$tc', '[this].$root.$tc', "context.root.$i18n.tc",
            '$te', '[this].$te', 'i18n.te', 'root.$te', 'context.root.$te', '[this].$root.$te', "context.root.$i18n.te",
        ], {
            arguments: {
                text: 0,
            }
        }),
        JsExtractors.callExpression([
            'I18nMixin.$t'
        ], {
            arguments: {
                text: 1,
            }
        })
    ]);
    parser.parseFilesGlob('./src/**/*.{ts,js}');

    const files = glob.sync("./src/**/*.vue");
    q.push(...files.map(filename => (cb) => parseVueFile(filename).then(snipps => {
        snipps.forEach(({ code, line }) => {
            parser.parseString(
                code,
                filename,
                { lineNumberStart: line },
            )
        });

        cb();
    })));

    const err = await new Promise((resolve, reject) =>
        q.start((err) => err ? reject(err) : resolve())
    );

    if (!err) {
        extractor.printStats();

        if (writeToFile) {
            extractor.savePotFile(outputFile);
        } else {
            return extractor.getMessages();
        }
    } else {
        console.log(err);
        throw new Error(err);
    }
}
