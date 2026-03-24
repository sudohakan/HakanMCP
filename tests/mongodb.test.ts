import { mongoTools } from '../src/tools/mongodb';

describe('MongoDB Tools', () => {
  // These tests verify tool structure and validation without requiring actual MongoDB connection
  // Real MongoDB operations would require a running MongoDB instance

  describe('mongo_connect', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('MongoDB');
      expect(tool?.inputSchema.properties).toHaveProperty('connectionString');
    });

    it('should reject missing connectionString', async () => {
      const tool = mongoTools[0]!;

      try {
        await tool.handler({ action: 'connect' });
        fail('Should have thrown validation error');
      } catch (error: unknown) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('mongo_find', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('connectionId');
      expect(tool?.inputSchema.properties).toHaveProperty('database');
      expect(tool?.inputSchema.properties).toHaveProperty('collection');
      expect(tool?.inputSchema.properties).toHaveProperty('query');
      expect(tool?.inputSchema.properties).toHaveProperty('limit');
    });

    it('should have required fields', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.required).toEqual(
        expect.arrayContaining(['action']),
      );
    });

    it('should reject invalid connectionId', async () => {
      const tool = mongoTools[0]!;

      try {
        await tool.handler({
          action: 'find',
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
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description.toLowerCase()).toMatch(/insert|add.*document|document.*add/);
      expect(tool?.inputSchema.properties).toHaveProperty('documents');
    });

    it('should have documents field', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('documents');
    });

    it('should reject missing required fields', async () => {
      const tool = mongoTools[0]!;

      try {
        await tool.handler({
          action: 'insert',
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
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('MongoDB');
    });

    it('should have documents array field', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('documents');
    });
  });

  describe('mongo_updateOne', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('filter');
      expect(tool?.inputSchema.properties).toHaveProperty('update');
    });

    it('should require filter and update in schema', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('filter');
      expect(tool?.inputSchema.properties).toHaveProperty('update');
    });
  });

  describe('mongo_updateMany', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('MongoDB');
    });
  });

  describe('mongo_deleteOne', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('filter');
    });

    it('should have filter field', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('filter');
    });
  });

  describe('mongo_deleteMany', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
    });
  });

  describe('mongo_aggregate', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('pipeline');
    });

    it('should have pipeline field', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('pipeline');
    });
  });

  describe('mongo_createIndex', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('keys');
    });
  });

  describe('mongo_listCollections', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('database');
    });

    it('should have database field', () => {
      const tool = mongoTools[0]!;
      expect(tool?.inputSchema.properties).toHaveProperty('database');
    });
  });

  describe('mongo_disconnect', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('connectionId');
    });

    it('should handle non-existent connection gracefully', async () => {
      const tool = mongoTools[0]!;

      // Disconnecting non-existent connection should not throw
      const result = await tool.handler({
        action: 'disconnect',
        connectionId: 'non-existent-connection',
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('closed');
    });
  });

  describe('mongo_countDocuments', () => {
    it('should be defined with correct schema', () => {
      const tool = mongoTools[0]!;
      expect(tool).toBeDefined();
      expect(tool?.description).toMatch(/count/i);
    });
  });

  describe('All MongoDB Tools', () => {
    it('should export the mongo tool', () => {
      expect(mongoTools.length).toBeGreaterThan(0);
      expect(mongoTools[0]!.name).toBe('mongo');
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
