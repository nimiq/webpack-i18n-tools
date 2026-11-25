import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {string} name */
export const fixture = (name) => path.join(import.meta.dirname, 'fixtures', name);

export function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-tools-test-'));
}
