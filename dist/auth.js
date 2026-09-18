(() => {
  const gate = document.querySelector('#auth-gate');
  const form = document.querySelector('#login-form');
  const error = document.querySelector('#auth-error');
  const shell = document.querySelector('.app-shell');
  const config = window.__NEXERP_CONFIG__ || {};
  let appLoaded = false;

  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  const setBusy = (busy) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = busy;
    button.querySelector('span').textContent = busy ? 'Шалгаж байна...' : 'Нэвтрэх';
  };

  const showLogin = () => {
    document.body.classList.remove('auth-ready');
    document.body.classList.add('auth-pending');
    shell.setAttribute('aria-hidden', 'true');
    gate.hidden = false;
  };

  const loadApp = () => {
    if (appLoaded) return;
    appLoaded = true;
    const script = document.createElement('script');
    script.src = 'app.js';
    document.body.appendChild(script);
  };

  if (!config.url || !config.publishableKey || !window.supabase) {
    showError('Supabase тохиргоо ачаалагдсангүй. Администраторт хандана уу.');
    form.querySelector('button[type="submit"]').disabled = true;
    showLogin();
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const authorize = async (session) => {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('first_name,last_name,email,status')
      .eq('id', session.user.id)
      .single();

    if (profileError || !profile || profile.status !== 'active') {
      await client.auth.signOut();
      showLogin();
      showError('Таны ERP хэрэглэгчийн эрх идэвхжээгүй байна. Администраторт хандана уу.');
      return;
    }

    const { data: roleAssignments, error: roleError } = await client
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', session.user.id);

    if (roleError || !roleAssignments?.length) {
      await client.auth.signOut();
      showLogin();
      showError('Таны ERP хандах эрх тохируулагдаагүй байна. Администраторт хандана уу.');
      return;
    }

    const authenticatedProfile = {
      firstName: profile.first_name?.trim() || '',
      lastName: profile.last_name?.trim() || '',
      email: profile.email || session.user.email || '',
      roleName: roleAssignments[0]?.roles?.name || 'Хэрэглэгч'
    };
    const fullName = [authenticatedProfile.lastName, authenticatedProfile.firstName].filter(Boolean).join(' ') || authenticatedProfile.email;
    const greetingName = authenticatedProfile.firstName || authenticatedProfile.email;
    const initials = [authenticatedProfile.lastName?.[0], authenticatedProfile.firstName?.[0]].filter(Boolean).join('') || authenticatedProfile.email.slice(0, 2).toUpperCase() || 'ERP';
    const profileButton = document.querySelector('#auth-profile');
    profileButton.querySelector('strong').textContent = fullName;
    profileButton.querySelector('small').textContent = authenticatedProfile.roleName;
    profileButton.querySelector('.avatar').textContent = initials;
    document.querySelector('#dashboard-greeting').textContent = `Өдрийн мэнд, ${greetingName}`;

    gate.hidden = true;
    shell.removeAttribute('aria-hidden');
    document.body.classList.remove('auth-pending');
    document.body.classList.add('auth-ready');
    loadApp();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    setBusy(true);
    const values = new FormData(form);
    const { data, error: signInError } = await client.auth.signInWithPassword({
      email: values.get('email').trim(),
      password: values.get('password')
    });
    setBusy(false);

    if (signInError) {
      showError('Цахим хаяг эсвэл нууц үг буруу байна.');
      return;
    }
    await authorize(data.session);
  });

  document.querySelector('#auth-profile').addEventListener('click', async () => {
    if (!window.confirm('Системээс гарах уу?')) return;
    await client.auth.signOut();
    window.location.reload();
  });

  client.auth.getSession().then(({ data }) => {
    if (data.session) authorize(data.session);
    else showLogin();
  });

  if (window.lucide) window.lucide.createIcons();
})();
