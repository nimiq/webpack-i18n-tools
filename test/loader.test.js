import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { poLoader } from './api.js';
import { fixture } from './utils.js';

const languageFile = (language) => path.join(fixture('bundle'), 'src/i18n', `${language}.po`);

/**
 * @param {ReturnType<typeof poLoader>} plugin
 * @param {string} id
 */
function transform(plugin, id) {
    const code = fs.existsSync(id) ? fs.readFileSync(id, 'utf8') : '';
    const transformHook = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler;
    return transformHook.call(/** @type {any} */ ({}), code, id);
}

describe('po loader', () => {
    it.each(['en', 'de'])('converts %s.po to a module exporting the translations', (language) => {
        const result = transform(poLoader(), languageFile(language));
        expect(result.code).toMatchSnapshot();
        expect(result.map).toBe(null);
        expect(result.moduleSideEffects).toBe(false);
    });

    it('ignores files other than .po files', () => {
        expect(transform(poLoader(), path.join(fixture('bundle'), 'src/main.js'))).toBe(null);
    });

    it('respects include and exclude', () => {
        expect(transform(poLoader({ exclude: '**/de.po' }), languageFile('de'))).toBe(null);
        expect(transform(poLoader({ include: '**/en.po' }), languageFile('de'))).toBe(null);
        expect(transform(poLoader({ include: '**/de.po' }), languageFile('de'))).not.toBe(null);
    });
});
