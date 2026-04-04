import { buildContext, contextToPrompt } from './contextBuilder.js';

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationState {
  id: string;
  turns: ConversationTurn[];
  lastAction: Record<string, unknown> | null;
  lastResult: unknown;
  createdAt: string;
}

let activeConversation: ConversationState | null = null;

function sanitizeQuery(query: string): string {
  return query
    .slice(0, 500)
    .replace(/[<>]/g, '')
    .replace(/```/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

export async function processQuery(
  query: string,
  aiCall: (prompt: string) => Promise<string>,
): Promise<{ action: Record<string, unknown> | null; explanation: string; conversational: boolean }> {
  const ctx = await buildContext({ historyLimit: 10 });
  const contextPrompt = contextToPrompt(ctx);

  const conversationHistory = activeConversation
    ? activeConversation.turns.slice(-6).map((t) => `${t.role}: ${t.content}`).join('\n')
    : '';

  const prompt = `${contextPrompt}

${conversationHistory ? `## Conversation history\n${conversationHistory}\n` : ''}

## Task: Interpret natural language disk query

<user_query>${sanitizeQuery(query)}</user_query>

Available actions and their parameters:
- scan: { path, depth, minSize }
- drives: {}
- top: { path, count, type }
- types: { path, depth }
- age: { path, brackets }
- duplicates: { path, minSize, algorithm }
- tree: { path, depth, minSize }
- compare: { snapshotA, snapshotB }
- cleanup: { path, targets, dryRun }
- delete: { path, confirm }
- move: { source, destination }
- archive: { path, format, destination }
- quota: { subAction, path, limit }
- suggest: { path }
- analyze: { path }
- snapshot: { path, name }
- history: { limit, actionFilter }

If this references previous results ("bunlarin", "those", "hepsini"), use conversation history to resolve.
If ambiguous, set conversational=true and explain what you need.

Respond in JSON:
{ "action": { "action": "scan", ...params } | null, "explanation": "what this will do", "conversational": false }
If you need clarification: { "action": null, "explanation": "question for user", "conversational": true }`;

  const response = await aiCall(prompt);

  if (!activeConversation) {
    activeConversation = {
      id: Date.now().toString(),
      turns: [],
      lastAction: null,
      lastResult: null,
      createdAt: new Date().toISOString(),
    };
  }
  activeConversation.turns.push({ role: 'user', content: query });

  try {
    const parsed = JSON.parse(extractJsonObj(response));
    activeConversation.turns.push({ role: 'assistant', content: parsed.explanation });
    if (parsed.action) activeConversation.lastAction = parsed.action;
    return parsed;
  } catch {
    return { action: null, explanation: 'Could not parse query. Please rephrase.', conversational: true };
  }
}

export function setLastResult(result: unknown): void {
  if (activeConversation) {
    activeConversation.lastResult = result;
  }
}

export function clearConversation(): void {
  activeConversation = null;
}

function extractJsonObj(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : '{}';
}
