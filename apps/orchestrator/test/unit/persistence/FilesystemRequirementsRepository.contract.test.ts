import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  runRequirementsRepositoryContractTests,
  type ContractTestContext
} from './RequirementsRepositoryContractTests.js';

runRequirementsRepositoryContractTests(
  'FilesystemRequirementsRepository',
  async (): Promise<ContractTestContext> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-repo-contract-'));
    const repo = new FilesystemRequirementsRepository({ baseDir: tempDir });

    return {
      repo,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      },
      reopen: async () => {
        return new FilesystemRequirementsRepository({ baseDir: tempDir });
      }
    };
  }
);
