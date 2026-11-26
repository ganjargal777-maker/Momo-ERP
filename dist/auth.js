(() => {
  const gate = document.querySelector('#auth-gate');
  const form = document.querySelector('#login-form');
  const error = document.querySelector('#auth-error');
  const setupForm = document.querySelector('#setup-password-form');
  const setupError = document.querySelector('#setup-error');
  const resetForm = document.querySelector('#reset-password-form');
  const resetError = document.querySelector('#reset-error');
  const resetSuccess = document.querySelector('#reset-success');
  const loginCopy = document.querySelector('#login-copy');
  const resetCopy = document.querySelector('#reset-copy');
  const setupCopy = document.querySelector('#setup-copy');
  const setupDescription = document.querySelector('#setup-description');
  const shell = document.querySelector('.app-shell');
  const config = window.__NEXERP_CONFIG__ || {};
  const urlParams = new URLSearchParams(location.search);
  const setupRequested = urlParams.get('setup') === '1';
  const recoveryRequested = urlParams.get('reset') === '1' || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  let appLoaded = false;

  const showError = (message, target = error) => { target.textContent = message; target.hidden = false; };
  const setBusy = (busy, targetForm = form, label = 'Нэвтрэх') => {
    const button = targetForm.querySelector('button[type="submit"]');
    button.disabled = busy;
    button.querySelector('span').textContent = busy ? 'Шалгаж байна...' : label;
  };
  const showLogin = () => {
    document.body.className = 'auth-pending'; shell.setAttribute('aria-hidden', 'true'); gate.hidden = false;
    loginCopy.hidden = false; form.hidden = false; resetCopy.hidden = true; resetForm.hidden = true;
    setupCopy.hidden = true; setupForm.hidden = true;
  };
  const showPasswordReset = () => {
    document.body.className = 'auth-pending'; shell.setAttribute('aria-hidden', 'true'); gate.hidden = false;
    loginCopy.hidden = true; form.hidden = true; resetCopy.hidden = false; resetForm.hidden = false;
    setupCopy.hidden = true; setupForm.hidden = true;
    resetError.hidden = true; resetSuccess.hidden = true;
  };
  const showPasswordSetup = (isRecovery = recoveryRequested) => {
    document.body.className = 'auth-pending'; shell.setAttribute('aria-hidden', 'true'); gate.hidden = false;
    loginCopy.hidden = true; form.hidden = true; resetCopy.hidden = true; resetForm.hidden = true;
    setupCopy.hidden = false; setupForm.hidden = false;
    setupDescription.textContent = isRecovery
      ? 'Шинэ нууц үгээ оруулж хадгална уу.'
      : 'Өөрийн байнгын нууц үгийг үүсгэнэ үү.';
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
      .select('roles(name,role_permissions(permission_code))').eq('user_id', session.user.id);
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
    const permissions = [...new Set(assignments.flatMap(assignment =>
      (assignment.roles?.role_permissions || []).map(permission => permission.permission_code)
    ))];
    window.nexerpAuth = {
      client,
      profile: authenticatedProfile,
      permissions,
      can: permission => permissions.includes(permission),
      invokeAuthenticated: async (functionName, body) => {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData.session?.access_token) {
          throw new Error('Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.');
        }
        const response = await fetch(`${config.url}/functions/v1/${functionName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: config.publishableKey,
            Authorization: `Bearer ${sessionData.session.access_token}`
          },
          body: JSON.stringify(body)
        });
        let payload;
        try { payload = await response.json(); }
        catch { payload = {}; }
        if (!response.ok || payload.ok !== true) {
          const requestId = payload.requestId ? ` (ID: ${payload.requestId})` : '';
          throw new Error(`${payload.error || payload.message || `Серверийн алдаа (${response.status})`}${requestId}`);
        }
        return payload;
      }
    };
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

  document.querySelector('#show-reset-password').addEventListener('click', () => {
    const email = form.elements.email.value.trim();
    showPasswordReset();
    if (email) resetForm.elements.email.value = email;
    resetForm.elements.email.focus();
  });

  document.querySelector('#back-to-login').addEventListener('click', showLogin);

  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    resetError.hidden = true; resetSuccess.hidden = true;
    setBusy(true, resetForm, 'Сэргээх холбоос илгээх');
    const email = new FormData(resetForm).get('email').trim();
    const { error: resetRequestError } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/`
    });
    setBusy(false, resetForm, 'Сэргээх холбоос илгээх');
    if (resetRequestError) {
      return showError(resetRequestError.message || 'Сэргээх холбоос илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу.', resetError);
    }
    resetSuccess.textContent = 'Хэрэв энэ цахим хаяг бүртгэлтэй бол нууц үг сэргээх холбоос илгээгдлээ. И-мэйлээ шалгана уу.';
    resetSuccess.hidden = false;
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
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) showPasswordSetup(true);
  });
  client.auth.getSession().then(({ data }) => {
    if (setupRequested || recoveryRequested) {
      if (data.session) showPasswordSetup(recoveryRequested);
      else {
        showLogin();
        showError(recoveryRequested
          ? 'Нууц үг сэргээх холбоос хүчингүй эсвэл хугацаа дууссан байна.'
          : 'Урилгын холбоос хүчингүй эсвэл хугацаа дууссан байна.');
      }
    } else if (data.session) authorize(data.session); else showLogin();
  });
  if (window.lucide) window.lucide.createIcons();
})();
