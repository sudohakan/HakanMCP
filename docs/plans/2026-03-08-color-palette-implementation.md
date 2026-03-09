# Electric Indigo Color Palette — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the entire ad-hoc color system with the approved "Electric Indigo" palette across all CLI files.

**Architecture:** Central THEME object in hakanmcp.ts defines all semantic colors. Each CLI file references THEME or uses the same hex codes directly. Migration is a systematic find-replace per color, plus structural changes (renamed THEME keys, removed colors, new gradients).

**Tech Stack:** TypeScript, chalk, ora, gradient-string, boxen

---

### Task 1: Update THEME object in hakanmcp.ts

**Files:**
- Modify: `bin/hakanmcp.ts:45-59`

**Step 1: Replace THEME object**

```typescript
const THEME = {
  gradient: gradient(['#6C5CE7', '#a29bfe']),
  gradientCelebration: gradient(['#00D68F', '#6C5CE7']),
  gradientAlert: gradient(['#FF6B6B', '#FDCB6E']),
  primary: '#6C5CE7',
  secondary: '#a29bfe',
  success: '#00D68F',
  error: '#FF6B6B',
  warning: '#FDCB6E',
  textPrimary: '#F1F2F6',
  textMuted: '#8395A7',
  textDim: '#576574',
  textSubheading: '#DFE6E9',
  border: 'magenta' as const,
};
```

**Step 2: Update all THEME references in hakanmcp.ts**

Search-replace within file:
- `THEME.accent` → `THEME.primary`
- `THEME.purple` → `THEME.secondary`
- `THEME.dimText` → `THEME.textMuted`
- `THEME.muted` → `THEME.textDim`
- `THEME.subheading` → `THEME.textSubheading`
- `THEME.gradientWarm` → `THEME.gradientAlert`
- `THEME.gradientSuccess` → `THEME.gradientCelebration`

---

### Task 2: Hex replacement in hakanmcp.ts

**Files:**
- Modify: `bin/hakanmcp.ts`

**Step 1: Replace all hex codes**

| Find | Replace |
|------|---------|
| `#5b86e5` | `#6C5CE7` |
| `#a78bfa` | `#a29bfe` |
| `#36d1a0` | `#00D68F` |
| `#ff6044` | `#FF6B6B` |
| `#ffd166` | `#FDCB6E` |
| `#eceff1` | `#F1F2F6` |
| `#78909c` | `#8395A7` |
| `#546e7a` | `#576574` |
| `#ff8a80` | `#FF6B6B` (merge into error) |

**Step 2: Update PILL_COL_COLORS array**

```typescript
const PILL_COL_COLORS = ['#6C5CE7', '#00D68F', '#FDCB6E', '#FF6B6B', '#a29bfe'];
```

**Step 3: Update border colors**

Replace `borderColor: 'cyan'` → `borderColor: 'magenta'`

**Step 4: Update ora spinner colors**

Replace all `color: 'blue'` → `color: 'magenta'` in ora calls

**Step 5: Build and verify**

Run: `cd C:/dev/HakanMCP && npx tsc --noEmit`

---

### Task 3: Hex replacement in console_chat.ts

**Files:**
- Modify: `scripts/console_chat.ts`

**Step 1: Replace all hex codes**

Same table as Task 2. Key locations:
- Prompt symbol (`▸`): `#5b86e5` → `#6C5CE7`
- Suggestion prefix: `#ffd166` → `#FDCB6E`
- Custom spinner: `#5b86e5` → `#6C5CE7`
- Warning text: `#ffd166` → `#FDCB6E`
- Muted text: `#78909c` → `#8395A7`
- Dim text: `#546e7a` → `#576574`

**Step 2: Update ora spinner color**

Replace `color: 'blue'` → `color: 'magenta'`

---

### Task 4: Hex replacement in command files

**Files:**
- Modify: `src/cli/watchCommand.ts`
- Modify: `src/cli/scheduledCommand.ts`
- Modify: `src/cli/reactiveCommand.ts`
- Modify: `src/cli/startCommand.ts`
- Modify: `src/cli/stopCommand.ts`
- Modify: `src/cli/missionCommand.ts`
- Modify: `src/cli/reportCommand.ts`

**Step 1: For each file, apply the hex replacement table**

| Find | Replace |
|------|---------|
| `#5b86e5` | `#6C5CE7` |
| `#a78bfa` | `#a29bfe` |
| `#36d1a0` | `#00D68F` |
| `#ff6044` | `#FF6B6B` |
| `#ffd166` | `#FDCB6E` |
| `#eceff1` | `#F1F2F6` |
| `#78909c` | `#8395A7` |
| `#546e7a` | `#576574` |
| `#ff8a80` | `#FF6B6B` |

**Step 2: Update ora spinner colors**

Replace `color: 'blue'` → `color: 'magenta'` in all files

---

### Task 5: Update initCommand.ts named colors

**Files:**
- Modify: `src/cli/initCommand.ts`

**Step 1: Replace named chalk colors with hex equivalents**

- `chalk.red(` → `chalk.hex('#FF6B6B')(`
- `chalk.green(` → `chalk.hex('#00D68F')(`
- `chalk.cyan(` → `chalk.hex('#6C5CE7')(`

---

### Task 6: Build verification

**Step 1: TypeScript compile check**

Run: `cd C:/dev/HakanMCP && npx tsc --noEmit`
Expected: No errors

**Step 2: Visual smoke test**

Run: `cd C:/dev/HakanMCP && node dist/bin/hakanmcp.js --help`
Verify: Colors render correctly, no broken formatting
