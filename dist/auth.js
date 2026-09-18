(() => {
  const gate = document.querySelector('#auth-gate');
  const form = document.querySelector('#login-form');
  const error = document.querySelector('#auth-error');
  const setupForm = document.querySelector('#setup-password-form');
  const setupError = document.querySelector('#setup-error');
  const loginCopy = document.querySelector('#login-copy');
  const setupCopy = document.querySelector('#setup-copy');
  const shell = document.querySelector('.app-shell');
  const config = window.__NEXERP_CONFIG__ || {};
  const setupRequested = new URLSearchParams(location.search).get('setup') === '1';
  let appLoaded = false;

  const showError = (message, target = error) => { target.textContent = message; target.hidden = false; };
  const setBusy = (busy, targetForm = form, label = 'Нэвтрэх') => {
    const button = targetForm.querySelector('button[type="submit"]');
    button.disabled = busy;
    button.querySelector('span').textContent = busy ? 'Шалгаж байна...' : label;
  };
  const showLogin = () => {
    document.body.className = 'auth-pending'; shell.setAttribute('aria-hidden', 'true'); gate.hidden = false;
    loginCopy.hidden = false; form.hidden = false; setupCopy.hidden = true; setupForm.hidden = true;
  };
  const showPasswordSetup = () => {
    document.body.className = 'auth-pending'; shell.setAttribute('aria-hidden', 'true'); gate.hidden = false;
    loginCopy.hidden = true; form.hidden = true; setupCopy.hidden = false; setupForm.hidden = false;
  };
  const loadApp = () => {
    if (appLoaded) return;
    appLoaded = true;
    const script = document.createElement('script'); script.src = 'app.js'; document.body.appendChild(script);
  };

  if (!config.url || !config.publishableKey || !window.supabase) {
    showError('Supabase тохиргоо ачаалагдсангүй. Администраторт хандана уу.');
    form.querySelector('button[type="submit"]').disabled = true; showLogin(); return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const authorize = async (session) => {
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('organization_id,first_name,last_name,email,status')
      .eq('id', session.user.id).single();
    if (profileError || !profile || profile.status !== 'active') {
      await client.auth.signOut(); showLogin();
      showError('Таны ERP хэрэглэгчийн эрх идэвхжээгүй байна. Администраторт хандана уу.'); return;
    }
    const { data: assignments, error: roleError } = await client.from('user_roles')
      .select('roles(name)').eq('user_id', session.user.id);
    if (roleError || !assignments?.length) {
      await client.auth.signOut(); showLogin();
      showError('Таны ERP хандах эрх тохируулагдаагүй байна. Администраторт хандана уу.'); return;
    }
    const { data: organization } = await client.from('organizations').select('name').eq('id', profile.organization_id).maybeSingle();
    const authenticatedProfile = {
      id: session.user.id, organizationId: profile.organization_id,
      organizationName: organization?.name || 'Momo ERP', firstName: profile.first_name?.trim() || '',
      lastName: profile.last_name?.trim() || '', email: profile.email || session.user.email || '',
      roleName: assignments[0]?.roles?.name || 'Хэрэглэгч'
    };
    window.nexerpAuth = { client, profile: authenticatedProfile };
    const fullName = [authenticatedProfile.lastName, authenticatedProfile.firstName].filter(Boolean).join(' ') || authenticatedProfile.email;
    const greetingName = authenticatedProfile.firstName || authenticatedProfile.email;
    const initials = [authenticatedProfile.lastName?.[0], authenticatedProfile.firstName?.[0]].filter(Boolean).join('') || authenticatedProfile.email.slice(0, 2).toUpperCase() || 'ERP';
    const profileButton = document.querySelector('#auth-profile');
    profileButton.querySelector('strong').textContent = fullName; profileButton.querySelector('small').textContent = authenticatedProfile.roleName;
    profileButton.querySelector('.avatar').textContent = initials;
    document.querySelector('#dashboard-greeting').textContent = `Өдрийн мэнд, ${greetingName}`;
    gate.hidden = true; shell.removeAttribute('aria-hidden'); document.body.className = 'auth-ready'; loadApp();
  };

  form.addEventListener('submit', async event => {
    event.preventDefault(); error.hidden = true; setBusy(true); const values = new FormData(form);
    const { data, error: signInError } = await client.auth.signInWithPassword({ email: values.get('email').trim(), password: values.get('password') });
    setBusy(false);
    if (signInError) return showError('Цахим хаяг эсвэл нууц үг буруу байна.');
    await authorize(data.session);
  });

  setupForm.addEventListener('submit', async event => {
    event.preventDefault(); setupError.hidden = true; const values = new FormData(setupForm);
    const password = values.get('password');
    if (password !== values.get('confirmPassword')) return showError('Нууц үгүүд хоорондоо таарахгүй байна.', setupError);
    setBusy(true, setupForm, 'Нууц үг хадгалах');
    const { error: updateError } = await client.auth.updateUser({ password });
    setBusy(false, setupForm, 'Нууц үг хадгалах');
    if (updateError) return showError(updateError.message || 'Нууц үг хадгалж чадсангүй.', setupError);
    history.replaceState({}, document.title, '/');
    const { data } = await client.auth.getSession();
    if (data.session) await authorize(data.session); else showLogin();
  });

  document.querySelector('#auth-profile').addEventListener('click', async () => {
    if (!confirm('Системээс гарах уу?')) return;
    await client.auth.signOut(); location.reload();
  });
  client.auth.getSession().then(({ data }) => {
    if (setupRequested) {
      if (data.session) showPasswordSetup();
      else { showLogin(); showError('Урилгын холбоос хүчингүй эсвэл хугацаа дууссан байна.'); }
    } else if (data.session) authorize(data.session); else showLogin();
  });
  if (window.lucide) window.lucide.createIcons();
})();
