// Knowledge Graph Tools - Migrated from @modelcontextprotocol/server-memory
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../utils/projectRoot.js';

// Default memory file path - stored in project data directory
const DATA_DIR = process.env.KNOWLEDGE_GRAPH_DIR || path.join(PROJECT_ROOT, 'data');
const MEMORY_FILE = process.env.KNOWLEDGE_GRAPH_FILE || 'memory.jsonl';

interface Entity {
  type: 'entity';
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  type: 'relation';
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

class KnowledgeGraphManager {
  private memoryFilePath: string;

  constructor() {
    this.memoryFilePath = path.join(DATA_DIR, MEMORY_FILE);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    try {
      await this.ensureDir();
      const data = await fs.readFile(this.memoryFilePath, 'utf-8');
      const lines = data.split('\n').filter((line) => line.trim() !== '');
      return lines.reduce<KnowledgeGraph>(
        (graph, line) => {
          const item = JSON.parse(line);
          if (item.type === 'entity') graph.entities.push(item);
          if (item.type === 'relation') graph.relations.push(item);
          return graph;
        },
        { entities: [], relations: [] },
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await this.ensureDir();
    const lines = [
      ...graph.entities.map((e) =>
        JSON.stringify({
          type: 'entity',
          name: e.name,
          entityType: e.entityType,
          observations: e.observations,
        }),
      ),
      ...graph.relations.map((r) =>
        JSON.stringify({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType }),
      ),
    ];
    await fs.writeFile(this.memoryFilePath, lines.join('\n'));
  }

  async createEntities(entities: Omit<Entity, 'type'>[]): Promise<Entity[]> {
    const graph = await this.loadGraph();
    const newEntities: Entity[] = entities
      .filter((e) => !graph.entities.some((existing) => existing.name === e.name))
      .map((e) => ({ ...e, type: 'entity' as const }));
    graph.entities.push(...newEntities);
    await this.saveGraph(graph);
    return newEntities;
  }

  async createRelations(relations: Omit<Relation, 'type'>[]): Promise<Relation[]> {
    const graph = await this.loadGraph();
    const newRelations: Relation[] = relations
      .filter(
        (r) =>
          !graph.relations.some(
            (existing) =>
              existing.from === r.from &&
              existing.to === r.to &&
              existing.relationType === r.relationType,
          ),
      )
      .map((r) => ({ ...r, type: 'relation' as const }));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  async addObservations(
    observations: { entityName: string; contents: string[] }[],
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph();
    const results = observations.map((observation) => {
      const entity = graph.entities.find((e) => e.name === observation.entityName);
      if (!entity) throw new Error(`Entity with name ${observation.entityName} not found`);
      const newObservations = observation.contents.filter(
        (content) => !entity.observations.includes(content),
      );
      entity.observations.push(...newObservations);
      return { entityName: observation.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph);
    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter((entity) => !entityNames.includes(entity.name));
    graph.relations = graph.relations.filter(
      (relation) => !entityNames.includes(relation.from) && !entityNames.includes(relation.to),
    );
    await this.saveGraph(graph);
  }

  async deleteObservations(
    deletions: { entityName: string; observations: string[] }[],
  ): Promise<void> {
    const graph = await this.loadGraph();
    deletions.forEach((deletion) => {
      const entity = graph.entities.find((e) => e.name === deletion.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(
          (observation) => !deletion.observations.includes(observation),
        );
      }
    });
    await this.saveGraph(graph);
  }

  async deleteRelations(relations: Omit<Relation, 'type'>[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(
      (relation) =>
        !relations.some(
          (deletion) =>
            relation.from === deletion.from &&
            relation.to === deletion.to &&
            relation.relationType === deletion.relationType,
        ),
    );
    await this.saveGraph(graph);
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const normalizedQuery = query.toLowerCase();
    const filteredEntities = graph.entities.filter(
      (entity) =>
        entity.name.toLowerCase().includes(normalizedQuery) ||
        entity.entityType.toLowerCase().includes(normalizedQuery) ||
        entity.observations.some((observation) =>
          observation.toLowerCase().includes(normalizedQuery),
        ),
    );
    const names = new Set(filteredEntities.map((entity) => entity.name));
    const filteredRelations = graph.relations.filter(
      (relation) => names.has(relation.from) && names.has(relation.to),
    );
    return { entities: filteredEntities, relations: filteredRelations };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const filteredEntities = graph.entities.filter((entity) => names.includes(entity.name));
    const nameSet = new Set(filteredEntities.map((entity) => entity.name));
    const filteredRelations = graph.relations.filter(
      (relation) => nameSet.has(relation.from) && nameSet.has(relation.to),
    );
    return { entities: filteredEntities, relations: filteredRelations };
  }
}

const kgManager = new KnowledgeGraphManager();

const coreKnowledgeGraphTools: ToolDefinition[] = [
  {
    name: 'kg_entities',
    description: 'Create or delete entities in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'delete'],
          description: 'Action to perform',
        },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Entity name' },
              entityType: { type: 'string', description: 'Entity type' },
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'Initial observations',
              },
            },
            required: ['name', 'entityType', 'observations'],
          },
          description: 'Required for create: entities to add',
        },
        entityNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required for delete: entity names to remove',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, entities, entityNames } = z
        .object({
          action: z.enum(['create', 'delete']),
          entities: z
            .array(
              z.object({
                name: z.string(),
                entityType: z.string(),
                observations: z.array(z.string()),
              }),
            )
            .optional(),
          entityNames: z.array(z.string()).optional(),
        })
        .parse(args);

      if (action === 'create') {
        if (!entities) throw new Error('entities is required for create action');
        const result = await kgManager.createEntities(entities);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } else {
        if (!entityNames) throw new Error('entityNames is required for delete action');
        await kgManager.deleteEntities(entityNames);
        return { content: [{ type: 'text', text: 'Entities deleted successfully.' }] };
      }
    },
  },

