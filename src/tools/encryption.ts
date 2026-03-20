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
    name: 'crypto_value',
    description:
      'Encrypts or decrypts a string value (token, password, API key). Uses AES-256-GCM.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['encrypt', 'decrypt'],
          description: "Operation to perform: 'encrypt' or 'decrypt'",
        },
        data: {
          type: 'string',
          description: 'Value to encrypt or encrypted string to decrypt',
        },
        password: {
          type: 'string',
          description: 'Encryption/decryption password',
        },
        label: {
          type: 'string',
          description: "Optional tag for encrypt action (ex: 'github_token', 'api_key')",
        },
      },
      required: ['action', 'data', 'password'],
    },
    handler: async (args: unknown) => {
      const { action, data, password, label } = z
        .object({
          action: z.enum(['encrypt', 'decrypt']),
          data: z.string(),
          password: z.string(),
          label: z.string().optional(),
        })
        .parse(args);

      if (action === 'encrypt') {
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
                `- Use \`crypto_value\` with action 'decrypt' to retrieve original value`,
            },
          ],
        };
      } else {
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
    },
  },
  {
    name: 'crypto_file',
    description: 'Encrypts or decrypts a file and saves the result to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['encrypt', 'decrypt'],
          description: "Operation to perform: 'encrypt' or 'decrypt'",
        },
        inputPath: {
          type: 'string',
          description: 'Path to the file to encrypt or the .enc file to decrypt',
        },
        outputPath: {
          type: 'string',
          description:
            'Where to save the result (optional). Encrypt default: <inputPath>.enc. Decrypt default: <inputPath>.dec (or strips .enc extension)',
        },
        password: {
          type: 'string',
          description: 'Encryption/decryption password',
        },
      },
      required: ['action', 'inputPath', 'password'],
    },
    handler: async (args: unknown) => {
      const { action, inputPath, outputPath, password } = z
        .object({
          action: z.enum(['encrypt', 'decrypt']),
          inputPath: z.string(),
          outputPath: z.string().optional(),
          password: z.string(),
        })
        .parse(args);

      if (!fs.existsSync(inputPath)) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ File not found: ${inputPath}`,
            },
          ],
          isError: true,
        };
      }

      if (action === 'encrypt') {
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
      } else {
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
    },
  },
];
