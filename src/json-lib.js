import fs from 'node:fs';
import path from 'node:path';
import gettextParser from 'gettext-parser';

/**
 * Convert language files into JSON files, one JSON file per source file referenced in the language file, such that
 * components of a component library can be imported independently with their respective translations. The JSON files
 * of a language file <language>.po are written to <outputDir>/<language>/.
 *
 * @param {object} options
 * @param {string} options.input - A language file or a glob of language files.
 * @param {string} [options.outputDir] - Defaults to src/i18n.
 * @returns {string[]} The converted language files.
 */
export function convertToJsonLib({ input, outputDir = 'src/i18n' }) {
    const inputFiles = fs.globSync(input);

    for (const inputFile of inputFiles) {
        const buffer = fs.readFileSync(inputFile);

        // Parse the PO file
        const parsed = gettextParser.po.parse(
            buffer,
            // Later versions of gettext-parser expect an options object, but @types/gettext-parser still has the old
            // type of expecting the default charset as second parameter. Thus, we pass it in a way which is compatible
            // with both
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
                const fuzzy = !!translation.comments.flag && translation.comments.flag.includes('fuzzy');
                // Extract the reference files (code files that the message strings came from) from the translation
                // comments
                const translationReferenceFiles = translation.comments.reference.split(/\s+/)
                    .map((translationReferenceFile) => translationReferenceFile.replace(/:\d+/g, '')) // strip lines
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

        const langFolder = path.join(outputDir, path.basename(inputFile, path.extname(inputFile)));
        fs.mkdirSync(langFolder, { recursive: true });

        // Write out the JSON files.
        for (const filepath of Object.keys(result)) {
            const jsonFilename = path.join(
                langFolder,
                path.basename(filepath, '.vue') + '.json',
            );

            fs.writeFileSync(
                jsonFilename,
                JSON.stringify(result[filepath], null, 2),
            );
        }
    }

    return inputFiles;
}
