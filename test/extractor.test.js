import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { extractCommand } from './api.js';
import { createTempDir, fixture } from './utils.js';

describe('extractor', () => {
    it('extracts translations from js, ts and vue files', () => {
        const outputFile = path.join(createTempDir(), 'en.po');
        execFileSync(process.execPath, extractCommand(outputFile), { cwd: fixture('extract'), stdio: 'pipe' });
        expect(fs.readFileSync(outputFile, 'utf8')).toMatchSnapshot();
    });
});
