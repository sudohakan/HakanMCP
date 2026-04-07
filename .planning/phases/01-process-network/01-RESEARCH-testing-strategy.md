---
domain: Testing Strategy
phase: 1 — Process + Network
---

# Testing Strategy Research

## Framework

Jest 30 (already configured, ts-jest). Tests under `src/services/sysint/__tests__/`.

Quick run: `npx jest --testPathPattern="sysint" --no-coverage`
Full suite: `npx jest --testPathPattern="sysint"`

## Mocking Patterns

### child_process mock (established pattern from dispatcher.test.ts)

```typescript
import { jest } from '@jest/globals';

jest.unstable_mockModule('node:child_process', () => ({
  exec: jest.fn(),
}));

// In test:
const { exec } = await import('node:child_process');
(exec as jest.Mock).mockImplementation((_cmd, _opts, cb) => {
  cb(null, { stdout: FIXTURE_NETSTAT_WINDOWS, stderr: '' });
});
```

### systeminformation mock

```typescript
jest.unstable_mockModule('systeminformation', () => ({
  default: {
    processes: jest.fn().mockResolvedValue({ list: FIXTURE_SI_PROCESSES }),
    networkInterfaces: jest.fn().mockResolvedValue(FIXTURE_SI_IFACES),
    networkStats: jest.fn().mockResolvedValue([FIXTURE_SI_STATS]),
  },
}));
```

### Platform mock (already used in existing tests)

```typescript
jest.unstable_mockModule('../../platforms/index.js', () => ({
  getPlatformName: jest.fn().mockReturnValue('linux'),
}));
```

## Test Fixtures

Create fixture directory: `src/services/sysint/__tests__/fixtures/`

Key fixtures needed:
- `netstat-windows.txt` — sample Windows `netstat -ano` output
- `netstat-linux.txt` — sample Linux `/proc/net/tcp` content
- `si-processes.json` — sample systeminformation processes response
- `si-interfaces.json` — sample network interfaces response
- `ping-windows.txt` — sample Windows ping output
- `ping-linux.txt` — sample Linux ping output
- `netsh-wifi-networks.txt` — Windows `netsh wlan show networks mode=bssid`
- `nmcli-wifi.txt` — Linux `nmcli dev wifi list` output

## Test Structure per Tool

Each tool gets a describe block with:
1. Happy path — valid input, expected row schema
2. Empty result — command returns no rows
3. Platform error — wrong platform returns PLATFORM_UNSUPPORTED
4. Exec failure — command throws → EXEC_FAILED
5. Parse edge case — malformed output doesn't crash

```typescript
describe('cports (NET-01)', () => {
  it('parses Windows netstat output into ConnectionRow[]', async () => { ... });
  it('returns empty rows when no connections', async () => { ... });
  it('includes processName from PID lookup', async () => { ... });
  it('returns EXEC_FAILED on exec error', async () => { ... });
});
```

## Coverage Target

- Unit: 80%+ line coverage on all category modules
- Integration: NOT required for Phase 1 (no live system calls in tests)
- Manual: Wi-Fi and Bluetooth tested manually on real hardware

## TDD Cycle

RED → GREEN → REFACTOR per tool:
1. Write test for tool handler (uses fixture, asserts row schema)
2. Implement minimal handler to pass
3. Refactor: extract parsing utilities, add types

## Problematic Test Cases

| Tool | Challenge | Solution |
|------|-----------|---------|
| `process-handles` (PRC-05) | `/proc/[pid]/fd` needs root on many systems | Test parsing logic only; mock fs.readdir |
| `bandwidth-test` (NET-16) | Network call | Mock `https.request`; skip in CI |
| `traceroute` (NET-12) | Long-running, geo-IP external | Mock exec; test row schema only |
| `process-io` (PRC-06) | `/proc/[pid]/io` may be empty | Handle gracefully; test empty case |
| `bluetooth-scan` (NET-19) | Hardware dependent | Test command construction; mock exec |

## Sampling Continuity (Nyquist Compliance)

After every tool implementation (task commit): `npx jest --testPathPattern="sysint" --no-coverage`
Max feedback latency: ~15 seconds (existing suite runs in ~3s, growing to ~15s with Phase 1 additions)
