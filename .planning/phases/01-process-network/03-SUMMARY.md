---
plan: 03
title: Network Core Tools — NET-01..07, NET-11, NET-12, NET-14
status: complete
commit: b3535ea
tests: 41 passed
---

## Delivered

- connections.ts — NET-01 cports: netstat/ss parsing with PID-to-processName correlation via si.processes()
- interfaces.ts — NET-02 network-interfaces, NET-14 network-stats via systeminformation
- dns.ts — NET-03 dns-lookup (A/AAAA/MX/TXT/NS), NET-11 whois-lookup (raw TCP socket), NET-12 traceroute (tracert/traceroute)
- wifi.ts — NET-04 wifi-scan (netsh/nmcli), NET-05 wifi-history (netsh profiles/NM connections)
- scanner.ts — NET-06 ping-test (parallel multi-host), NET-07 port-scan (batched 50-concurrent TCP probe)
- index.ts — dispatcher with lazy-load of misc.ts for Plan 04 tools

## Test strategy

Pure parser unit tests (parseNetstatWindowsConnections, parseSsOutput, parseTracerouteWindows, parseTracerouteLinux, parsePingWindows, parsePingLinux, parseNetshNetworks, parseNmcliWifi, parseNetshProfiles) + integration shape tests (real OS calls, validate field presence and types). No exec mocking.

## Fixes applied

- `as unknown as Record<string, unknown>` pattern for SysIntResult cast in test files (SysIntError lacks index signature)
- dns.ts type predicate replaced with `.filter(r => r.status === 'fulfilled')` + explicit cast
- run type annotation updated from optional args to required `args: string[]` in test beforeAll declarations
