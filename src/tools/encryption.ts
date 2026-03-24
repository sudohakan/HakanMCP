import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Encryption Tools
 * Simple encryption/decryption for sensitive data (tokens, passwords, etc.)
 * Uses AES-256-GCM for encryption
 */

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derives an encryption key from a password
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypts a string value
 */
function encrypt(plaintext: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  const combined = Buffer.concat([salt, iv, tag, Buffer.from(encrypted, 'hex')]);

  return combined.toString('base64');
}

/**
 * Decrypts an encrypted string
 */
function decrypt(encrypted: string, password: string): string {
  const combined = Buffer.from(encrypted, 'base64');

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export function encryptValue(plaintext: string, password: string): string {
  return encrypt(plaintext, password);
}

export function decryptValue(encrypted: string, password: string): string {
  return decrypt(encrypted, password);
}

export const encryptionTools = [
  {
    name: 'crypto',
    description:
      'Encryption/decryption operations. Actions: encryptValue, decryptValue, encryptFile, decryptFile. Uses AES-256-GCM.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['encryptValue', 'decryptValue', 'encryptFile', 'decryptFile'],
          description: 'Operation to perform',
        },
        data: {
          type: 'string',
          description: 'Value to encrypt or encrypted string to decrypt (encryptValue/decryptValue)',
        },
        password: {
          type: 'string',
          description: 'Encryption/decryption password',
        },
        label: {
          type: 'string',
          description: "Optional tag for encryptValue (ex: 'github_token', 'api_key')",
        },
        inputPath: {
          type: 'string',
          description: 'Path to the file to encrypt or the .enc file to decrypt (encryptFile/decryptFile)',
        },
        outputPath: {
          type: 'string',
          description:
            'Where to save the result (optional). encryptFile default: <inputPath>.enc. decryptFile default: strips .enc extension',
        },
      },
      required: ['action', 'password'],
    },
    handler: async (args: unknown) => {
      const { action, data, password, label, inputPath, outputPath } = z
        .object({
          action: z.enum(['encryptValue', 'decryptValue', 'encryptFile', 'decryptFile']),
          data: z.string().optional(),
          password: z.string(),
          label: z.string().optional(),
          inputPath: z.string().optional(),
          outputPath: z.string().optional(),
        })
        .parse(args);

      switch (action) {
        case 'encryptValue': {
          if (!data) throw new Error('data is required for action=encryptValue');
          const encrypted = encrypt(data, password);
          return {
            content: [
              {
                type: 'text',
                text:
                  `# Encrypted Value\n\n` +
                  (label ? `**Label:** ${label}\n\n` : '') +
                  `**Encrypted:**\n\`\`\`\n${encrypted}\n\`\`\`\n\n` +
                  `⚠️ **IMPORTANT:**\n` +
                  `- Store this encrypted value safely\n` +
                  `- Keep your password secure (not in code!)\n` +
                  `- Use \`crypto\` with action 'decryptValue' to retrieve original value`,
              },
            ],
          };
        }

        case 'decryptValue': {
          if (!data) throw new Error('data is required for action=decryptValue');
          try {
            const decrypted = decrypt(data, password);
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `# Decrypted Value\n\n` +
                    `**Original Value:**\n\`\`\`\n${decrypted}\n\`\`\`\n\n` +
                    `✅ Successfully decrypted`,
                },
              ],
            };
          } catch (error: unknown) {
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}\n\n` +
                    `Possible reasons:\n` +
                    `- Wrong password\n` +
                    `- Corrupted encrypted data\n` +
                    `- Invalid base64 encoding`,
                },
              ],
              isError: true,
            };
          }
        }

        case 'encryptFile': {
          if (!inputPath) throw new Error('inputPath is required for action=encryptFile');
          if (!fs.existsSync(inputPath)) {
            return {
              content: [{ type: 'text', text: `❌ File not found: ${inputPath}` }],
              isError: true,
            };
          }
          const content = fs.readFileSync(inputPath, 'utf8');
          const encrypted = encrypt(content, password);
          const output = outputPath || `${inputPath}.enc`;
          fs.writeFileSync(output, encrypted, 'utf8');
          return {
            content: [
              {
                type: 'text',
                text:
                  `# File Encrypted\n\n` +
                  `**Source:** ${inputPath}\n` +
                  `**Output:** ${output}\n` +
                  `**Size:** ${content.length} bytes → ${encrypted.length} bytes\n\n` +
                  `✅ File encrypted successfully`,
              },
            ],
          };
        }

        case 'decryptFile': {
          if (!inputPath) throw new Error('inputPath is required for action=decryptFile');
          if (!fs.existsSync(inputPath)) {
            return {
              content: [{ type: 'text', text: `❌ File not found: ${inputPath}` }],
              isError: true,
            };
          }
          try {
            const encryptedContent = fs.readFileSync(inputPath, 'utf8');
            const decrypted = decrypt(encryptedContent, password);
            const output = outputPath || inputPath.replace(/\.enc$/, '.dec');
            fs.writeFileSync(output, decrypted, 'utf8');
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `# File Decrypted\n\n` +
                    `**Source:** ${inputPath}\n` +
                    `**Output:** ${output}\n` +
                    `**Size:** ${encryptedContent.length} bytes → ${decrypted.length} bytes\n\n` +
                    `✅ File decrypted successfully`,
                },
              ],
            };
          } catch (error: unknown) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      }
    },
  },
];
