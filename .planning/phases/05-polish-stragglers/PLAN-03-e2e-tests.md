# Plan 03: E2E Integration Tests + Performance Benchmarks

**Phase:** 05-polish-stragglers
**Requirements:** All 117 v1 requirements (FND through PRG/OTL/AUD)
**Created:** 2026-04-07

## Goal

Verify every tool ID in the catalog returns a valid output shape through the dispatcher.
Measure cold startup time and first tool invocation time. Achieve 90%+ test coverage
across all sysint modules.

## Files to Create

```
src/services/sysint/__tests__/e2e-all-tools.test.ts   — dispatcher-level E2E for all tool IDs
src/services/sysint/__tests__/perf-benchmarks.test.ts  — startup and invocation timing
```

## E2E Test Design

### Shape validation

For every tool ID in the catalog, dispatch through `runTool()` and assert:
- Result is an object (not null/undefined/thrown)
- Either `rows` array exists (SysIntSuccess) OR `error` string + `code` exist (SysIntError)
- `tool` field equals the requested toolId
- No unhandled exception propagates

This is "shape test" — not "correct data" test. We can't guarantee real system data on CI.
All tools must return a structured response (never throw uncaught).

### Grouping by expected behavior on Linux CI

| Group | Expected result | Tools |
|-------|----------------|-------|
| Windows-only | PLATFORM_UNSUPPORTED | registry-*, outlook-*, gac-viewer |
| Cross-platform native | success rows or graceful EXEC_FAILED | network-*, disk-*, process-*, system-*, audio-*, programmer-* |
| Catalog-only (no native) | EXEC_FAILED (no native impl) | any tool with native:false |

### Test structure

```typescript
describe('E2E: all tool IDs return valid output shape', () => {
  for (const tool of catalog.tools) {
    it(`${tool.id} returns valid SysIntResult shape`, async () => {
      const result = await runTool(tool.id);
      // shape assertions
    });
  }
});
```

Use `jest.setTimeout(10000)` per test (some tools make real system calls).

### Catalog completeness check

```typescript
describe('Catalog completeness', () => {
  it('covers all 117 v1 requirement tool IDs', () => {
    const v1Ids = [ /* explicit list of all 117 IDs from requirements */ ];
    const catalogIds = catalog.tools.map(t => t.id);
    for (const id of v1Ids) {
      expect(catalogIds).toContain(id);
    }
  });
  
  it('all tools have required fields', () => {
    for (const tool of catalog.tools) {
      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('category');
      expect(typeof tool.adminRequired).toBe('boolean');
      expect(Array.isArray(tool.platforms)).toBe(true);
    }
  });
});
```

## Performance Benchmark Design

### Startup benchmark (catalog load)
```typescript
it('catalog cold load completes in under 200ms', () => {
  resetCatalog();
  const start = performance.now();
  getCatalog();
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(200);
});
```

### First invocation benchmark
Measure time from `runTool()` call to resolved promise for a lightweight cross-platform tool.
Use a known-fast tool (e.g., `process-list` on Linux, `cpu-info` equivalent).
Target: < 2000ms.

```typescript
it('first tool invocation completes in under 2000ms', async () => {
  resetDispatcher();
  const start = performance.now();
  await runTool('sys-cpu-info');
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(2000);
}, 5000);
```

### Category lazy-load benchmark
Measure module import time for each category independently.
All categories should import in < 500ms.

## Coverage Target

Run with `--coverage` flag after E2E test creation. Target:
- Statements: 85%+
- Branches: 75%+
- Functions: 80%+

Critical uncovered areas to check:
- `dispatcher.ts` nirsoftFallback path
- `outputFormatter.ts` toCSV function
- Platform-specific branches (process.platform switches)

## Success Criteria

1. E2E test runs without uncaught exceptions for all catalog tool IDs
2. Catalog load < 200ms verified by automated assertion
3. First tool invocation < 2000ms verified
4. All 117 v1 requirement IDs present in catalog
5. Test suite passes on Linux CI (the only CI environment available)
6. No tool throws uncaught exception — all errors are structured SysIntError
