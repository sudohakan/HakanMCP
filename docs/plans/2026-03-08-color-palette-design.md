# HakanMCP Color Palette Design — "Electric Indigo"

**Date:** 2026-03-08
**Status:** Approved
**Direction:** Vibrant & Premium, dark terminal optimized, gradient on logo + key moments

## Design Decisions

- **Primary identity:** Electric Indigo (#6C5CE7) — distinctive, premium, modern
- **Approach:** Stripe/Discord-inspired vibrant palette with clear semantic roles
- **Terminal assumption:** Dark background only
- **Gradient usage:** Logo/banner + celebration moments (mission complete, etc.)

## Core Palette

| Semantic Role     | Token            | Hex       | Usage                          |
|-------------------|------------------|-----------|--------------------------------|
| Primary/Accent    | `primary`        | `#6C5CE7` | Links, active state, commands  |
| Secondary         | `secondary`      | `#a29bfe` | Soft highlights, pill accents  |
| Success           | `success`        | `#00D68F` | Completed, checkmarks, pass    |
| Error             | `error`          | `#FF6B6B` | Failed, crosses, critical      |
| Warning           | `warning`        | `#FDCB6E` | Caution, alerts, deprecation   |
| Text Primary      | `textPrimary`    | `#F1F2F6` | Main content, labels           |
| Text Subheading   | `textSubheading` | `#DFE6E9` | Section headers (bold)         |
| Text Muted        | `textMuted`      | `#8395A7` | Hints, metadata, timestamps    |
| Text Dim          | `textDim`        | `#576574` | Dividers, separators, subtle   |

## Gradients

| Name          | Colors                    | Usage                        |
|---------------|---------------------------|------------------------------|
| brand         | `#6C5CE7` → `#a29bfe`    | Logo, banner, app title      |
| celebration   | `#00D68F` → `#6C5CE7`    | Mission complete, success     |
| alert         | `#FF6B6B` → `#FDCB6E`    | Critical warnings (rare)     |

## THEME Object

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

## Spinner & Animation Colors

- All `ora` spinners: `color: 'magenta'`
- Custom spinners (▸, ⠋⠙⠹): `chalk.hex('#6C5CE7')`
- Boxen borders: `borderColor: 'magenta'`

## Semantic Usage Rules

| Element                | Color Token      | Modifier      |
|------------------------|------------------|---------------|
| Logo/Banner            | gradient brand   | —             |
| Command names in menu  | primary          | —             |
| Active/running state   | primary          | —             |
| Success message        | success          | spinner.succeed |
| Error message          | error            | spinner.fail  |
| Warning/caution        | warning          | —             |
| Labels, content text   | textPrimary      | —             |
| Section headers        | textSubheading   | chalk.bold    |
| Hints, tips, metadata  | textMuted        | —             |
| Dividers, separators   | textDim          | —             |
| Pill menu colors       | `[primary, success, warning, error, secondary]` | — |
| Provider identities    | Per-provider named chalk colors | unchanged |

## Migration Map

| Old Color  | New Color   | Reason                              |
|------------|-------------|-------------------------------------|
| `#5b86e5`  | `#6C5CE7`   | More vibrant indigo identity        |
| `#a78bfa`  | `#a29bfe`   | Harmonized secondary                |
| `#36d1a0`  | `#00D68F`   | Vivid emerald success               |
| `#ff6044`  | `#FF6B6B`   | Softer coral error                  |
| `#ffd166`  | `#FDCB6E`   | Warmer amber warning                |
| `#eceff1`  | `#F1F2F6`   | Slightly warmer white               |
| `#78909c`  | `#8395A7`   | More readable muted text            |
| `#546e7a`  | `#576574`   | Neutral dim (less blue-gray)        |
| `#ff8a80`  | removed     | Redundant — error color sufficient  |
| `border: 'cyan'` | `border: 'magenta'` | Brand color alignment    |

## Files to Update

- `bin/hakanmcp.ts` — THEME object + all hex references
- `scripts/console_chat.ts` — prompt, spinner, suggestion colors
- `src/cli/watchCommand.ts` — spinner + status colors
- `src/cli/scheduledCommand.ts` — spinner + status colors
- `src/cli/reactiveCommand.ts` — spinner + status colors
- `src/cli/startCommand.ts` — spinner + status colors
- `src/cli/stopCommand.ts` — spinner + status colors
- `src/cli/missionCommand.ts` — color constants + status badges
- `src/cli/reportCommand.ts` — color constants
- `src/cli/initCommand.ts` — named chalk colors → hex
