---
plan: 04
title: Extended Network Tools — NET-08..10, NET-13, NET-15..20
status: complete
commit: 3de84a6
tests: 21 passed
---

## Delivered

- misc.ts with 10 tools:
  - NET-08 route-table: route print (win) / /proc/net/route (linux)
  - NET-09 arp-table: arp -a with MAC normalization
  - NET-10 mac-resolve: ARP cache query after ping
  - NET-13 http-headers: fetch HEAD with :status prefix row
  - NET-15 ssl-checker: raw TLS socket + PeerCertificate inspection
  - NET-16 wake-on-lan: UDP magic packet broadcast (dgram ESM import)
  - NET-17 bandwidth-test: Cloudflare speed endpoint download measurement
  - NET-18 connection-log: Security event log (win) / journalctl (linux)
  - NET-19 bluetooth-scan: Get-PnpDevice (win) / bluetoothctl (linux)
  - NET-20 network-shares: Get-SmbShare (win) / net share (linux)

## Exported parsers (unit tested)

parseRouteWindows, parseRouteLinux, parseArpWindows, parseArpLinux

## Fixes

- wake-on-lan: `require('node:dgram')` → `await import('node:dgram')` for ESM compatibility
