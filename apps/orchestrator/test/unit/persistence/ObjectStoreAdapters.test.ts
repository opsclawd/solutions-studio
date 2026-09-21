import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { FilesystemObjectStore } from '../../../src/infrastructure/persistence/object-store/FilesystemObjectStore.js';
import { AzureBlobStorageAdapter } from '../../../src/infrastructure/persistence/object-store/AzureBlobStorageAdapter.js';
import type { IObjectStore } from '../../../src/application/ports/persistence/IObjectStore.js';

function runCommonObjectStoreTests(
  name: string,
  storeFactory: () => Promise<IObjectStore> | IObjectStore
) {
  describe(`IObjectStore Contract: ${name}`, () => {
    let store: IObjectStore;

    beforeEach(async () => {
      store = await storeFactory();
    });

    it('puts and gets object as buffer and string', async () => {
      const content = 'Hello world, this is a test blob.';
      const meta = await store.putObject('test/blob.txt', content, {
        contentType: 'text/plain'
      });

      expect(meta.key).toBe('test/blob.txt');
      expect(meta.sizeBytes).toBe(Buffer.byteLength(content));
      expect(meta.contentHash).toBeDefined();

      const exists = await store.hasObject('test/blob.txt');
      expect(exists).toBe(true);

      const buf = await store.getObject('test/blob.txt');
      expect(buf).toBeDefined();
      expect(buf?.toString('utf8')).toBe(content);

      const str = await store.getObjectString('test/blob.txt');
      expect(str).toBe(content);
    });

    it('returns undefined for non-existent objects', async () => {
      const buf = await store.getObject('does-not-exist.txt');
      expect(buf).toBeUndefined();

      const str = await store.getObjectString('does-not-exist.txt');
      expect(str).toBeUndefined();

      const exists = await store.hasObject('does-not-exist.txt');
      expect(exists).toBe(false);
    });

    it('handles overwrite: false correctly', async () => {
      await store.putObject('unique.txt', 'first');
      await expect(store.putObject('unique.txt', 'second', { overwrite: false })).rejects.toThrow();
    });

    it('deletes objects', async () => {
      await store.putObject('to-delete.txt', 'delete me');
      expect(await store.hasObject('to-delete.txt')).toBe(true);

      const deleted = await store.deleteObject('to-delete.txt');
      expect(deleted).toBe(true);
      expect(await store.hasObject('to-delete.txt')).toBe(false);

      const deletedAgain = await store.deleteObject('to-delete.txt');
      expect(deletedAgain).toBe(false);
    });

    it('lists objects with and without prefix', async () => {
      await store.putObject('sources/s1/rev1.md', 'source 1');
      await store.putObject('sources/s1/rev2.md', 'source 2');
      await store.putObject('projections/proj1.json', 'projection 1');

      const all = await store.listObjects();
      expect(all.length).toBe(3);

      const sourcesOnly = await store.listObjects('sources/');
      expect(sourcesOnly.length).toBe(2);
      expect(sourcesOnly.map((o) => o.key)).toEqual(['sources/s1/rev1.md', 'sources/s1/rev2.md']);

      const projOnly = await store.listObjects('projections/');
      expect(projOnly.length).toBe(1);
      expect(projOnly[0].key).toBe('projections/proj1.json');
    });

    it('reports health correctly', async () => {
      const health = await store.checkHealth();
      expect(health.status).toBe('healthy');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
}

describe('Object Store Adapters', () => {
  runCommonObjectStoreTests('InMemoryObjectStore', () => new InMemoryObjectStore());

  let tempDir: string;
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-obj-store-test-'));
  });
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  runCommonObjectStoreTests(
    'FilesystemObjectStore',
    () => new FilesystemObjectStore({ baseDir: tempDir })
  );

  describe('FilesystemObjectStore security', () => {
    it('prevents path traversal attempts', async () => {
      const store = new FilesystemObjectStore({ baseDir: tempDir });
      await expect(store.putObject('../escaped.txt', 'bad')).rejects.toThrow();
    });
  });

  describe('AzureBlobStorageAdapter', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('constructs correct headers and URL for SharedKey authentication', async () => {
      let capturedRequest: { url: string; method: string; headers: Headers } | undefined;

      globalThis.fetch = vi
        .fn()
        .mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          capturedRequest = {
            url: url.toString(),
            method: init?.method ?? 'GET',
            headers
          };
          return new Response(null, { status: 201, statusText: 'Created' });
        });

      const adapter = new AzureBlobStorageAdapter({
        accountName: 'mystorageaccount',
        containerName: 'mycontainer',
        accountKey: Buffer.from('test-key-123456789012345678901234').toString('base64')
      });

      const meta = await adapter.putObject('artifacts/test.txt', 'payload', {
        contentType: 'text/plain'
      });

      expect(meta.key).toBe('artifacts/test.txt');
      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.url).toBe(
        'https://mystorageaccount.blob.core.windows.net/mycontainer/artifacts/test.txt'
      );
      expect(capturedRequest?.method).toBe('PUT');
      expect(capturedRequest?.headers.get('x-ms-version')).toBe('2023-11-03');
      expect(capturedRequest?.headers.get('Authorization')).toMatch(/^SharedKey mystorageaccount:/);
      expect(capturedRequest?.headers.get('Content-Type')).toBe('text/plain');
    });

    it('constructs correct URL with SAS token', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        capturedUrl = url.toString();
        return new Response(null, { status: 200 });
      });

      const adapter = new AzureBlobStorageAdapter({
        accountName: 'mystorageaccount',
        containerName: 'mycontainer',
        sasToken: '?sp=r&st=2026-01-01&se=2026-12-31&spr=https&sv=2023-11-03&sr=c&sig=mock-sig'
      });

      const exists = await adapter.hasObject('test.json');
      expect(exists).toBe(true);
      expect(capturedUrl).toContain('sp=r');
      expect(capturedUrl).toContain('sig=mock-sig');
    });

    it('returns undefined on 404 for getObject', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response('Not Found', { status: 404 });
      });

      const adapter = new AzureBlobStorageAdapter({
        accountName: 'mystorageaccount',
        containerName: 'mycontainer',
        accountKey: Buffer.from('test-key-123456789012345678901234').toString('base64')
      });

      const result = await adapter.getObject('missing.txt');
      expect(result).toBeUndefined();
    });

    it('parses XML list response correctly', async () => {
      const mockXml = `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://mystorageaccount.blob.core.windows.net/" ContainerName="mycontainer">
  <Blobs>
    <Blob>
      <Name>folder/file1.txt</Name>
      <Properties>
        <Last-Modified>Wed, 09 Sep 2026 09:20:00 GMT</Last-Modified>
        <Content-Length>1024</Content-Length>
        <Content-Type>text/plain</Content-Type>
      </Properties>
      <Metadata>
        <contenthash>abc123hash</contenthash>
      </Metadata>
    </Blob>
  </Blobs>
</EnumerationResults>`;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(mockXml, { status: 200 });
      });

      const adapter = new AzureBlobStorageAdapter({
        accountName: 'mystorageaccount',
        containerName: 'mycontainer',
        accountKey: Buffer.from('test-key-123456789012345678901234').toString('base64')
      });

      const list = await adapter.listObjects('folder/');
      expect(list.length).toBe(1);
      expect(list[0].key).toBe('folder/file1.txt');
      expect(list[0].sizeBytes).toBe(1024);
      expect(list[0].contentType).toBe('text/plain');
      expect(list[0].contentHash).toBe('abc123hash');
    });
  });
});
