// ============================================
// SUPABASE CONFIGURATION
// ============================================
// These are PUBLIC keys - safe to expose in browser code.
// The anon key has no elevated permissions; RLS policies enforce security.

const SUPABASE_URL = 'https://qcudyzwzymaloydnfpfb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdWR5end6eW1hbG95ZG5mcGZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTYyMTEsImV4cCI6MjA5MDk3MjIxMX0.on5MRPAudYmmY3Jyhi5Dux6mHilJJEgvlvqxkNfqgf8';

// The UMD build from the CDN exposes the library as window.supabase.
// We extract the library, then create our client, then attach the client back to window.
// This avoids naming confusion between "the library" and "the client".
(function() {
  if (typeof window === 'undefined') return;

  const supabaseLib = window.supabase;
  if (!supabaseLib || typeof supabaseLib.createClient !== 'function') {
    console.error('[config.js] Supabase library not found. Make sure the CDN script tag is loaded BEFORE config.js.');
    return;
  }

  // Create the client and overwrite window.supabase with it.
  // All our code uses `supabase.auth.xxx` / `supabase.from(xxx)` - they want the client.
  window.supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();

// Create a top-level `supabase` variable bound to the client so inline scripts can use it.
// (This works because it runs after the IIFE above has set window.supabase to the client.)
var supabase = window.supabase;

// ============================================
// DISCORD WEBHOOKS
// ============================================
// Browser-side webhook URLs. Not secret — worst case is spam.
// To rotate: regenerate the webhook in Discord, paste the new URL here, redeploy.
const DISCORD_APPLICATION_WEBHOOK = 'https://discord.com/api/webhooks/1490972240223666266/JXRtgFbMd0uMYCBf8uHUXu8ht58bsASq9CjERswy8MieJP4rSK9hoHpWwFUz8CSZRK8I';