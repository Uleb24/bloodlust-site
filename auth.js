// ============================================
// AUTH HELPER - runs on every page
// ============================================

let currentUser = null;
let currentProfile = null;
let _updateAuthUIInFlight = false;

async function updateAuthUI() {
  if (_updateAuthUIInFlight) return;
  _updateAuthUIInFlight = true;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    currentUser = user;

    const authIcon = document.getElementById('auth-icon');
    const navLinks = document.querySelector('.nav-links');
    if (!authIcon || !navLinks) return;

    // Always clean out any previously added auth items first
    navLinks.querySelectorAll('.nav-auth-item').forEach(el => el.remove());
    closeAuthMenu();

    if (!user) {
      authIcon.classList.remove('logged-in', 'is-staff', 'has-avatar');
      authIcon.setAttribute('href', 'login.html');
      authIcon.setAttribute('title', 'Log In / Sign Up');
      authIcon.onclick = null;
      // Restore default silhouette SVG
      authIcon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>`;
      currentProfile = null;
      // Remove any menu from previous logged-in state
      const oldMenu = document.getElementById('auth-menu');
      if (oldMenu) oldMenu.remove();
      return;
    }

    // Logged in: fetch profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    currentProfile = profile;

    authIcon.classList.add('logged-in');
    const isStaff = profile?.role === 'staff';
    if (isStaff) authIcon.classList.add('is-staff');

    // Show avatar image if user has one; otherwise keep the SVG silhouette
    if (profile?.avatar_url) {
      authIcon.innerHTML = `<img src="${profile.avatar_url}" alt="avatar" class="auth-icon-img">`;
      authIcon.classList.add('has-avatar');
    } else {
      // Restore default SVG icon
      authIcon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>`;
      authIcon.classList.remove('has-avatar');
    }

    // Icon toggles dropdown instead of navigating
    authIcon.setAttribute('href', '#');
    authIcon.setAttribute('title', profile?.ign || 'Account');
    authIcon.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAuthMenu();
    };

    // Add Dashboard link
    const dashLi = document.createElement('li');
    dashLi.className = 'nav-auth-item';
    dashLi.innerHTML = '<a href="dashboard.html">Dashboard</a>';
    navLinks.appendChild(dashLi);

    // Add Admin link if staff
    if (isStaff) {
      const adminLi = document.createElement('li');
      adminLi.className = 'nav-auth-item';
      adminLi.innerHTML = '<a href="admin.html">Admin</a>';
      navLinks.appendChild(adminLi);
    }

    createAuthMenu(profile);
  } finally {
    _updateAuthUIInFlight = false;
  }
}

function createAuthMenu(profile) {
  // Remove any existing menu
  const existing = document.getElementById('auth-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'auth-menu';
  menu.className = 'auth-menu';
  const displayName = profile?.ign || currentUser?.email || 'Account';
  menu.innerHTML = `
    <div class="auth-menu-header">${displayName}</div>
    <a href="profile.html" class="auth-menu-item">My Profile</a>
    <a href="dashboard.html" class="auth-menu-item">Dashboard</a>
    <a href="#" class="auth-menu-item auth-menu-logout" id="auth-menu-logout">Log Out</a>
  `;
  document.body.appendChild(menu);

  document.getElementById('auth-menu-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    closeAuthMenu();
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });
}

function toggleAuthMenu() {
  const menu = document.getElementById('auth-menu');
  const icon = document.getElementById('auth-icon');
  if (!menu || !icon) return;

  if (menu.classList.contains('open')) {
    closeAuthMenu();
  } else {
    const rect = icon.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.classList.add('open');
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 0);
  }
}

function closeAuthMenu() {
  const menu = document.getElementById('auth-menu');
  if (menu) menu.classList.remove('open');
  document.removeEventListener('click', handleOutsideClick);
}

function handleOutsideClick(e) {
  const menu = document.getElementById('auth-menu');
  const icon = document.getElementById('auth-icon');
  if (!menu || !icon) return;
  if (!menu.contains(e.target) && !icon.contains(e.target)) {
    closeAuthMenu();
  }
}

async function requireAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

async function requireStaff() {
  const user = await requireAuth();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'staff') {
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

// Listen for auth state changes (includes INITIAL_SESSION on page load)
supabase.auth.onAuthStateChange(() => {
  updateAuthUI();
});