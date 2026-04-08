// ============================================
// DISCORD ADD REACTIONS ENDPOINT
// ============================================
// Small helper endpoint: takes a channel_id + message_id and uses the bot token
// to add 👍 and 👎 reactions to that message. Called from apply.html right after
// posting an application via webhook, since webhooks can't add reactions themselves.
//
// This endpoint is PUBLIC (no signature verification) but it only adds two
// specific emojis to whatever message ID you give it, using our bot. The worst
// a malicious caller could do is add 👍 👎 reactions to arbitrary messages
// the bot can see. Low-impact, acceptable tradeoff.
//
// Environment variables:
//   - DISCORD_BOT_TOKEN

const VOTE_UP = encodeURIComponent('👍');
const VOTE_DOWN = encodeURIComponent('👎');

// Simple delay helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function addReaction(channelId, messageId, emojiEncoded, botToken) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Length': '0'
    }
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    console.warn(`Failed to add reaction ${emojiEncoded}: ${res.status} ${text}`);
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  // CORS: allow requests from our own site
  res.setHeader('Access-Control-Allow-Origin', 'https://thebloodlust.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  // Vercel auto-parses JSON bodies for these default endpoints
  const { channel_id, message_id } = req.body || {};
  if (!channel_id || !message_id) {
    return res.status(400).json({ error: 'Missing channel_id or message_id' });
  }

  // Basic validation: IDs should be numeric Discord snowflakes
  if (!/^\d+$/.test(channel_id) || !/^\d+$/.test(message_id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  // Add both reactions sequentially with a small delay to avoid Discord's
  // reaction rate limit (0.25s per-bot between reaction adds).
  try {
    await addReaction(channel_id, message_id, VOTE_UP, botToken);
    await sleep(350);
    await addReaction(channel_id, message_id, VOTE_DOWN, botToken);
  } catch (err) {
    console.error('Failed to add reactions:', err);
    return res.status(500).json({ error: 'Failed to add reactions' });
  }

  return res.status(200).json({ ok: true });
}
