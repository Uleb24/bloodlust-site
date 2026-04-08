// ============================================
// DISCORD POST APPLICATION ENDPOINT
// ============================================
// Posts an application to the applications channel using the BOT (not a webhook),
// because regular webhooks can't attach interactive components like buttons.
//
// Flow:
//  1. Browser collects application data + the freshly-created DB row ID
//  2. Browser POSTs to /api/discord-post-application
//  3. This endpoint uses the bot token to:
//     a. POST the embed + Approve/Deny buttons to the applications channel
//     b. Add 👍 and 👎 reactions to the posted message
//
// Environment variables:
//   - DISCORD_BOT_TOKEN
//   - DISCORD_APPLICATIONS_CHANNEL_ID

const DISCORD_API = 'https://discord.com/api/v10';

const VOTE_UP = encodeURIComponent('👍');
const VOTE_DOWN = encodeURIComponent('👎');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Same stat requirements as apply.html — duplicated here because serverless
// functions can't import from browser-only HTML files. Keep in sync manually.
const REQUIREMENTS = [
  {"key":"achievement_points","name":"Achievement Points","normal":17000,"outstanding":23000,"unit":""},
  {"key":"quests","name":"Quests","normal":10000,"outstanding":20000,"unit":""},
  {"key":"bedwars","name":"BedWars","normal":800,"outstanding":1500,"unit":"★"},
  {"key":"skywars","name":"Skywars","normal":60,"outstanding":100,"unit":"★"},
  {"key":"duels","name":"Duels","normal":25000,"outstanding":80000,"unit":"Wins"},
  {"key":"tnt_run","name":"TNT Run","normal":1000,"outstanding":10000,"unit":"Wins"},
  {"key":"pvp_run","name":"PVP Run","normal":1000,"outstanding":4000,"unit":"Wins"},
  {"key":"tnt_tag","name":"TNT Tag","normal":750,"outstanding":5000,"unit":"Wins"},
  {"key":"bow_spleef","name":"Bow Spleef","normal":1000,"outstanding":5000,"unit":"Wins"},
  {"key":"wizards","name":"Wizards","normal":1000,"outstanding":5000,"unit":"Wins"},
  {"key":"cvc_defusal","name":"CvC Defusal","normal":10000,"outstanding":35000,"unit":"Kills"},
  {"key":"cvc_tdm","name":"CvC TDM","normal":25000,"outstanding":60000,"unit":"Kills"},
  {"key":"paintball","name":"Paintball","normal":50000,"outstanding":200000,"unit":"Kills"},
  {"key":"quakecraft","name":"Quakecraft","normal":75000,"outstanding":250000,"unit":"Kills"},
  {"key":"uhc","name":"UHC","normal":8,"outstanding":12,"unit":"★"},
  {"key":"speed_uhc","name":"Speed UHC","normal":750,"outstanding":2000,"unit":"Wins"},
  {"key":"the_walls","name":"The Walls","normal":500,"outstanding":1500,"unit":"Wins"},
  {"key":"vampirez","name":"VampireZ","normal":1000,"outstanding":2500,"unit":"Human Wins"},
  {"key":"arcade","name":"Arcade Games","normal":2000,"outstanding":10000,"unit":"Wins"},
  {"key":"tkr","name":"TKR","normal":750,"outstanding":1500,"unit":"Trophies"},
  {"key":"arena_brawl","name":"Arena Brawl","normal":3000,"outstanding":7000,"unit":"Wins"},
  {"key":"warlords","name":"Warlords","normal":500,"outstanding":2000,"unit":"Wins"},
  {"key":"blitz","name":"Blitz SG","normal":2000,"outstanding":5000,"unit":"Wins"},
  {"key":"mega_walls","name":"Mega Walls","normal":500,"outstanding":2000,"unit":"Wins"},
  {"key":"smash_heroes","name":"Smash Heroes","normal":2500,"outstanding":4000,"unit":"Wins"},
  {"key":"build_battle","name":"Build Battle","normal":50000,"outstanding":125000,"unit":"Score"},
  {"key":"the_pit","name":"The Pit","normal":20,"outstanding":30,"unit":"Prestige"},
  {"key":"murder_mystery","name":"Murder Mystery","normal":15000,"outstanding":30000,"unit":"Wins"},
  {"key":"wool_wars","name":"Wool Wars","normal":150,"outstanding":350,"unit":"★"}
];

