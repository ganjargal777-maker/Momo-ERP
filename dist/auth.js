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
  let setupRequested = urlParams.get('setup') === '1';
  let recoveryRequested = urlParams.get('reset') === '1' || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  let appLoaded = false, reloadRequested = false, generation = 0, currentUserId = null;
  let signInPending = false, resetPending = false, setupPending = false;

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
  const reloadPrivateApp = () => {
    if (!appLoaded || reloadRequested) return;
    reloadRequested = true; location.reload();
  };
  const forgetAuthorization = ({ reload = true } = {}) => {
    generation++; currentUserId = null; delete window.nexerpAuth; showLogin();
    // A reload drops private DOM, app closures and old-user state as well as
    // hiding the shell. The initial login screen must not cause a reload loop.
    if (reload) reloadPrivateApp();
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
    const script = document.createElement('script'); script.src = 'app.js'; script.onload=()=>{const service=document.createElement('script');service.src='social-service.js';service.onload=()=>{const social=document.createElement('script');social.src='social.js';document.body.appendChild(social)};document.body.appendChild(service)};document.body.appendChild(script);
  };

  const validPublicConfig = () => {
    try {
      const url = new URL(config.url), key = config.publishableKey;
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash || typeof key !== 'string') return false;
      if (/^sb_publishable_[A-Za-z0-9_-]{8,512}$/u.test(key)) return true;
      const parts = key.split('.');
      if (parts.length !== 3 || !parts.every(value => /^[A-Za-z0-9_-]+$/u.test(value))) return false;
      const claims = JSON.parse(atob(parts[1].replace(/-/gu, '+').replace(/_/gu, '/')));
      return claims.role === 'anon' && (local || !claims.ref || url.hostname === `${claims.ref}.supabase.co`);
    } catch { return false; }
  };
  if (!validPublicConfig() || !window.supabase?.createClient) {
    showError('Supabase тохиргоо ачаалагдсангүй. Администраторт хандана уу.');
    form.querySelector('button[type="submit"]').disabled = true; showLogin(); return;
  }

  let client;
  try {
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch {
    showError('Supabase холболтын тохиргоо буруу байна. Администраторт хандана уу.');
    form.querySelector('button[type="submit"]').disabled = true; showLogin(); return;
  }

  const authorize = async (session) => {
    if (reloadRequested) return;
    if (!session?.user?.id) { forgetAuthorization(); return; }
    if (recoveryRequested || setupRequested) { showPasswordSetup(recoveryRequested); return; }
    if (currentUserId && currentUserId !== session.user.id && appLoaded) { forgetAuthorization(); return; }
    const attempt = ++generation;
    const current = () => !reloadRequested && generation === attempt && !recoveryRequested && !setupRequested;
    try {
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('organization_id,first_name,last_name,email,status')
      .eq('id', session.user.id).single();
    if (!current()) return;
    if (profileError || !profile || profile.status !== 'active' || !profile.organization_id) {
      forgetAuthorization({ reload: false });
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* gate stays closed */ }
      reloadPrivateApp();
      showError('Таны ERP хэрэглэгчийн эрх идэвхжээгүй байна. Администраторт хандана уу.'); return;
    }
    const { data: assignments, error: roleError } = await client.from('user_roles')
      .select('roles(name,role_permissions(permission_code))').eq('user_id', session.user.id);
    if (!current()) return;
    if (roleError || !assignments?.length) {
      forgetAuthorization({ reload: false });
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* gate stays closed */ }
      reloadPrivateApp();
      showError('Таны ERP хандах эрх тохируулагдаагүй байна. Администраторт хандана уу.'); return;
    }
    const { data: organization, error: organizationError } = await client.from('organizations').select('name').eq('id', profile.organization_id).maybeSingle();
    if (!current()) return;
    if (organizationError || !organization) {
      forgetAuthorization(); showError('Байгууллагын мэдээлэл унших эрх олдсонгүй. Администраторт хандана уу.'); return;
    }
    const authenticatedProfile = {
      id: session.user.id, organizationId: profile.organization_id,
      organizationName: organization?.name || 'Momo ERP', firstName: profile.first_name?.trim() || '',
      lastName: profile.last_name?.trim() || '', email: profile.email || session.user.email || '',
      roleName: assignments[0]?.roles?.name || 'Хэрэглэгч'
    };
    const permissions = [...new Set(assignments.flatMap(assignment =>
      (assignment.roles?.role_permissions || []).map(permission => permission.permission_code)
    ))];
    currentUserId = session.user.id;
    window.nexerpAuth = {
      client,
      profile: authenticatedProfile,
      permissions,
      can: permission => permissions.includes(permission),
      invokeAuthenticated: async (functionName, body) => {
        if (!/^[a-z][a-z0-9-]{0,63}$/u.test(functionName ?? '')) throw new Error('Серверийн үйлдлийн нэр буруу.');
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData.session?.access_token) {
          forgetAuthorization();
          throw new Error('Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.');
        }
        const response = await fetch(`${config.url}/functions/v1/${functionName}`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
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
          const id = payload.error?.requestId || payload.requestId;
          const requestId = typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(id) ? ` (ID: ${id})` : '';
          const message = typeof payload.error === 'string' ? payload.error
            : typeof payload.error?.message === 'string' ? payload.error.message
              : typeof payload.message === 'string' ? payload.message : `Серверийн алдаа (${response.status})`;
          throw new Error(message.slice(0, 500) + requestId);
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
    } catch {
      if (!current()) return;
      forgetAuthorization(); showError('Нэвтрэх эрхийг шалгаж чадсангүй. Холболтоо шалгаад дахин оролдоно уу.');
    }
  };

  form.addEventListener('submit', async event => {
    event.preventDefault(); if (signInPending) return;
    signInPending = true; error.hidden = true; setBusy(true);
    try {
      const values = new FormData(form);
      const { data, error: signInError } = await client.auth.signInWithPassword({ email: String(values.get('email') || '').trim(), password: values.get('password') });
      if (signInError || !data?.session) return showError('Цахим хаяг эсвэл нууц үг буруу байна.');
      await authorize(data.session);
    } catch { showError('Нэвтэрч чадсангүй. Холболтоо шалгаад дахин оролдоно уу.'); }
    finally { signInPending = false; setBusy(false); }
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
    if (resetPending) return;
    resetPending = true;
    resetError.hidden = true; resetSuccess.hidden = true;
    setBusy(true, resetForm, 'Сэргээх холбоос илгээх');
    try {
      const email = String(new FormData(resetForm).get('email') || '').trim();
      const target = new URL('/', location.origin); target.searchParams.set('reset', '1');
      const { error: resetRequestError } = await client.auth.resetPasswordForEmail(email, { redirectTo: target.href });
      if (resetRequestError) return showError('Сэргээх холбоос илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу.', resetError);
      resetSuccess.textContent = 'Хэрэв энэ цахим хаяг бүртгэлтэй бол нууц үг сэргээх холбоос илгээгдлээ. И-мэйлээ шалгана уу.';
      resetSuccess.hidden = false;
    } catch { showError('Сэргээх холбоос илгээж чадсангүй. Холболтоо шалгаад дахин оролдоно уу.', resetError); }
    finally { resetPending = false; setBusy(false, resetForm, 'Сэргээх холбоос илгээх'); }
  });

  setupForm.addEventListener('submit', async event => {
    event.preventDefault(); if (setupPending) return;
    setupError.hidden = true; const values = new FormData(setupForm);
    const password = values.get('password');
    if (typeof password !== 'string' || password.length < 8) return showError('Нууц үг 8-аас доошгүй тэмдэгт байна.', setupError);
    if (password !== values.get('confirmPassword')) return showError('Нууц үгүүд хоорондоо таарахгүй байна.', setupError);
    setupPending = true; setBusy(true, setupForm, 'Нууц үг хадгалах');
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) return showError('Нууц үг хадгалж чадсангүй. Холбоосын хугацаа болон нууц үгийн шаардлагыг шалгана уу.', setupError);
      setupRequested = false; recoveryRequested = false;
      history.replaceState({}, document.title, '/');
      const { data, error: sessionError } = await client.auth.getSession();
      if (!sessionError && data?.session) await authorize(data.session); else forgetAuthorization();
    } catch { showError('Нууц үг хадгалж чадсангүй. Холболтоо шалгаад дахин оролдоно уу.', setupError); }
    finally { setupPending = false; setBusy(false, setupForm, 'Нууц үг хадгалах'); }
  });

  document.querySelector('#auth-profile').addEventListener('click', async () => {
    if (!confirm('Системээс гарах уу?')) return;
    forgetAuthorization({ reload: false });
    try { await client.auth.signOut({ scope: 'local' }); }
    catch { showError('Гарах хүсэлт амжилтгүй. Энэ цонхыг хааж дахин нэвтэрнэ үү.'); }
    finally { reloadPrivateApp(); }
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      generation++; recoveryRequested = true; delete window.nexerpAuth; showPasswordSetup(true);
    } else if (event === 'SIGNED_OUT') forgetAuthorization();
    else if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
      // The callback stays synchronous; do not await Supabase calls in it.
      const eventGeneration = generation;
      setTimeout(() => { if (eventGeneration === generation) authorize(session); }, 0);
    }
  });
  const bootstrapGeneration = generation;
  client.auth.getSession().then(({ data, error: sessionError }) => {
    if (bootstrapGeneration !== generation) return;
    if (setupRequested || recoveryRequested) {
      if (!sessionError && data?.session) showPasswordSetup(recoveryRequested);
      else {
        showLogin();
        showError(recoveryRequested
          ? 'Нууц үг сэргээх холбоос хүчингүй эсвэл хугацаа дууссан байна.'
          : 'Урилгын холбоос хүчингүй эсвэл хугацаа дууссан байна.');
      }
    } else if (!sessionError && data?.session) authorize(data.session); else showLogin();
  }).catch(() => {
    if (bootstrapGeneration !== generation || reloadRequested) return;
    showLogin(); showError('Нэвтрэх төлөв шалгаж чадсангүй. Холболтоо шалгаад дахин оролдоно уу.');
  });
  if (window.lucide) window.lucide.createIcons();
})();
