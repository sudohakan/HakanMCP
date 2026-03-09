# Contributing to HakanMCP

Thank you for your interest in contributing to HakanMCP. This guide covers the development workflow, code style, and contribution process.

---

## Getting Started

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/HakanMCP.git
   cd HakanMCP
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build:**
   ```bash
   npm run build
   ```

4. **Run smoke tests** to verify everything works:
   ```bash
   npm run test:smoke
   ```

---

## Development Workflow

### Branch Naming

- `feature/description` -- New features
- `fix/description` -- Bug fixes
- `refactor/description` -- Code refactoring
- `docs/description` -- Documentation changes

### Development Mode

For development with the ts-node ESM loader:

```bash
npm run dev
```

### Quick Check

Build and run smoke tests in one command:

```bash
npm run check:quick
```

---

## Code Style

### TypeScript

- **Strict mode** is enabled
- **ESM modules** (`import`/`export`, not `require`)
- **Zod validation** for all tool inputs
- **Explicit types** -- avoid `any`, use `unknown` with type narrowing

### Formatting

The project uses **Prettier** and **ESLint**:

```bash
# Check lint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format
```

### Pre-commit Hooks

`lint-staged` runs ESLint and Prettier on staged files before each commit.

---

## Adding a New Tool

### 1. Create or extend a tool module

Tools live in `src/tools/`. Each module exports an array of tool definitions.

```typescript
// src/tools/myModule.ts
import { z } from 'zod';

export const myTools = [
  {
    name: 'my_toolName',
    description: 'What this tool does (one line).',
    inputSchema: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'Description of param1' },
        param2: { type: 'number', description: 'Description of param2' },
      },
      required: ['param1'],
    },
    handler: async (args: unknown) => {
      const { param1, param2 } = z
        .object({
          param1: z.string(),
          param2: z.number().optional(),
        })
        .parse(args);

      // Implementation here
      const result = `Processed: ${param1}`;

      return {
        content: [{ type: 'text', text: result }],
      };
    },
  },
];
```

### 2. Register in index.ts

Import your tool module and add it to the `allTools` array:

```typescript
import { myTools } from './tools/myModule.js';

const allTools = [
  // ... existing tools
  ...myTools,
];
```

### 3. Tool naming convention

Follow the `prefix_actionTarget` pattern:
- `db_queryPostgres` -- category_action
- `git_status` -- category_action
- `fs_readFile` -- category_action

### 4. Use the scaffold tool

The `dx_toolScaffold` tool can generate a starter template:

```json
{ "name": "dx_toolScaffold", "arguments": {
  "toolName": "my_newTool",
  "description": "Does something useful"
}}
```

---

## Testing

### Run tests

```bash
# Full test suite
npm test

# Smoke tests only (fast)
npm run test:smoke

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Writing tests

Tests use **Jest** with `ts-jest`. Place test files in `tests/` with the `.test.ts` extension.

```typescript
// tests/myTool.test.ts
import { myTools } from '../src/tools/myModule';

describe('my_toolName', () => {
  const tool = myTools.find(t => t.name === 'my_toolName');

  it('should process input correctly', async () => {
    const result = await tool!.handler({ param1: 'test' });
    expect(result.content[0].text).toContain('Processed: test');
  });

  it('should reject invalid input', async () => {
    await expect(tool!.handler({})).rejects.toThrow();
  });
});
```

---

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** with clear, atomic commits
3. **Ensure all tests pass:** `npm run check:quick`
4. **Update documentation** if adding new tools or changing behavior
5. **Open a PR** against `main` with:
   - Clear title describing the change
   - Description of what and why
   - List of new/modified tools (if applicable)
   - Test plan

### PR Checklist

- [ ] Code compiles without errors (`npm run build`)
- [ ] Smoke tests pass (`npm run test:smoke`)
- [ ] Lint passes (`npm run lint`)
- [ ] New tools follow naming convention
- [ ] New tools have Zod input validation
- [ ] New tools have descriptions
- [ ] Documentation updated (TOOLS.md, etc.)

---

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed project structure and design decisions.

### Key directories

| Directory | Purpose |
|-----------|---------|
| `src/tools/` | Tool modules (27 files, 203 tools) |
| `src/services/` | Background services and shared logic |
| `src/utils/` | Utility functions |
| `bin/` | CLI entry point |
| `scripts/` | Standalone scripts (doctor, status, chat) |
| `tests/` | Jest test suites |
| `docs/` | Documentation |

---

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Write clear commit messages
- Document your changes

---

## License

HakanMCP is licensed under the [MIT License](../LICENSE). By contributing, you agree that your contributions will be licensed under the same license.
