---
phase: 1
slug: process-network
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 30 + ts-jest |
| **Config file** | `jest.config.js` (existing) |
| **Quick run command** | `npx jest --testPathPattern="sysint" --no-coverage` |
| **Full suite command** | `npx jest --testPathPattern="sysint"` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern="sysint" --no-coverage`
- **After every plan wave:** Run `npx jest --testPathPattern="sysint"`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 1-01-01 | 01 | 0 | PRC-01..08 + NET-01..20 | fixture setup | — | ⬜ pending |
| 1-01-02 | 01 | 0 | — | catalog entries | `npx jest catalog` | ⬜ pending |
| 1-02-01 | 02 | 1 | PRC-01 | unit | `npx jest process` | ⬜ pending |
| 1-02-02 | 02 | 1 | PRC-02 | unit | `npx jest process` | ⬜ pending |
| 1-02-03 | 02 | 1 | PRC-03..05 | unit | `npx jest process` | ⬜ pending |
| 1-02-04 | 02 | 1 | PRC-06..07 | unit | `npx jest process` | ⬜ pending |
| 1-02-05 | 02 | 1 | PRC-08 | unit | `npx jest process` | ⬜ pending |
| 1-03-01 | 03 | 1 | NET-01 | unit | `npx jest network` | ⬜ pending |
| 1-03-02 | 03 | 1 | NET-02, NET-14 | unit | `npx jest network` | ⬜ pending |
| 1-03-03 | 03 | 1 | NET-03, NET-11, NET-12 | unit | `npx jest network` | ⬜ pending |
| 1-03-04 | 03 | 1 | NET-04, NET-05 | unit | `npx jest network` | ⬜ pending |
| 1-03-05 | 03 | 1 | NET-06, NET-07 | unit | `npx jest network` | ⬜ pending |
| 1-04-01 | 04 | 2 | NET-08..10 | unit | `npx jest network` | ⬜ pending |
| 1-04-02 | 04 | 2 | NET-13, NET-15..18 | unit | `npx jest network` | ⬜ pending |
| 1-04-03 | 04 | 2 | NET-19..20 | unit | `npx jest network` | ⬜ pending |
| 1-05-01 | 05 | 2 | all (end-to-end flow) | integration | `npx jest sysint` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/services/sysint/__tests__/fixtures/` directory with fixture text files
- [ ] `src/services/sysint/__tests__/process.test.ts` — test stubs for PRC-01..08
- [ ] `src/services/sysint/__tests__/network-connections.test.ts` — stubs for NET-01
- [ ] `src/services/sysint/__tests__/network-interfaces.test.ts` — stubs for NET-02, NET-14
- [ ] `src/services/sysint/__tests__/network-dns.test.ts` — stubs for NET-03, NET-11, NET-12
- [ ] `src/services/sysint/__tests__/network-wifi.test.ts` — stubs for NET-04, NET-05
- [ ] `src/services/sysint/__tests__/network-scanner.test.ts` — stubs for NET-06, NET-07
- [ ] `src/services/sysint/__tests__/network-misc.test.ts` — stubs for NET-08..10, NET-13, NET-15..20
- [ ] Catalog entries for all 28 tools verified in `catalog.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wi-Fi scan returns live networks | NET-04 | Hardware required | Run on real machine with Wi-Fi; verify SSID/signal/channel |
| Bluetooth device listing | NET-19 | Hardware required | Run with a paired Bluetooth device; verify name appears |
| Bandwidth test returns Mbps | NET-16 | Network-dependent | Run on live network; verify result > 0 and reasonable |
| Traceroute hops on real network | NET-12 | Network-dependent | Run against 8.8.8.8; verify multiple hops with RTT values |
| Process list on live system | PRC-01 | System-dependent | Verify node process appears in results |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
