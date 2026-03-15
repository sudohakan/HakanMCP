import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Postman Tools', () => {
  let testPostmanDir: string;
  let testCollectionPath: string;
  let postmanTools: Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  let fetchMock: jest.Mock;

  beforeAll(async () => {
    fetchMock = jest.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            entries: () => [['content-type', 'application/json']][Symbol.iterator](),
            get: () => 'application/json',
          },
          text: async () => '{"ok":true}',
        }) as { content: Array<{ text: string }> },
    );

    await jest.unstable_mockModule('node-fetch', () => ({
      __esModule: true,
      default: fetchMock,
    }));

    const mod = await import('../src/tools/postman');
    postmanTools = mod.postmanTools;
  });

  // Sample Postman collection
  const sampleCollection = {
    info: {
      name: 'Test Collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Get Users',
        request: {
          method: 'GET',
          header: [{ key: 'Content-Type', value: 'application/json' }],
          url: {
            raw: 'https://api.example.com/users',
            protocol: 'https',
            host: ['api', 'example', 'com'],
            path: ['users'],
          },
        },
        response: [
          {
            name: 'Success Response',
            code: 200,
            body: '{"users": []}',
          },
        ],
      },
      {
        name: 'Create User',
        request: {
          method: 'POST',
          header: [{ key: 'Content-Type', value: 'application/json' }],
          body: {
            mode: 'raw',
            raw: '{"name": "John Doe", "email": "john@example.com"}',
          },
          url: 'https://api.example.com/users',
        },
        response: [],
      },
    ],
  };

  beforeEach(() => {
    // Create unique test directory
    testPostmanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postman-test-'));
    testCollectionPath = path.join(testPostmanDir, 'test.postman_collection.json');
    if (fetchMock) {
      fetchMock.mockClear();
    }

    // Set POSTMAN_DIR environment for tests
    process.env.POSTMAN_DIR = testPostmanDir;

    // Write sample collection
    fs.writeFileSync(testCollectionPath, JSON.stringify(sampleCollection, null, 2), 'utf8');
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testPostmanDir)) {
      fs.rmSync(testPostmanDir, { recursive: true, force: true });
    }
  });

  describe('pm_listCollections', () => {
    it('should list Postman collection files', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_listCollections');
      expect(tool).toBeDefined();

      const result = await tool!.handler({});

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBe(1);
      expect(response.files).toContain('test.postman_collection.json');
    });

    it('should handle multiple collections', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_listCollections');

      // Create another collection
      fs.writeFileSync(
        path.join(testPostmanDir, 'another.postman_collection.json'),
        JSON.stringify(sampleCollection, null, 2),
        'utf8',
      );

      const result = await tool!.handler({});

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBe(2);
    });
  });

  describe('pm_listRequests', () => {
    it('should list all requests in collection', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_listRequests');

      const result = await tool!.handler({ file: 'test.postman_collection.json' });

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBe(2);
      expect(response.requests[0].name).toBe('Get Users');
      expect(response.requests[0].method).toBe('GET');
      expect(response.requests[1].name).toBe('Create User');
      expect(response.requests[1].method).toBe('POST');
    });
  });

  describe('pm_getRequest', () => {
    it('should get request details by name', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_getRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Get Users',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.name).toBe('Get Users');
      expect(response.method).toBe('GET');
      expect(response.url).toContain('users');
      expect(response.headers).toHaveLength(1);
      expect(response.examples).toHaveLength(1);
    });

    it('should be case-insensitive', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_getRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'get users',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.name).toBe('Get Users');
    });

    it('should throw error for non-existent request', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_getRequest');

      await expect(
        tool!.handler({
          file: 'test.postman_collection.json',
          name: 'Non Existent',
        }),
      ).rejects.toThrow('Request not found');
    });
  });

  describe('pm_searchRequests', () => {
    it('should search requests by name', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_searchRequests');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        q: 'user',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBe(2);
    });

    it('should search by HTTP method', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_searchRequests');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        q: 'POST',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBe(1);
      expect(response.results[0].name).toBe('Create User');
    });

    it('should support regex patterns', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_searchRequests');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        q: 'Get.*',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('pm_requestToMarkdown', () => {
    it('should convert request to markdown format', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_requestToMarkdown');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Create User',
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('### Create User');
      expect(markdown).toContain('POST');
      expect(markdown).toContain('users');
      expect(markdown).toContain('curl');
      expect(markdown).toContain('Request Headers');
      expect(markdown).toContain('Request Body');
    });
  });

  describe('pm_addRequest', () => {
    it('should add new request to collection', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_addRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        request: {
          name: 'Delete User',
          method: 'DELETE',
          url: 'https://api.example.com/users/123',
          headers: [{ key: 'Authorization', value: 'Bearer token' }],
        },
      });

      expect(result.content[0].text).toContain('New request added');

      // Verify it was added
      const collection = JSON.parse(fs.readFileSync(testCollectionPath, 'utf8'));
      expect(collection.item).toHaveLength(3);
      expect(collection.item[2].name).toBe('Delete User');
    });
  });

  describe('pm_updateRequest', () => {
    it('should update request method', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_updateRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Get Users',
        updates: {
          method: 'PUT',
        },
      });

      expect(result.content[0].text).toContain('Request updated');

      // Verify update
      const collection = JSON.parse(fs.readFileSync(testCollectionPath, 'utf8'));
      const updated = collection.item.find((i: { name?: string }) => i.name === 'Get Users');
      expect(updated.request.method).toBe('PUT');
    });

    it('should rename request', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_updateRequest');

      await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Get Users',
        updates: {
          newName: 'Fetch All Users',
        },
      });

      const collection = JSON.parse(fs.readFileSync(testCollectionPath, 'utf8'));
      const updated = collection.item.find((i: { name?: string }) => i.name === 'Fetch All Users');
      expect(updated).toBeDefined();
    });

    it('should update URL', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_updateRequest');

      await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Get Users',
        updates: {
          url: 'https://api.new-domain.com/users',
        },
      });

      const collection = JSON.parse(fs.readFileSync(testCollectionPath, 'utf8'));
      const updated = collection.item.find((i: { name?: string }) => i.name === 'Get Users');
      expect(updated.request.url.raw).toBe('https://api.new-domain.com/users');
    });
  });

  describe('pm_deleteRequest', () => {
    it('should delete request from collection', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_deleteRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Create User',
      });

      expect(result.content[0].text).toContain('Request deleted');

      // Verify deletion
      const collection = JSON.parse(fs.readFileSync(testCollectionPath, 'utf8'));
      expect(collection.item).toHaveLength(1);
      expect(collection.item[0].name).toBe('Get Users');
    });

    it('should throw error for non-existent request', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_deleteRequest');

      await expect(
        tool!.handler({
          file: 'test.postman_collection.json',
          name: 'Non Existent',
        }),
      ).rejects.toThrow('Request not found');
    });
  });

  describe('pm_cloneRequest', () => {
    it('should clone existing request', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_cloneRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        sourceName: 'Get Users',
        newName: 'Get Users Copy',
      });

      expect(result.content[0].text).toContain('Request cloned');

      // Verify clone
      const collection = JSON.parse(fs.readFileSync(testCollectionPath, 'utf8'));
      expect(collection.item).toHaveLength(3);

      const original = collection.item.find((i: { name?: string }) => i.name === 'Get Users');
      const clone = collection.item.find((i: { name?: string }) => i.name === 'Get Users Copy');

      expect(clone).toBeDefined();
      expect(clone.request.method).toBe(original.request.method);
    });
  });

  describe('pm_executeRequest', () => {
    it('should execute HTTP request', async () => {
      const tool = postmanTools.find((t) => t.name === 'pm_executeRequest');

      const result = await tool!.handler({
        file: 'test.postman_collection.json',
        name: 'Get Users',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.response.status).toBe(200);
      expect(response.request.method).toBe('GET');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    }, 30000);
  });
});
