// ============================================
// GUILD POSTS / REACTIONS (shared module)
// ============================================

const REACTIONS = [
    { key: 'thumbs_up',   emoji: '👍' },
    { key: 'thumbs_down', emoji: '👎' },
    { key: 'heart',       emoji: '❤️' },
    { key: 'fire',        emoji: '🔥' },
    { key: 'party',       emoji: '🎉' },
    { key: 'laugh',       emoji: '😂' },
  ];
  
  function escapeHtmlPosts(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  
  function fmtPostDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  
  // Convert plain text body to HTML with line breaks preserved and links auto-detected
  function renderPostBody(text) {
    const escaped = escapeHtmlPosts(text);
    // Simple URL detection (http/https)
    const withLinks = escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
    return withLinks.replace(/\n/g, '<br>');
  }
  
  function buildReactionsRow(post, currentUserId, reactionsByPost) {
    const postReactions = reactionsByPost[post.id] || {};
    return REACTIONS.map(r => {
      const users = postReactions[r.key] || [];
      const count = users.length;
      const userReacted = users.includes(currentUserId);
      return `<button class="reaction-btn ${userReacted ? 'reaction-btn-active' : ''}"
        data-post-id="${post.id}" data-reaction="${r.key}" title="${r.key.replace('_', ' ')}">
        <span class="reaction-emoji">${r.emoji}</span>
        ${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
      </button>`;
    }).join('');
  }
  
  function renderPost(post, currentUserId, reactionsByPost, authorMap) {
    const author = authorMap[post.author_id];
    const authorName = author?.ign || 'Staff';
    const authorAvatar = author?.avatar_url;
    const authorClass = author?.role === 'staff' ? 'post-author-staff' : '';
    const reactionsHtml = buildReactionsRow(post, currentUserId, reactionsByPost);
    const avatarHtml = authorAvatar
      ? `<div class="post-author-avatar ${authorClass}"><img src="${escapeHtmlPosts(authorAvatar)}" alt=""></div>`
      : `<div class="post-author-avatar post-author-avatar-default ${authorClass}">
           <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
             <circle cx="12" cy="7" r="4"></circle>
           </svg>
         </div>`;
    return `
      <article class="post-card ${post.pinned ? 'post-card-pinned' : ''}">
        ${post.pinned ? '<div class="post-pinned-badge">📌 Pinned</div>' : ''}
        <header class="post-card-header">
          <h3 class="post-card-title">${escapeHtmlPosts(post.title)}</h3>
          <div class="post-card-meta">
            ${avatarHtml}
            <span class="post-author-name">${escapeHtmlPosts(authorName)}</span>
            <span class="post-meta-sep">·</span>
            <span class="post-card-date">${fmtPostDate(post.created_at)}</span>
          </div>
        </header>
        <div class="post-card-body">${renderPostBody(post.body)}</div>
        <div class="post-reactions">${reactionsHtml}</div>
      </article>
    `;
  }
  
  // Load posts of a given type + their reactions + author profiles
  async function loadPostsWithReactions(type, limit = null) {
    let query = supabase
      .from('guild_posts')
      .select('*')
      .eq('type', type)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (limit) query = query.limit(limit);
    const { data: posts, error: postsErr } = await query;
    if (postsErr) return { posts: [], reactionsByPost: {}, authorMap: {}, error: postsErr };
  
    if (!posts || posts.length === 0) {
      return { posts: [], reactionsByPost: {}, authorMap: {}, error: null };
    }
  
    // Load reactions for these posts
    const postIds = posts.map(p => p.id);
    const { data: reactions } = await supabase
      .from('post_reactions')
      .select('*')
      .in('post_id', postIds);
  
    // Group reactions
    const reactionsByPost = {};
    (reactions || []).forEach(r => {
      if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
      if (!reactionsByPost[r.post_id][r.reaction]) reactionsByPost[r.post_id][r.reaction] = [];
      reactionsByPost[r.post_id][r.reaction].push(r.user_id);
    });
  
    // Load author profiles
    const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
    const authorMap = {};
    if (authorIds.length > 0) {
      const { data: authors } = await supabase
        .from('profiles')
        .select('id, ign, avatar_url, role')
        .in('id', authorIds);
      (authors || []).forEach(a => { authorMap[a.id] = a; });
    }
  
    return { posts, reactionsByPost, authorMap, error: null };
  }
  
  // Toggle a reaction (add if missing, remove if present)
  async function toggleReaction(postId, reactionKey, currentUserId) {
    // Check if it exists
    const { data: existing } = await supabase
      .from('post_reactions')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', currentUserId)
      .eq('reaction', reactionKey)
      .maybeSingle();
  
    if (existing) {
      // Remove
      const { error } = await supabase
        .from('post_reactions')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', currentUserId)
        .eq('reaction', reactionKey);
      return { added: false, error };
    } else {
      // Add
      const { error } = await supabase
        .from('post_reactions')
        .insert({ post_id: postId, user_id: currentUserId, reaction: reactionKey });
      return { added: true, error };
    }
  }
  
  function attachReactionHandlers(currentUserId, onChange) {
    document.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const postId = btn.dataset.postId;
        const reactionKey = btn.dataset.reaction;
        const { error } = await toggleReaction(postId, reactionKey, currentUserId);
        btn.disabled = false;
        if (error) {
          alert('Reaction failed: ' + error.message);
          return;
        }
        if (onChange) onChange();
      });
    });
  }