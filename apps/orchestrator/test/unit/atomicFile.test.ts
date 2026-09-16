import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  writeJsonExclusive,
  writeJsonAtomic,
  readJson,
  appendJsonLine,
  readJsonLines,
  ensureDir
} from '../../src/infrastructure/persistence/filesystem/atomicFile.js';
import { ImmutableRecordConflictError } from '../../src/application/ports/persistence/IRequirementsRepository.js';

describe('atomicFile filesystem utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writeJsonExclusive creates a file and throws ImmutableRecordConflictError on existing path', async () => {
    const filePath = path.join(tempDir, 'sub', 'file.json');
    const data1 = { a: 1 };
    await writeJsonExclusive(filePath, data1);

    const readBack = await readJson<typeof data1>(filePath);
    expect(readBack).toEqual(data1);

    const data2 = { a: 2 };
    await expect(writeJsonExclusive(filePath, data2)).rejects.toThrow(ImmutableRecordConflictError);

    // Existing file must be untouched
    const stillData1 = await readJson<typeof data1>(filePath);
    expect(stillData1).toEqual(data1);
  });

  it('writeJsonAtomic safely writes and overwrites files', async () => {
    const filePath = path.join(tempDir, 'atomic.json');
    await writeJsonAtomic(filePath, { version: 1 });
    expect(await readJson<{ version: number }>(filePath)).toEqual({ version: 1 });

    await writeJsonAtomic(filePath, { version: 2 });
    expect(await readJson<{ version: number }>(filePath)).toEqual({ version: 2 });
  });

  it('readJson returns undefined on nonexistent file', async () => {
    const result = await readJson(path.join(tempDir, 'missing.json'));
    expect(result).toBeUndefined();
  });

  it('appendJsonLine and readJsonLines append and read in order', async () => {
    const filePath = path.join(tempDir, 'lines.jsonl');
    expect(await readJsonLines(filePath)).toEqual([]);

    await appendJsonLine(filePath, { seq: 1 });
    await appendJsonLine(filePath, { seq: 2 });
    await appendJsonLine(filePath, { seq: 3 });

    const lines = await readJsonLines<{ seq: number }>(filePath);
    expect(lines).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  it('ensureDir creates directories recursively without error if already existing', async () => {
    const deepDir = path.join(tempDir, 'a', 'b', 'c');
    await ensureDir(deepDir);
    const stat = await fs.stat(deepDir);
    expect(stat.isDirectory()).toBe(true);

    // Idempotent
    await ensureDir(deepDir);
  });
});
