// ============================================
// PRESENCE SIDEBAR - shows who's online
// ============================================
// Uses Supabase Realtime Presence. Only visible to members and staff.
// Owner appears at the very top, then staff, then members (alpha within each).

const OWNER_UUID = '6c7d5f18-025e-4b8f-b2e9-a639a02ab624';

(function() {
  let presenceChannel = null;
  let currentUser = null;
  let currentProfile = null;
  let profileCache = {}; // userId -> profile

  async function initPresence() {
    // Check auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    currentUser = user;

    // Check role - only members and staff get the sidebar
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (!profile || (profile.role !== 'member' && profile.role !== 'staff')) return;
    currentProfile = profile;
    profileCache[user.id] = profile;

    // Build the sidebar
    buildSidebar();

    // Connect to presence channel
    presenceChannel = supabase.channel('online-users', {
      config: { presence: { key: user.id } }
    });

    presenceChannel
      .on('presence', { event: 'sync' }, async () => {
        await handlePresenceSync();
      })
      .on('presence', { event: 'join' }, async () => {
        await handlePresenceSync();
      })
      .on('presence', { event: 'leave' }, async () => {
        await handlePresenceSync();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Announce ourselves
          await presenceChannel.track({
            user_id: user.id,
            online_at: new Date().toISOString()
          });
        }
      });
  }

  async function handlePresenceSync() {
    if (!presenceChannel) return;
    const state = presenceChannel.presenceState();
    // state is { userId: [{ user_id, online_at }, ...], ... }
    const onlineUserIds = Object.keys(state);

    // Fetch any profiles we don't have cached
    const missingIds = onlineUserIds.filter(id => !profileCache[id]);
    if (missingIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, ign, avatar_url, role')
        .in('id', missingIds);
      (profiles || []).forEach(p => { profileCache[p.id] = p; });
    }

    renderSidebar(onlineUserIds);
  }

  function buildSidebar() {
    if (document.getElementById('presence-sidebar')) return;

    const sidebar = document.createElement('div');
    sidebar.id = 'presence-sidebar';
    sidebar.className = 'presence-sidebar';
    sidebar.innerHTML = `
      <button class="presence-toggle" id="presence-toggle" aria-label="Toggle online list">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"></path>
          <circle cx="17" cy="7" r="4"></circle>
          <path d="M21 21v-2a4 4 0 0 0-3-3.87"></path>
        </svg>
        <span class="presence-toggle-count" id="presence-count">0</span>
      </button>
      <div class="presence-panel" id="presence-panel">
        <div class="presence-panel-header">
          <span class="presence-panel-title">Online Now</span>
          <button class="presence-panel-close" id="presence-panel-close" aria-label="Close">✕</button>
        </div>
        <div class="presence-panel-list" id="presence-panel-list">
          <div class="presence-empty">Loading…</div>
        </div>
      </div>
    `;
    document.body.appendChild(sidebar);

    const toggleBtn = document.getElementById('presence-toggle');
    const closeBtn = document.getElementById('presence-panel-close');
    const panel = document.getElementById('presence-panel');

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('open')
          && !panel.contains(e.target)
          && !toggleBtn.contains(e.target)) {
        panel.classList.remove('open');
      }
    });
  }

  function renderSidebar(onlineUserIds) {
    const listEl = document.getElementById('presence-panel-list');
    const countEl = document.getElementById('presence-count');
    if (!listEl || !countEl) return;

    // Filter to users we have profiles for (should be all of them after sync)
    const onlineProfiles = onlineUserIds
      .map(id => profileCache[id])
      .filter(Boolean)
      // Only show members and staff (sanity filter)
      .filter(p => p.role === 'member' || p.role === 'staff');

    countEl.textContent = onlineProfiles.length;

    if (onlineProfiles.length === 0) {
      listEl.innerHTML = '<div class="presence-empty">No one else is online.</div>';
      return;
    }

    // Sort: owner first, then staff (alpha), then members (alpha)
    onlineProfiles.sort((a, b) => {
      if (a.id === OWNER_UUID) return -1;
      if (b.id === OWNER_UUID) return 1;
      const roleOrder = { staff: 0, member: 1 };
      const ar = roleOrder[a.role] ?? 2;
      const br = roleOrder[b.role] ?? 2;
      if (ar !== br) return ar - br;
      return (a.ign || '').localeCompare(b.ign || '');
    });

    listEl.innerHTML = onlineProfiles.map(renderPresenceRow).join('');
  }

  function escapePres(s) {
    if (s === null || s === undefined) return '';
    return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function renderPresenceRow(p) {
    const ign = p.ign || '(no name)';
    const isStaff = p.role === 'staff';
    const isMe = p.id === currentUser.id;

    const avatarHtml = p.avatar_url
      ? `<div class="presence-avatar ${isStaff ? 'presence-avatar-staff' : 'presence-avatar-member'}"><img src="${escapePres(p.avatar_url)}" alt=""></div>`
      : `<div class="presence-avatar presence-avatar-default ${isStaff ? 'presence-avatar-staff' : 'presence-avatar-member'}">
           <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
             <circle cx="12" cy="7" r="4"></circle>
           </svg>
         </div>`;

    const roleTag = isStaff
      ? '<span class="presence-role presence-role-staff">Staff</span>'
      : '<span class="presence-role presence-role-member">Member</span>';

    return `
      <div class="presence-row ${isMe ? 'presence-row-me' : ''}">
        ${avatarHtml}
        <div class="presence-info">
          <div class="presence-name">${escapePres(ign)}${isMe ? ' <span class="presence-you">(you)</span>' : ''}</div>
          ${roleTag}
        </div>
        <div class="presence-dot" title="Online"></div>
      </div>
    `;
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (presenceChannel) {
      presenceChannel.untrack();
      supabase.removeChannel(presenceChannel);
    }
  });

  // Start once the page is ready and supabase is available
  if (typeof supabase !== 'undefined') {
    // Delay slightly so auth.js can update UI first
    setTimeout(initPresence, 400);
  }
})();