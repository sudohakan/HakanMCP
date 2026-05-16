/**
 * One-time OAuth flow to obtain a refresh token for Google Docs API.
 *
 * Usage:
 *   GOOGLE_DOCS_CLIENT_ID=... GOOGLE_DOCS_CLIENT_SECRET=... \
 *     node --loader ts-node/esm scripts/google-oauth-bootstrap.ts
 *
 * Or with CLI args:
 *   node --loader ts-node/esm scripts/google-oauth-bootstrap.ts <clientId> <clientSecret>
 *
 * Flow:
 *   1. Spins up loopback server on 127.0.0.1:53682
 *   2. Prints the consent URL — open in any browser, sign in, approve
 *   3. Captures the authorization code on the redirect
 *   4. Exchanges the code for a refresh_token
 *   5. Prints the refresh_token so you can paste it into .env
 */

import http from 'node:http';
import { URL } from 'node:url';

const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/documents';

async function main() {
  const clientId = process.env.GOOGLE_DOCS_CLIENT_ID || process.argv[2];
  const clientSecret = process.env.GOOGLE_DOCS_CLIENT_SECRET || process.argv[3];

  if (!clientId || !clientSecret) {
    console.error(
      'Usage: GOOGLE_DOCS_CLIENT_ID=... GOOGLE_DOCS_CLIENT_SECRET=... node scripts/google-oauth-bootstrap.ts',
    );
    console.error('   or: node scripts/google-oauth-bootstrap.ts <clientId> <clientSecret>');
    process.exit(1);
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>OAuth error</h1><pre>${error}</pre>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<h1>Yetkilendirme tamamlandı.</h1><p>Bu sekmeyi kapatabilirsin. Terminal\'e dön.</p>',
      );
      server.close();
      resolve(code);
    });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      console.log('\n=== Google Docs OAuth Bootstrap ===\n');
      console.log('1. Aşağıdaki URL\'i tarayıcıda aç:\n');
      console.log(authUrl.toString());
      console.log('\n2. Google hesabınla oturum aç ve "Allow" de.');
      console.log('3. Otomatik olarak callback yakalanacak.\n');
    });
  });

  const code = await codePromise;
  console.log('\n[OK] Authorization code yakalandı, token alınıyor...\n');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  if (!tokenData.refresh_token) {
    console.error(
      '\n[HATA] refresh_token gelmedi. Bu genellikle daha önce yetkilendirdiğin için olur.',
    );
    console.error(
      'Çözüm: https://myaccount.google.com/permissions → "HakanMCP Docs" erişimini kaldır → bu scripti tekrar çalıştır.',
    );
    process.exit(1);
  }

  console.log('=== BAŞARILI ===\n');
  console.log('Aşağıdaki satırları HakanMCP/.env\'e ekle:\n');
  console.log(`GOOGLE_DOCS_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_DOCS_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_DOCS_REFRESH_TOKEN=${tokenData.refresh_token}`);
  console.log('\nScope:', tokenData.scope);
  console.log('Access token expires in:', tokenData.expires_in, 'seconds');
  console.log('\nRefresh token kalıcıdır (sen iptal etmedikçe).');
}

main().catch((err) => {
  console.error('\n[HATA]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
