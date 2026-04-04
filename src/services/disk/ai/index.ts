import { classifyEntries } from './classifier.js';
import { predictDiskUsage } from './predictor.js';
import { detectAnomalies } from './anomaly.js';
import { createCleanupPlan } from './planner.js';
import { processQuery, setLastResult, clearConversation } from './nlEngine.js';
import { recordFeedback } from './learner.js';
import { buildContext, contextToPrompt } from './contextBuilder.js';
import { scan } from '../scanner.js';
import type {
  ClassificationResult, PredictionResult,
  AnomalyResult, CleanupSuggestion, CleanupPlan,
  FileCategory,
} from '../../../types/disk.js';

export interface AiEngine {
  analyze(path: string, aiCall: (prompt: string) => Promise<string>): Promise<ClassificationResult[]>;
  predict(aiCall: (prompt: string) => Promise<string>): Promise<PredictionResult[]>;
  anomalies(path: string, aiCall: (prompt: string) => Promise<string>): Promise<AnomalyResult[]>;
  suggest(path: string, aiCall: (prompt: string) => Promise<string>): Promise<CleanupSuggestion[]>;
  plan(path: string, goalBytes: number | null, aiCall: (prompt: string) => Promise<string>): Promise<CleanupPlan>;
  ask(query: string, aiCall: (prompt: string) => Promise<string>): Promise<{ action: Record<string, unknown> | null; explanation: string; conversational: boolean }>;
  feedback(decision: 'accept' | 'reject', category: string, filePath?: string): Promise<void>;
}

export const aiEngine: AiEngine = {
  async analyze(dirPath, aiCall) {
    const scanResult = await scan(dirPath, 3, 0);
    return classifyEntries(scanResult.children, aiCall);
  },

  async predict(aiCall) {
    return predictDiskUsage(aiCall);
  },

  async anomalies(dirPath, aiCall) {
    const scanResult = await scan(dirPath, 3, 0);
    return detectAnomalies(scanResult, aiCall);
  },

  async suggest(dirPath, aiCall) {
    const ctx = await buildContext();
    const contextPrompt = contextToPrompt(ctx);
    const scanResult = await scan(dirPath, 3, 1024 * 1024);

    const prompt = `${contextPrompt}

## Task: Suggest cleanup actions for ${dirPath}

Total size: ${(scanResult.totalSize / (1024 ** 3)).toFixed(2)} GB
Top 20 items:
${JSON.stringify(scanResult.children.slice(0, 20).map((c) => ({ name: c.name, size: c.size, type: c.type, modified: c.modified })), null, 2)}

Provide prioritized suggestions. Each should include estimated savings in bytes and a concrete disk action.
Respond in JSON array: [{ "priority": "high|medium|low", "description": "...", "estimatedSavings": bytes, "risk": "low|medium|high", "action": { "action": "...", ...params } }]`;

    const response = await aiCall(prompt);
    try {
      const match = response.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : [];
    } catch {
      return [];
    }
  },

  async plan(dirPath, goalBytes, aiCall) {
    return createCleanupPlan(dirPath, goalBytes, aiCall);
  },

  async ask(query, aiCall) {
    return processQuery(query, aiCall);
  },

  async feedback(decision, category, filePath) {
    await recordFeedback(decision, category as FileCategory, filePath);
  },
};

export { setLastResult, clearConversation } from './nlEngine.js';
