import { z } from 'zod';
import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';

/**
 * MongoDB Connection Manager
 * Manages MongoDB connections with pooling and cleanup
 */
class MongoConnectionManager {
  private connections = new Map<string, { client: MongoClient; lastUsed: number }>();
  private maxConnections = 5;
  private maxIdleTime = 10 * 60 * 1000; // 10 minutes

  async connect(connectionString: string): Promise<string> {
    if (this.connections.size >= this.maxConnections) {
      throw new Error(`Maximum connections (${this.maxConnections}) reached`);
    }

    const connectionId = `mongo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info('Creating MongoDB connection', { connectionId });

    const client = new MongoClient(connectionString);
    await client.connect();

    this.connections.set(connectionId, {
      client,
      lastUsed: Date.now(),
    });

    logger.info('MongoDB connection established', { connectionId });
    return connectionId;
  }

  getClient(connectionId: string): MongoClient {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    connection.lastUsed = Date.now();
    return connection.client;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    logger.info('Disconnecting MongoDB connection', { connectionId });
    await connection.client.close();
    this.connections.delete(connectionId);
  }

  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.entries()).map(([id, conn]) =>
      conn.client
        .close()
        .catch((err) =>
          logger.error('Error closing MongoDB connection', err, { connectionId: id }),
        ),
    );

    await Promise.all(promises);
    this.connections.clear();
    logger.info('All MongoDB connections closed');
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, conn] of this.connections.entries()) {
      if (now - conn.lastUsed > this.maxIdleTime) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.disconnect(id);
    }
  }
}

// Singleton instance
const connectionManager = new MongoConnectionManager();

// Cleanup on process exit
process.on('beforeExit', () => {
  connectionManager.disconnectAll();
});

// Periodic cleanup (skip in tests to avoid keeping Jest alive)
let cleanupTimer: NodeJS.Timeout | undefined;
if (process.env.NODE_ENV !== 'test') {
  cleanupTimer = setInterval(() => connectionManager.cleanup(), 5 * 60 * 1000);
}

// Allow manual cleanup stop (useful for tests or graceful shutdowns)
export const stopMongoCleanup = () => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
};

export const mongoTools = [
  {
    name: 'mongo_connect',
    description: 'Connect to MongoDB database. Connection ID is returned.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionString: {
          type: 'string',
          description: `MongoDB connection string (ex: \${config.mongoDbUrl || 'mongodb://localhost:27017'})`,
        },
      },
      required: ['connectionString'],
    },
    handler: async (args: unknown) => {
      const { connectionString } = z
        .object({
          connectionString: z.string(),
        })
        .parse(args);

      const connectionId = await connectionManager.connect(connectionString);

      return {
        content: [
          {
            type: 'text',
            text: `✓ MongoDB connection established\n\nConnection ID: ${connectionId}\n\nYou can use this ID in other MongoDB tools.`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_find',
    description: 'Find documents from MongoDB collection.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        query: { type: 'object', description: 'MongoDB query (JSON)' },
        limit: { type: 'number', description: 'Maximum number of documents' },
      },
      required: ['connectionId', 'database', 'collection'],
    },
    handler: async (args: unknown) => {
      const {
        connectionId,
        database,
        collection,
        query = {},
        limit = 100,
      } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          query: z.record(z.string(), z.unknown()).optional().default({}),
          limit: z.number().optional().default(100),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      const documents = await coll.find(query).limit(limit).toArray();

      return {
        content: [
          {
            type: 'text',
            text: `✓ ${documents.length} document found\n\n${JSON.stringify(documents, null, 2)}`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_insert',
    description:
      'Insert one or more documents into a MongoDB collection. If documents array has 1 item, uses insertOne; otherwise uses insertMany.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        documents: {
          type: 'array',
          items: { type: 'object' },
          description: 'Documents to insert. Single-element array calls insertOne.',
        },
      },
      required: ['connectionId', 'database', 'collection', 'documents'],
    },
    handler: async (args: unknown) => {
      const { connectionId, database, collection, documents } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          documents: z.array(z.record(z.string(), z.unknown())),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      if (documents.length === 1) {
        const result = await coll.insertOne(documents[0]);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Document added\n\nInserted ID: ${result.insertedId}\nAcknowledged: ${result.acknowledged}`,
            },
          ],
        };
      } else {
        const result = await coll.insertMany(documents);
        return {
          content: [
            {
              type: 'text',
              text: `✓ ${result.insertedCount} document added\n\nInserted IDs: ${Object.values(result.insertedIds).join(', ')}`,
            },
          ],
        };
      }
    },
  },
  {
    name: 'mongo_update',
    description:
      'Update document(s) in a MongoDB collection. Set many=true to update all matching documents.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        filter: { type: 'object', description: 'Update filter' },
        update: { type: 'object', description: 'Update operation ($set, $inc, etc.)' },
        many: { type: 'boolean', description: 'If true, updates all matching documents (default: false)' },
      },
      required: ['connectionId', 'database', 'collection', 'filter', 'update'],
    },
    handler: async (args: unknown) => {
      const { connectionId, database, collection, filter, update, many } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          filter: z.record(z.string(), z.unknown()),
          update: z.record(z.string(), z.unknown()),
          many: z.boolean().optional().default(false),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      if (many) {
        const result = await coll.updateMany(filter, update);
        return {
          content: [
            {
              type: 'text',
              text: `✓ ${result.modifiedCount} document updated\n\nMatched: ${result.matchedCount}\nModified: ${result.modifiedCount}`,
            },
          ],
        };
      } else {
        const result = await coll.updateOne(filter, update);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Document updated\n\nMatched: ${result.matchedCount}\nModified: ${result.modifiedCount}\nAcknowledged: ${result.acknowledged}`,
            },
          ],
        };
      }
    },
  },
  {
    name: 'mongo_delete',
    description:
      'Delete document(s) from a MongoDB collection. Set many=true to delete all matching documents.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        filter: { type: 'object', description: 'Delete filter' },
        many: { type: 'boolean', description: 'If true, deletes all matching documents (default: false)' },
      },
      required: ['connectionId', 'database', 'collection', 'filter'],
    },
    handler: async (args: unknown) => {
      const { connectionId, database, collection, filter, many } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          filter: z.record(z.string(), z.unknown()),
          many: z.boolean().optional().default(false),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      if (many) {
        const result = await coll.deleteMany(filter);
        return {
          content: [
            {
              type: 'text',
              text: `✓ ${result.deletedCount} document was deleted\n\nDeleted: ${result.deletedCount}`,
            },
          ],
        };
      } else {
        const result = await coll.deleteOne(filter);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Document deleted\n\nDeleted: ${result.deletedCount}\nAcknowledged: ${result.acknowledged}`,
            },
          ],
        };
      }
    },
  },
  {
    name: 'mongo_countDocuments',
    description: 'Count documents in MongoDB collection matching a filter.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        filter: {
          type: 'object',
          description: 'MongoDB query filter (empty {} for all documents)',
        },
      },
      required: ['connectionId', 'database', 'collection'],
    },
    handler: async (args: unknown) => {
      const {
        connectionId,
        database,
        collection,
        filter = {},
      } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          filter: z.record(z.string(), z.unknown()).optional().default({}),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      const count = await coll.countDocuments(filter);

      return {
        content: [
          {
            type: 'text',
            text: `✓ ${count} document(s) match the filter`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_aggregate',
    description: 'Run MongoDB aggregation pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        pipeline: {
          type: 'array',
          items: { type: 'object' },
          description: 'Aggregation pipeline stages',
        },
      },
      required: ['connectionId', 'database', 'collection', 'pipeline'],
    },
    handler: async (args: unknown) => {
      const { connectionId, database, collection, pipeline } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          pipeline: z.array(z.record(z.string(), z.unknown())),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      const results = await coll.aggregate(pipeline).toArray();

      return {
        content: [
          {
            type: 'text',
            text: `✓ Aggregation completed\n\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_createIndex',
    description: 'Create index in MongoDB collection.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
        collection: { type: 'string' },
        keys: { type: 'object', description: 'Index fields and directions (1 or -1)' },
        options: { type: 'object', description: 'Index options (unique, sparse, etc.)' },
      },
      required: ['connectionId', 'database', 'collection', 'keys'],
    },
    handler: async (args: unknown) => {
      const { connectionId, database, collection, keys, options } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
          collection: z.string(),
          keys: z.record(z.string(), z.union([z.number(), z.string()])),
          options: z.record(z.string(), z.unknown()).optional().default({}),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);
      const coll = db.collection(collection);

      // MongoDB IndexSpecification accepts object or array; keys validated by Zod
      const indexName = await coll.createIndex(
        keys as Parameters<typeof coll.createIndex>[0],
        options,
      );

      return {
        content: [
          {
            type: 'text',
            text: `✓ Index created: ${indexName}`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_listCollections',
    description: 'List collections in MongoDB database.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        database: { type: 'string' },
      },
      required: ['connectionId', 'database'],
    },
    handler: async (args: unknown) => {
      const { connectionId, database } = z
        .object({
          connectionId: z.string(),
          database: z.string(),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const db = client.db(database);

      const collections = await db.listCollections().toArray();

      return {
        content: [
          {
            type: 'text',
            text: `✓ ${collections.length} collection(s) found\n\n${collections.map((c) => `• ${c.name}`).join('\n')}`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_listDatabases',
    description: 'List databases on the MongoDB server.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
      },
      required: ['connectionId'],
    },
    handler: async (args: unknown) => {
      const { connectionId } = z
        .object({
          connectionId: z.string(),
        })
        .parse(args);

      const client = connectionManager.getClient(connectionId);
      const result = await client.db().admin().listDatabases();

      return {
        content: [
          {
            type: 'text',
            text: `✓ ${result.databases.length} database(s) found\n\n${result.databases.map((db) => `• ${db.name} (${db.sizeOnDisk ? (db.sizeOnDisk / 1024 / 1024).toFixed(2) : '0.00'} MB)`).join('\n')}`,
          },
        ],
      };
    },
  },
  {
    name: 'mongo_disconnect',
    description: 'Close the MongoDB connection.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
      },
      required: ['connectionId'],
    },
    handler: async (args: unknown) => {
      const { connectionId } = z
        .object({
          connectionId: z.string(),
        })
        .parse(args);

      await connectionManager.disconnect(connectionId);

      return {
        content: [
          {
            type: 'text',
            text: `✓ MongoDB connection closed: ${connectionId}`,
          },
        ],
      };
    },
  },
];