function buildEmbed(data, applicationId) {
  const isExternal = !applicationId;

  const stats = data.stats || {};
  const lines = [];
  REQUIREMENTS.forEach(req => {
    const raw = stats[req.key];
    if (raw === undefined || raw === null || raw === '') return;
    const num = Number(raw);
    if (isNaN(num) || num <= 0) return;
    const formatted = num.toLocaleString('en-US') + (req.unit ? ' ' + req.unit : '');
    let status;
    if (num >= req.outstanding) status = '🔥 **OUTSTANDING**';
    else if (num >= req.normal) status = '✅ Normal';
    else status = '❌ Below requirement';
    lines.push(`**${req.name}** — ${formatted} (${status})`);
  });

  const statsBlock = lines.length > 0 ? lines.join('\n') : '_No stats provided._';

  const fields = [
    { name: 'IGN', value: data.ign || '_(none)_', inline: true },
    { name: 'Discord', value: data.discord || '_(none)_', inline: true },
    { name: 'Timezone', value: data.timezone || '_(none)_', inline: true },
  ];
  if (data.previous_guilds) fields.push({ name: 'Previous Guilds', value: String(data.previous_guilds).slice(0, 1024), inline: false });
  if (data.main_gamemodes) fields.push({ name: 'Main Gamemodes', value: String(data.main_gamemodes).slice(0, 1024), inline: false });
  if (data.karma_link) fields.push({ name: '25karma', value: String(data.karma_link).slice(0, 1024), inline: false });
  if (data.additional_info) fields.push({ name: 'Additional Info', value: String(data.additional_info).slice(0, 1024), inline: false });
  fields.push({ name: 'Stats', value: statsBlock.slice(0, 1024), inline: false });

  return {
    title: isExternal
      ? `🩸 New Application (Email) — ${data.ign || 'Unknown'}`
      : `🩸 New Application — ${data.ign || 'Unknown'}`,
    color: 0xea580c,
    fields,
    footer: {
      text: isExternal
        ? 'Submitted via email — no website account. Buttons are cosmetic only.'
        : 'Submitted via The Blood Lust website'
    },
    timestamp: new Date().toISOString(),
    url: 'https://thebloodlust.vercel.app/admin.html'
  };
}

function buildButtons(applicationId) {
  // Logged-in apps have a real UUID; external (email) apps use a sentinel "external" marker
  // so the interaction endpoint knows to skip the database update.
  const approveId = applicationId
    ? `app_approve_${applicationId}`
    : `app_approve_external`;
  const denyId = applicationId
    ? `app_deny_${applicationId}`
    : `app_deny_external`;

  return [{
    type: 1, // action row
    components: [
      {
        type: 2, // button
        style: 3, // success (green)
        label: 'Approve',
        emoji: { name: '✅' },
        custom_id: approveId
      },
      {
        type: 2,
        style: 4, // danger (red)
        label: 'Deny',
        emoji: { name: '❌' },
        custom_id: denyId
      }
    ]
  }];
}

async function postMessage(channelId, payload, botToken) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to post message: ${res.status} ${text}`);
  }
  return await res.json();
}

async function addReaction(channelId, messageId, emojiEncoded, botToken) {
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`;
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
  // CORS: allow requests from our site
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
  const channelId = process.env.DISCORD_APPLICATIONS_CHANNEL_ID;
  if (!botToken || !channelId) {
    return res.status(500).json({ error: 'Bot or channel not configured' });
  }

  const { data, applicationId } = req.body || {};
  if (!data || !data.ign) {
    return res.status(400).json({ error: 'Missing application data' });
  }

  try {
    const embed = buildEmbed(data, applicationId);
    const components = buildButtons(applicationId);

    const payload = {
      embeds: [embed]
    };
    if (components.length > 0) {
      payload.components = components;
    }

    // Post the message via the bot
    const posted = await postMessage(channelId, payload, botToken);

    // Add vote reactions with a delay to avoid rate limits
    await addReaction(channelId, posted.id, VOTE_UP, botToken);
    await sleep(350);
    await addReaction(channelId, posted.id, VOTE_DOWN, botToken);

    return res.status(200).json({ ok: true, message_id: posted.id });
  } catch (err) {
    console.error('Post application error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
