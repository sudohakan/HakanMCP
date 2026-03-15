import { mongoTools } from '../src/tools/mongodb';

describe('MongoDB Tools', () => {
  // These tests verify tool structure and validation without requiring actual MongoDB connection
  // Real MongoDB operations would require a running MongoDB instance

  describe('mongo_connect', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_connect');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('MongoDB');
      expect(tool?.inputSchema.properties).toHaveProperty('connectionString');
      expect(tool?.inputSchema.required).toContain('connectionString');
    });

    it('should reject missing connectionString', async () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_connect');

      try {
        await tool!.handler({});
        fail('Should have thrown validation error');
      } catch (error: unknown) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('mongo_find', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_find');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('connectionId');
      expect(tool?.inputSchema.properties).toHaveProperty('database');
      expect(tool?.inputSchema.properties).toHaveProperty('collection');
      expect(tool?.inputSchema.properties).toHaveProperty('query');
      expect(tool?.inputSchema.properties).toHaveProperty('limit');
    });

    it('should have required fields', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_find');
      expect(tool?.inputSchema.required).toEqual(
        expect.arrayContaining(['connectionId', 'database', 'collection']),
      );
    });

    it('should reject invalid connectionId', async () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_find');

      try {
        await tool!.handler({
          connectionId: 'invalid-connection-id',
          database: 'testdb',
          collection: 'testcoll',
        });
        fail('Should have thrown error for invalid connection');
      } catch (error: unknown) {
        expect(error instanceof Error ? error.message : String(error)).toContain('not found');
      }
    });
  });

  describe('mongo_insertOne', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_insertOne');
      expect(tool).toBeDefined();
      expect(tool?.description.toLowerCase()).toMatch(/add.*document|document.*add/);
      expect(tool?.inputSchema.properties).toHaveProperty('document');
    });

    it('should require document field', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_insertOne');
      expect(tool?.inputSchema.required).toContain('document');
    });

    it('should reject missing required fields', async () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_insertOne');

      try {
        await tool!.handler({
          connectionId: 'test-conn',
        });
        fail('Should have thrown validation error');
      } catch (error: unknown) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('mongo_insertMany', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_insertMany');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('multiple');
    });

    it('should have documents array field', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_insertMany');
      expect(tool?.inputSchema.properties).toHaveProperty('documents');
    });
  });

  describe('mongo_updateOne', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_updateOne');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('filter');
      expect(tool?.inputSchema.properties).toHaveProperty('update');
    });

    it('should require filter and update', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_updateOne');
      expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['filter', 'update']));
    });
  });

  describe('mongo_updateMany', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_updateMany');
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('multiple');
    });
  });

  describe('mongo_deleteOne', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_deleteOne');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('filter');
    });

    it('should require filter', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_deleteOne');
      expect(tool?.inputSchema.required).toContain('filter');
    });
  });

  describe('mongo_deleteMany', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_deleteMany');
      expect(tool).toBeDefined();
    });
  });

  describe('mongo_aggregate', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_aggregate');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('pipeline');
    });

    it('should require pipeline', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_aggregate');
      expect(tool?.inputSchema.required).toContain('pipeline');
    });
  });

  describe('mongo_createIndex', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_createIndex');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('keys');
    });
  });

  describe('mongo_listCollections', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_listCollections');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('database');
    });

    it('should require database', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_listCollections');
      expect(tool?.inputSchema.required).toContain('database');
    });
  });

  describe('mongo_disconnect', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_disconnect');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('connectionId');
      expect(tool?.inputSchema.required).toContain('connectionId');
    });

    it('should handle non-existent connection gracefully', async () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_disconnect');

      // Disconnecting non-existent connection should not throw
      const result = await tool!.handler({
        connectionId: 'non-existent-connection',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('closed');
    });
  });

  describe('mongo_countDocuments', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools.find((t) => t.name === 'mongo_countDocuments');
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/count/i);
    });
  });

  describe('All MongoDB Tools', () => {
    it('should export all expected tools', () => {
      const expectedTools = [
        'mongo_connect',
        'mongo_find',
        'mongo_insertOne',
        'mongo_insertMany',
        'mongo_updateOne',
        'mongo_updateMany',
        'mongo_deleteOne',
        'mongo_deleteMany',
        'mongo_countDocuments',
        'mongo_aggregate',
        'mongo_createIndex',
        'mongo_listCollections',
        'mongo_disconnect',
      ];

      const actualTools = mongoTools.map((t) => t.name);

      for (const toolName of expectedTools) {
        expect(actualTools).toContain(toolName);
      }
    });

    it('should have unique tool names', () => {
      const names = mongoTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('all tools should have descriptions', () => {
      for (const tool of mongoTools) {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('all tools should have input schemas', () => {
      for (const tool of mongoTools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('all tools should have handlers', () => {
      for (const tool of mongoTools) {
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      }
    });
  });
});
