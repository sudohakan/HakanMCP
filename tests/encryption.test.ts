import { encryptionTools, encryptValue, decryptValue } from '../src/tools/encryption';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const getTool = (name: string) =>
  encryptionTools.find((tool: { name: string }) => tool.name === name)!;

describe('encryption tools', () => {
  it('encrypts and decrypts round trip values', () => {
    const encrypted = encryptValue('secret-data', 'strong-password');
    const decrypted = decryptValue(encrypted, 'strong-password');
    expect(decrypted).toBe('secret-data');
  });

  it('encrypt_value handler returns formatted output', async () => {
    const tool = getTool('encrypt_value');
    const result = await tool.handler({
      value: 'api-key',
      password: 'super-secret',
      label: 'github',
    });

    expect(result.content[0].text).toContain('Label');
    expect(result.content[0].text).toContain('Encrypted');
  });

  it('decrypt_value handler returns error on invalid data', async () => {
    const encryptTool = getTool('encrypt_value');
    const decryptTool = getTool('decrypt_value');

    const encryptedText = await encryptTool.handler({
      value: 'stored-secret',
      password: 'shared-pass',
    });
    const encryptedValue = encryptedText.content[0].text.match(/```([\s\S]*?)```/)?.[1].trim() ?? '';

    const success = await decryptTool.handler({
      encrypted: encryptedValue,
      password: 'shared-pass',
    });
    expect(success.content[0].text).toContain('stored-secret');

    const failure = await decryptTool.handler({
      encrypted: encryptedValue,
      password: 'wrong-pass',
    });
    expect((failure as { isError?: boolean }).isError).toBe(true);
  });

  it('encrypt_file handler writes encrypted output', async () => {
    const tool = getTool('encrypt_file');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-test-'));
    const filePath = path.join(tmpDir, 'source.txt');
    const outputPath = path.join(tmpDir, 'source.enc');
    fs.writeFileSync(filePath, 'file-content', 'utf8');

    const result = await tool.handler({
      filePath,
      password: 'file-password',
      outputPath,
    });

    expect(result.content[0].text).toContain('File Encrypted');
    expect(fs.existsSync(outputPath)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypt_file handler returns error if file missing', async () => {
    const tool = getTool('encrypt_file');
    const response = await tool.handler({
      filePath: 'C:\\does-not-exist.txt',
      password: 'irrelevant',
    });
    expect((response as { isError?: boolean }).isError).toBe(true);
  });

  it('decrypt_file handler writes decrypted content', async () => {
    const encryptTool = getTool('encrypt_file');
    const decryptTool = getTool('decrypt_file');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dec-test-'));
    const sourcePath = path.join(tmpDir, 'secret.txt');
    fs.writeFileSync(sourcePath, 'sensitive-text', 'utf8');
    const encryptedPath = path.join(tmpDir, 'secret.enc');
    const decryptedPath = path.join(tmpDir, 'secret.dec');

    await encryptTool.handler({
      filePath: sourcePath,
      password: 'files-pass',
      outputPath: encryptedPath,
    });

    const result = await decryptTool.handler({
      encryptedPath,
      password: 'files-pass',
      outputPath: decryptedPath,
    });

    expect(result.content[0].text).toContain('File Decrypted');
    expect(fs.readFileSync(decryptedPath, 'utf8')).toBe('sensitive-text');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