  {
    name: 'kg_relations',
    description: 'Create or delete relations between entities in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'delete'],
          description: 'Action to perform',
        },
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source entity name' },
              to: { type: 'string', description: 'Target entity name' },
              relationType: { type: 'string', description: 'Relation type (active voice)' },
            },
            required: ['from', 'to', 'relationType'],
          },
          description: 'Relations to create or delete',
        },
      },
      required: ['action', 'relations'],
    },
    handler: async (args: unknown) => {
      const { action, relations } = z
        .object({
          action: z.enum(['create', 'delete']),
          relations: z.array(
            z.object({
              from: z.string(),
              to: z.string(),
              relationType: z.string(),
            }),
          ),
        })
        .parse(args);

      if (action === 'create') {
        const result = await kgManager.createRelations(relations);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } else {
        await kgManager.deleteRelations(relations);
        return { content: [{ type: 'text', text: 'Relations deleted successfully.' }] };
      }
    },
  },

  {
    name: 'kg_observations',
    description: 'Add or delete observations on entities in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'delete'],
          description: 'Action to perform',
        },
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'Entity name' },
              contents: {
                type: 'array',
                items: { type: 'string' },
                description: 'Observation strings to append',
              },
            },
            required: ['entityName', 'contents'],
          },
          description: 'Required for add: observations to append',
        },
        deletions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'Entity name' },
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'Observation strings to remove',
              },
            },
            required: ['entityName', 'observations'],
          },
          description: 'Required for delete: observations to remove',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, observations, deletions } = z
        .object({
          action: z.enum(['add', 'delete']),
          observations: z
            .array(
              z.object({
                entityName: z.string(),
                contents: z.array(z.string()),
              }),
            )
            .optional(),
          deletions: z
            .array(
              z.object({
                entityName: z.string(),
                observations: z.array(z.string()),
              }),
            )
            .optional(),
        })
        .parse(args);

      if (action === 'add') {
        if (!observations) throw new Error('observations is required for add action');
        const result = await kgManager.addObservations(observations);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } else {
        if (!deletions) throw new Error('deletions is required for delete action');
        await kgManager.deleteObservations(deletions);
        return { content: [{ type: 'text', text: 'Observations deleted successfully.' }] };
      }
    },
  },

  {
    name: 'kg_read_graph',
    description: 'Read the complete knowledge graph.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const graph = await kgManager.loadGraph();
      return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
    },
  },

  {
    name: 'kg_search',
    description: 'Search entities and observations in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const { query } = z.object({ query: z.string() }).parse(args);
      const result = await kgManager.searchNodes(query);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  },

  {
    name: 'kg_open_nodes',
    description: 'Open specific nodes and relations by entity names.',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entity names',
        },
      },
      required: ['names'],
    },
    handler: async (args: unknown) => {
      const { names } = z.object({ names: z.array(z.string()) }).parse(args);
      const result = await kgManager.openNodes(names);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  },
];

export const knowledgeGraphTools: ToolDefinition[] = [...coreKnowledgeGraphTools];
