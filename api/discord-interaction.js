// ============================================
// DISCORD INTERACTION ENDPOINT
// ============================================
// Vercel serverless function that receives Discord button click events.
//
// Handles:
//  - PING (type 1) → PONG
//  - MESSAGE_COMPONENT (type 3) → button click (approve/deny application)
//
// Custom ID format: "app_action_applicationId"
//   e.g. "app_approve_550e8400-e29b-41d4-a716-446655440000"
//   e.g. "app_deny_550e8400-e29b-41d4-a716-446655440000"
//
// Permission: only users with the DISCORD_OWNER_ROLE_ID role can click.
//
// Environment variables:
//   - DISCORD_PUBLIC_KEY: app's public key (for signature verification)
//   - DISCORD_BOT_TOKEN: bot token (for editing messages)
//   - DISCORD_OWNER_ROLE_ID: role ID that's allowed to approve/deny
//   - SUPABASE_SERVICE_ROLE_KEY: supabase service key (bypasses RLS to update apps)

import crypto from 'node:crypto';

// Discord interaction types
const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_MESSAGE_COMPONENT = 3;

// Discord interaction response types
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE = 4;
const RESPONSE_TYPE_DEFERRED_UPDATE_MESSAGE = 6;
const RESPONSE_TYPE_UPDATE_MESSAGE = 7;

// Message flags
const FLAG_EPHEMERAL = 1 << 6; // 64 - only the clicker sees the message

// Supabase config (hardcoded public URL, secret key from env)
const SUPABASE_URL = 'https://qcudyzwzymaloydnfpfb.supabase.co';

// ============================================
// SIGNATURE VERIFICATION
// ============================================

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex) {
  try {
    const publicKeyBytes = hexToBytes(publicKeyHex);
    const signatureBytes = hexToBytes(signature);
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      Buffer.from(rawBody, 'utf8')
    ]);

    // SPKI prefix for Ed25519 wraps the 32-byte raw key into DER format
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

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ============================================
// SUPABASE HELPERS (via REST API, no client library needed)
// ============================================

async function supabaseUpdateApplication(applicationId, updates) {
  const url = `${SUPABASE_URL}/rest/v1/applications?id=eq.${encodeURIComponent(applicationId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase update failed: ${res.status} ${text}`);
  }
  return await res.json();
}

async function supabaseGetApplication(applicationId) {
  const url = `${SUPABASE_URL}/rest/v1/applications?id=eq.${encodeURIComponent(applicationId)}&select=*`;
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

// ============================================
// DISCORD HELPERS
// ============================================

// Edit the original message via the webhook token (included in the interaction payload).
// This disables the buttons and appends the action result.
async function editInteractionMessage(applicationId, originalMessage, action, clickerName, clickerId) {
  const applicationIdToken = process.env.DISCORD_APPLICATION_ID || null;

  // Rebuild the embed with an extra field showing who acted
  const originalEmbed = (originalMessage.embeds && originalMessage.embeds[0]) || {};
  const newEmbed = {
    ...originalEmbed,
    color: action === 'approve' ? 0x55FF55 : 0xdc2626,
    fields: [
      ...(originalEmbed.fields || []),
      {
        name: action === 'approve' ? '✅ Approved' : '❌ Denied',
        value: `By <@${clickerId}>`,
        inline: false
      }
    ]
  };

  // Disabled buttons showing the final state
  const disabledButtons = {
    type: 1,
    components: [
      {
        type: 2,
        style: action === 'approve' ? 3 : 2, // 3=green (success), 2=grey
        label: action === 'approve' ? '✅ Approved' : 'Approve',
        custom_id: 'app_approved_disabled',
        disabled: true
      },
      {
        type: 2,
        style: action === 'deny' ? 4 : 2, // 4=red (danger), 2=grey
        label: action === 'deny' ? '❌ Denied' : 'Deny',
        custom_id: 'app_denied_disabled',
        disabled: true
      }
    ]
  };

  return {
    embeds: [newEmbed],
    components: [disabledButtons]
  };
}

// ============================================
// BUTTON CLICK HANDLER
// ============================================

async function handleButtonClick(payload) {
  const customId = payload.data?.custom_id || '';
  const match = customId.match(/^app_(approve|deny)_(.+)$/);
  if (!match) {
    return {
      type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Invalid button.',
        flags: FLAG_EPHEMERAL
      }
    };
  }

  const action = match[1]; // 'approve' or 'deny'
  const applicationId = match[2];

  // Permission check: does the clicker have the owner role?
  const memberRoles = payload.member?.roles || [];
  const ownerRoleId = process.env.DISCORD_OWNER_ROLE_ID;
  if (!memberRoles.includes(ownerRoleId)) {
    return {
      type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '🚫 You do not have permission to approve or deny applications.',
        flags: FLAG_EPHEMERAL
      }
    };
  }

  // Fetch the application to make sure it exists and isn't already decided
  let application;
  try {
    application = await supabaseGetApplication(applicationId);
  } catch (err) {
    console.error('Failed to fetch application:', err);
    return {
      type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ Failed to fetch the application from the database. Try again in a moment.',
        flags: FLAG_EPHEMERAL
      }
    };
  }

  if (!application) {
    return {
      type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ This application no longer exists in the database (maybe it was deleted).',
        flags: FLAG_EPHEMERAL
      }
    };
  }

  if (application.status !== 'pending') {
    return {
      type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `⚠️ This application has already been **${application.status}**. No change made.`,
        flags: FLAG_EPHEMERAL
      }
    };
  }

  // Update the application in Supabase
  const newStatus = action === 'approve' ? 'accepted' : 'denied';
  const clickerName = payload.member?.user?.username || payload.member?.user?.global_name || 'unknown';
  try {
    await supabaseUpdateApplication(applicationId, {
      status: newStatus,
      staff_notes: `Decided via Discord by ${clickerName}`,
      reviewed_at: new Date().toISOString()
      // Note: reviewed_by is a FK to profiles.id - we don't have a profile for the Discord
      // user necessarily, so we leave it NULL. The staff_notes field records the acting user.
    });
  } catch (err) {
    console.error('Failed to update application:', err);
    return {
      type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ Failed to update the application in the database. Try again or update via the admin dashboard.',
        flags: FLAG_EPHEMERAL
      }
    };
  }

  // Rebuild the message with disabled buttons and a status field
  const updated = await editInteractionMessage(
    applicationId,
    payload.message,
    action,
    clickerName,
    payload.member.user.id
  );

  return {
    type: RESPONSE_TYPE_UPDATE_MESSAGE,
    data: updated
  };
}

// ============================================
// MAIN HANDLER
// ============================================

export const config = {
  api: {
    bodyParser: false, // we need the raw body for signature verification
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    console.error('DISCORD_PUBLIC_KEY env var not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing signature headers' });
  }

  if (!verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // PING
  if (payload.type === INTERACTION_TYPE_PING) {
    return res.status(200).json({ type: RESPONSE_TYPE_PONG });
  }

  // Button click
  if (payload.type === INTERACTION_TYPE_MESSAGE_COMPONENT) {
    try {
      const response = await handleButtonClick(payload);
      return res.status(200).json(response);
    } catch (err) {
      console.error('Button handler error:', err);
      return res.status(200).json({
        type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '⚠️ An unexpected error occurred. Please try again.',
          flags: FLAG_EPHEMERAL
        }
      });
    }
  }

  return res.status(400).json({ error: 'Unhandled interaction type' });
}
