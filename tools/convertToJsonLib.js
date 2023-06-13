const fs = require('fs');
const path = require('path');
const glob = require('glob');
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

inputFiles.forEach((inputFile) => {
    const buffer = fs.readFileSync(inputFile);

    // Parse the PO file
    const parsed = require('gettext-parser').po.parse(buffer, 'utf8');

    // Create JSON from parsed data
    const result = {};
    const contexts = parsed.translations;

    Object.keys(contexts).forEach((context) => {
        const translations = parsed.translations[context];

        Object.keys(translations).forEach((key, i) => {
            const translation = translations[key];

            if (!translation.comments || !translation.comments.reference) return;

            const translationKey = context.length ? context + '\u0004' + key : key;
            const fuzzy = translation.comments && translation.comments.flag && translation.comments.flag.match(/fuzzy/) !== null;

            const translationReferenceFiles = [].concat(
                ...translation.comments.reference
                    .split('\n').map((ref) => ref.split(' '))
            );

            translationReferenceFiles.forEach((translationReferenceFile) => {
                translationReferenceFile = translationReferenceFile.replace(/:\d*/g, "");

                if (!result[translationReferenceFile]) {
                    result[translationReferenceFile] = {};
                }

                result[translationReferenceFile][translationKey] = (!fuzzy && translation.msgstr[0] !== '')
                    ? translation.msgstr[0]
                    : key;
            })
        });
    });

    delete result[''];

    const langFolder = path.join(
        './src/i18n',
        path.basename(inputFile, path.extname(inputFile))
    );

    if (!fs.existsSync(langFolder)) {
        fs.mkdirSync(langFolder);
    }

    // if (inputFile.includes('fr')) {
    //     console.log(JSON.stringify(result, null, 2));
    // }


    Object.keys(result).forEach((filepath) => {
        const jsonFilename = path.join(
            langFolder,
            path.basename(filepath, '.vue') + '.json'
        );

        fs.writeFileSync(
            jsonFilename,
            JSON.stringify(result[filepath], null, 2),
        );
    });

});
