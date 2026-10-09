import { describe, it, expect } from '@jest/globals';
import { adaptArgsForTool } from '../src/tools/mcpClient.js';

/**
 * Guards the silent-rename failure: @playwright/mcp renamed the element handle
 * `ref` -> `target`, and because adaptArgsForTool only dropped unknown keys, the
 * required `target` was never set and calls died downstream with a message that
 * pointed nowhere. These tests pin both halves: the alias still works when the
 * schema matches, and a schema the alias map hasn't caught up with now throws a
 * named error here instead of sending a broken call.
 */

const clickSchema = {
  name: 'browser_click',
  inputSchema: { type: 'object', properties: { target: {}, doubleClick: {} }, required: ['target'] },
};

describe('adaptArgsForTool', () => {
  it('aliases ref -> target when the live schema wants target', () => {
    const out = adaptArgsForTool(clickSchema, { ref: 'button#submit', doubleClick: false });
    expect(out).toEqual({ target: 'button#submit', doubleClick: false });
  });

  it('leaves args untouched when the schema already accepts the sent key', () => {
    const out = adaptArgsForTool(clickSchema, { target: 'button#submit' });
    expect(out).toEqual({ target: 'button#submit' });
  });

  it('passes through unknown tools (no schema) without rewriting', () => {
    const out = adaptArgsForTool(undefined, { ref: 'x', anything: 1 });
    expect(out).toEqual({ ref: 'x', anything: 1 });
  });

  it('throws a named error when the alias map is behind a new upstream rename', () => {
    // Upstream renamed target -> elementRef; our alias map still only knows ref->target.
    const renamedSchema = {
      name: 'browser_click',
      inputSchema: { type: 'object', properties: { elementRef: {} }, required: ['elementRef'] },
    };
    expect(() => adaptArgsForTool(renamedSchema, { ref: 'button#submit' })).toThrow(
      /arg mismatch.*elementRef.*ref/s,
    );
  });

  it('does not throw when a required field is missing but no unknown key was sent', () => {
    // Caller bug, not a rename — let it surface downstream, do not mask it as a rename.
    const out = adaptArgsForTool(clickSchema, { doubleClick: true });
    expect(out).toEqual({ doubleClick: true });
  });
});
