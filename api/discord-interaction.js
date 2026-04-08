// ============================================
// DISCORD INTERACTION ENDPOINT
// ============================================
// Vercel serverless function that receives Discord button click events.
//
// STAGE 2: PING handler only. This is the minimum needed for Discord to accept
// the Interactions Endpoint URL. Once this is verified working, we'll add the
// button click handling in Stage 3.
//
// Discord sends a POST request with:
//   - Headers: x-signature-ed25519, x-signature-timestamp
//   - Body: JSON payload
// We must:
//   1. Verify the Ed25519 signature using our public key
//   2. If it's a PING (type 1), respond with PONG (type 1)
//   3. Otherwise (Stage 3+), handle button clicks (type 3) or commands (type 2)
//
// Environment variables used:
//   - DISCORD_PUBLIC_KEY: the app's public key (for signature verification)

import crypto from 'node:crypto';

// Discord interaction types
const INTERACTION_TYPE_PING = 1;
// (3 = MESSAGE_COMPONENT, used for button clicks — Stage 3)

// Discord interaction response types
const RESPONSE_TYPE_PONG = 1;

// Convert a hex string to a Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Verify a Discord Ed25519 signature using Node's built-in crypto.
// Discord signs: timestamp + raw body. We verify against our public key.
function verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex) {
  try {
    const publicKeyBytes = hexToBytes(publicKeyHex);
    const signatureBytes = hexToBytes(signature);
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      Buffer.from(rawBody, 'utf8')
    ]);

    // Node 19+ supports Ed25519 via crypto.createPublicKey + crypto.verify
    // The public key needs to be in SPKI (DER) format wrapped around the raw 32 bytes.
    // SPKI prefix for Ed25519: 302a300506032b6570032100
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiKey = Buffer.concat([spkiPrefix, Buffer.from(publicKeyBytes)]);

    const publicKey = crypto.createPublicKey({
      key: spkiKey,
      format: 'der',
      type: 'spki'
    });

    return crypto.verify(null, message, publicKey, Buffer.from(signatureBytes));
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

// Read the raw request body as a string (Vercel provides req.body parsed already,
// but we need the raw bytes for signature verification, so we re-read from the stream).
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export const config = {
  api: {
    bodyParser: false, // we need the raw body for signature verification
  },
};

export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    console.error('DISCORD_PUBLIC_KEY env var not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Read raw body and headers
  const rawBody = await readRawBody(req);
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing signature headers' });
  }

  // Verify signature
  const isValid = verifyDiscordSignature(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse the body now that we've verified it
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Handle PING (type 1) — respond with PONG
  if (payload.type === INTERACTION_TYPE_PING) {
    return res.status(200).json({ type: RESPONSE_TYPE_PONG });
  }

  // Stage 3 will handle type === 3 (MESSAGE_COMPONENT) here.
  // For now, reject anything else.
  return res.status(400).json({ error: 'Unhandled interaction type' });
}
