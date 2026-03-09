import fs from 'node:fs';
import path from 'node:path';
import {
  upsertConnection,
  listConnections,
  deleteConnection,
  getConnection,
  maskConnection,
  type Connection,
} from '../src/utils/connections.js';

describe('Connections Utility', () => {
  const testConnPath = path.join(process.cwd(), 'logs', 'flows', 'test-connections-unit.json');

  beforeEach(() => {
    process.env.FLOW_CONNECTIONS_PATH = testConnPath;
    if (fs.existsSync(testConnPath)) {
      fs.unlinkSync(testConnPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConnPath)) {
      fs.unlinkSync(testConnPath);
    }
    delete process.env.FLOW_CONNECTIONS_PATH;
  });

  describe('upsertConnection', () => {
    it('creates a new connection', () => {
      const input = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: { url: 'https://example.com', apiKey: 'secret123' },
      };

      const result = upsertConnection(input);

      expect(result.id).toBe('conn-1');
      expect(result.name).toBe('Test Connection');
      expect(result.type).toBe('http');
      expect(result.config).toEqual(input.config);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('updates an existing connection', () => {
      const input = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: { url: 'https://example.com' },
      };

      const first = upsertConnection(input);
      const updated = upsertConnection({
        ...input,
        name: 'Updated Connection',
        config: { url: 'https://updated.com' },
      });

      expect(updated.id).toBe('conn-1');
      expect(updated.name).toBe('Updated Connection');
      expect(updated.config).toEqual({ url: 'https://updated.com' });
      expect(updated.createdAt).toBe(first.createdAt);
      expect(updated.updatedAt).not.toBe(first.updatedAt);
    });

    it('handles connections with tags', () => {
      const input = {
        id: 'conn-2',
        name: 'Tagged Connection',
        type: 'database',
        tags: ['production', 'postgres'],
        config: { host: 'localhost', port: 5432 },
      };

      const result = upsertConnection(input);

      expect(result.tags).toEqual(['production', 'postgres']);
    });
  });

  describe('listConnections', () => {
    it('returns empty array when no connections exist', () => {
      const connections = listConnections();
      expect(connections).toEqual([]);
    });

    it('returns all saved connections', () => {
      upsertConnection({
        id: 'conn-1',
        name: 'Connection 1',
        type: 'http',
        config: {},
      });
      upsertConnection({
        id: 'conn-2',
        name: 'Connection 2',
        type: 'database',
        config: {},
      });

      const connections = listConnections();

      expect(connections).toHaveLength(2);
      expect(connections.map((c) => c.id)).toEqual(['conn-1', 'conn-2']);
    });
  });

  describe('getConnection', () => {
    it('returns connection by id', () => {
      upsertConnection({
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: { url: 'https://example.com' },
      });

      const result = getConnection('conn-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('conn-1');
      expect(result?.name).toBe('Test Connection');
    });

    it('returns undefined for non-existent connection', () => {
      const result = getConnection('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteConnection', () => {
    it('deletes an existing connection', () => {
      upsertConnection({
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: {},
      });

      const deleted = deleteConnection('conn-1');

      expect(deleted).toBe(true);
      expect(listConnections()).toHaveLength(0);
    });

    it('returns false when deleting non-existent connection', () => {
      const deleted = deleteConnection('non-existent');
      expect(deleted).toBe(false);
    });

    it('only deletes specified connection', () => {
      upsertConnection({ id: 'conn-1', name: 'Connection 1', type: 'http', config: {} });
      upsertConnection({ id: 'conn-2', name: 'Connection 2', type: 'http', config: {} });

      deleteConnection('conn-1');

      const remaining = listConnections();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('conn-2');
    });
  });

  describe('maskConnection', () => {
    it('masks string values in config', () => {
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: {
          apiKey: 'secret123',
          url: 'https://example.com',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const masked = maskConnection(conn);

      expect(masked.config.apiKey).toBe('***');
      expect(masked.config.url).toBe('***');
      expect(masked.id).toBe('conn-1');
      expect(masked.name).toBe('Test Connection');
    });

    it('masks nested objects', () => {
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'database',
        config: {
          credentials: {
            username: 'admin',
            password: 'secret',
          },
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const masked = maskConnection(conn);

      expect(masked.config.credentials).toEqual({
        username: '***',
        password: '***',
      });
    });

    it('masks arrays', () => {
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: {
          headers: ['Authorization: Bearer token123', 'Content-Type: application/json'],
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const masked = maskConnection(conn);

      expect(masked.config.headers).toEqual(['***', '***']);
    });

    it('preserves empty strings', () => {
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'http',
        config: {
          emptyValue: '',
          nonEmptyValue: 'value',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const masked = maskConnection(conn);

      expect(masked.config.emptyValue).toBe('');
      expect(masked.config.nonEmptyValue).toBe('***');
    });

    it('handles non-string primitive values', () => {
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test Connection',
        type: 'database',
        config: {
          port: 5432,
          enabled: true,
          timeout: null,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const masked = maskConnection(conn);

      expect(masked.config.port).toBe(5432);
      expect(masked.config.enabled).toBe(true);
      expect(masked.config.timeout).toBe(null);
    });
  });

  describe('error handling', () => {
    it('handles corrupted connection file', () => {
      const dir = path.dirname(testConnPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(testConnPath, 'invalid json', 'utf8');

      const connections = listConnections();

      expect(connections).toEqual([]);
    });

    it('handles non-array data in file', () => {
      const dir = path.dirname(testConnPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(testConnPath, JSON.stringify({ not: 'an array' }), 'utf8');

      const connections = listConnections();

      expect(connections).toEqual([]);
    });
  });
});
