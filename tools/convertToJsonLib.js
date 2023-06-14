const fs = require('fs');
const path = require('path');
const glob = require('glob');
const PoParser = require('gettext-parser').po;

const inputGlob = process.argv[2];
if (!inputGlob) {
    console.error(
        'No input file or glob provided.',
        'Usage: $> node node_modules/webpack-i18n-tools/tools/convertToJsonLib.js "<language file or glob>"',
    );
    process.exit(1);
}
const inputFiles = glob.sync(inputGlob);
if (!inputFiles.length) {
    console.error(`No input files found for glob ${inputGlob}.`);
    process.exit(1);
}

for (const inputFile of inputFiles) {
    const buffer = fs.readFileSync(inputFile);

    // Parse the PO file
    const parsed = PoParser.parse(
        buffer,
        // Later versions of gettext-parser expect an options object, but @types/gettext-parser still has the old type
        // of expecting the default charset as second parameter. Thus, we pass it in a way which is compatible with both
        Object.assign('utf8', { defaultCharset: 'utf8' }),
    );

    // Create JSON from parsed data
    /** @type {{[translationReferenceFile: string]: {[translationKey: string]: string}}} */
    const result = {};
    const contexts = Object.keys(parsed.translations);

    for (const context of contexts) {
        const translations = parsed.translations[context];

        for (const translationKey of Object.keys(translations)) {
            const namespacedTranslationKey = context ? `${context}\u0004${translationKey}` : translationKey;
            const translation = translations[translationKey];

            if (!translation.comments || !translation.comments.reference) continue;
            const fuzzy = !!translation.comments.flag.match(/fuzzy/);
            // Extract the reference files (code files that the message strings came from) from the translation comments
            const translationReferenceFiles = translation.comments.reference.split(/\s+/)
                .map((translationReferenceFile) => translationReferenceFile.replace(/:\d+/g, '')) // strip line numbers
                .filter(Boolean); // filter out empty strings

            for (const translationReferenceFile of translationReferenceFiles) {
                result[translationReferenceFile] = {
                    ...result[translationReferenceFile],
                    [namespacedTranslationKey]: !fuzzy && !!translation.msgstr[0]
                        ? translation.msgstr[0]
                        : translationKey, // fallback to the message key as translation
                };
            }
        }
    }

    const langFolder = path.join(
        './src/i18n',
        path.basename(inputFile, path.extname(inputFile)),
    );

    if (!fs.existsSync(langFolder)) {
        fs.mkdirSync(langFolder);
    }

    // Write out the JSON files.
    for (const filepath of Object.keys(result)) {
        const jsonFilename = path.join(
            langFolder,
            path.basename(filepath, '.vue') + '.json'
        );

        fs.writeFileSync(
            jsonFilename,
            JSON.stringify(result[filepath], null, 2),
        );
    }
}
