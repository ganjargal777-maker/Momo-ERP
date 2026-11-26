import { inviteRedirectUrl, isValidStartDate, canonicalOrigins } from './invitation.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requiredText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
class RequestFailure extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new RequestFailure(status, code, message); };
const SQL_REJECTION_STATUS = Object.freeze({
  P0001: 400, '42501': 403, '23502': 400, '23503': 409, '23505': 409,
  '23514': 400, '22001': 400, '22003': 400, '22007': 400, '22008': 400,
  '22023': 400, '22P02': 400,
});
function provisionOutcome(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'data')) return 'unknown';
  if (value.error === null && [200, 204].includes(value.status) &&
      (value.data === null || (value.status === 200 && value.data === ''))) return 'success';
  if (value.data === null && value.error && typeof value.error === 'object' &&
      Object.hasOwn(SQL_REJECTION_STATUS, value.error.code) && SQL_REJECTION_STATUS[value.error.code] === value.status) return 'rejected';
  return 'unknown';
}
async function boundedBody(request, limit, check) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) fail(413, 'body_too_large', 'Хүсэлтийн өгөгдөл хэт их байна.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_request', 'Хүсэлтийн өгөгдөл буруу байна.');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      check(); const { done, value } = await reader.read(); check(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); fail(413, 'body_too_large', 'Хүсэлтийн өгөгдөл хэт их байна.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { fail(400, 'invalid_request', 'Хүсэлтийн өгөгдөл буруу байна.'); }
}

/**
 * Dependency-injected Edge business handler. No SDK import, environment read or
 * network is performed unless the caller supplies createClient dependencies.
 * The service credential stays backend-only. env may be an object or getter.
 */
export function createInviteHandler({ createClient, env = {}, logger = () => {}, timeoutMs = 15000, maxBodyBytes = 65536 } = {}) {
  if (typeof createClient !== 'function' || typeof logger !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60000 ||
      !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 65536) throw new TypeError('Invalid invitation handler dependencies or bounds.');
  const get = name => typeof env === 'function' ? env(name) : env[name];
  const log = stage => { try { logger({ stage }); } catch { /* logging never leaks SDK failures or breaks cleanup */ } };
  return async function handle(request) {
    const origin = request.headers.get('origin') ?? '';
    const origins = new Set(canonicalOrigins);
    const requestId = crypto.randomUUID();
    const json = (status, body) => new Response(JSON.stringify({ ...body, requestId }), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        ...(origins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'X-Request-Id': requestId },
    });
    let redirectTo;
    try { redirectTo = inviteRedirectUrl(get('ERP_INVITE_REDIRECT_URL')); origins.add(new URL(redirectTo).origin); }
    catch { return json(500, { error: 'Урилгын буцах хаягийн тохиргоо буруу байна.', code: 'invalid_invitation_callback' }); }
    if (!origins.has(origin)) return json(403, { error: 'Энэ origin-оос хүсэлт зөвшөөрөхгүй.', code: 'origin_forbidden' });
    if (request.method === 'OPTIONS') return json(200, { ok: true });
    if (request.method !== 'POST') return json(405, { error: 'Зөвхөн POST хүсэлт зөвшөөрнө.', code: 'method_not_allowed' });

    let timedOut = false, mutationStarted = false, timer;
    const check = () => { if (timedOut) fail(504, 'invitation_timeout', 'Хүсэлтийн хугацаа дууслаа. Шинэ урилга давтан илгээхээс өмнө төлөвийг шалгана уу.'); };
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      timedOut = true; reject(new RequestFailure(504, 'invitation_timeout', 'Хүсэлтийн хугацаа дууслаа. Шинэ урилга давтан илгээхээс өмнө төлөвийг шалгана уу.'));
    }, timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const supabaseUrl = get('SUPABASE_URL'), anonKey = get('SUPABASE_ANON_KEY'), serviceRoleKey = get('SUPABASE_SERVICE_ROLE_KEY');
        const authorization = request.headers.get('authorization');
        if (!supabaseUrl || !anonKey || !serviceRoleKey || typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._~-]{1,4096}$/u.test(authorization)) {
          fail(401, 'unauthorized', 'Нэвтрэх мэдээлэл баталгаажаагүй байна.');
        }
        const caller = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await caller.auth.getUser(authorization.slice(7)); check();
        if (userError || !userData?.user?.id || userData.user.is_anonymous === true) fail(401, 'unauthorized', 'Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.');
        const [{ data: profile, error: profileError }, { data: canManage, error: permissionError }] = await Promise.all([
          caller.from('profiles').select('organization_id,status').eq('id', userData.user.id).single(),
          caller.rpc('has_permission', { required_permission: 'users.manage' }),
        ]); check();
        if (profileError || permissionError || profile?.status !== 'active' || !profile.organization_id || canManage !== true) {
          fail(403, 'permission_denied', 'Хэрэглэгч нэмэх эрх хүрэлцэхгүй байна.');
        }
        const body = await boundedBody(request, maxBodyBytes, check); check();
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const firstName = requiredText(body.firstName, 100), lastName = requiredText(body.lastName, 100);
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const department = requiredText(body.department, 120), position = requiredText(body.position, 120);
        const roleId = typeof body.roleId === 'string' ? body.roleId : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) fail(400, 'invalid_email', 'Цахим хаяг буруу байна.');
        if (!firstName || !lastName || !department || !position) fail(400, 'required_fields', 'Заавал бөглөх талбаруудыг бүрэн оруулна уу.');
        if (!/^\d{8}$/u.test(phone)) fail(400, 'invalid_phone', 'Утасны дугаар 8 оронтой байна.');
        if (!UUID.test(roleId)) fail(400, 'invalid_role', 'Хандах эрхийн сонголт буруу байна.');
        if (!isValidStartDate(body.startDate)) fail(400, 'invalid_start_date', 'Ажилд орсон огноо буруу байна.');
        const { data: role, error: roleError } = await caller.from('roles').select('id,organization_id').eq('id', roleId).maybeSingle(); check();
        if (roleError) { log('role_lookup_failed'); fail(500, 'role_lookup_failed', 'Хандах эрхийн мэдээллийг шалгаж чадсангүй.'); }
        if (!role || role.organization_id !== profile.organization_id) fail(400, 'role_not_in_organization', 'Сонгосон хандах эрх тухайн байгууллагад олдсонгүй.');
        const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: duplicate, error: duplicateError } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle(); check();
        if (duplicateError) { log('duplicate_lookup_failed'); fail(500, 'duplicate_lookup_failed', 'Бүртгэлийн мэдээллийг шалгаж чадсангүй.'); }
        if (duplicate) fail(409, 'duplicate_user', 'Энэ цахим хаягтай хэрэглэгч бүртгэлтэй байна.');
        mutationStarted = true;
        const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo, data: { organization_id: profile.organization_id, first_name: firstName, last_name: lastName, phone },
        }); check();
        if (inviteError || !invitation?.user?.id) {
          const message = typeof inviteError?.message === 'string' ? inviteError.message : '';
          const duplicateUser = /already|registered|exists/iu.test(message), limited = /rate|limit|too many/iu.test(message);
          log('auth_invitation_failed');
          const confirmedRejection = Number.isInteger(inviteError?.status) && inviteError.status >= 400 && inviteError.status < 500 && inviteError.status !== 408;
          if (!confirmedRejection) return json(502, { error: 'Auth урилгыг илгээсэн эсэхийг баталж чадсангүй. Давтан урилга илгээхээс өмнө администратор төлөвийг тулгаж шалгана уу.',
            code: 'invitation_outcome_unknown', outcomeUnknown: true, reconciliationRequired: true });
          return json(duplicateUser ? 409 : 502, { error: duplicateUser ? 'Энэ цахим хаягтай хэрэглэгч бүртгэлтэй байна.'
            : limited ? 'Урилгын имэйл илгээх хязгаарт хүрсэн байна. Төлөвийг шалгасны дараа дахин оролдоно уу.'
              : 'Auth урилгын хүсэлтийг зөвшөөрсөнгүй. Администратор тохиргоо болон бүртгэлийн төлөвийг шалгана уу.',
            code: duplicateUser ? 'duplicate_user' : limited ? 'invitation_rate_limited' : 'invitation_failed',
            outcomeUnknown: false, reconciliationRequired: true });
        }
        let provision;
        try {
          provision = await admin.rpc('provision_invited_user', {
            invited_user_id: invitation.user.id, actor_user_id: userData.user.id,
            target_organization_id: profile.organization_id, target_role_id: roleId,
            profile_first_name: firstName, profile_last_name: lastName, profile_email: email, profile_phone: phone,
            profile_department: department, profile_position: position, profile_start_date: body.startDate || null,
            profile_is_active: body.active !== false,
          }); check();
        } catch (error) {
          if (error instanceof RequestFailure) throw error;
          log('provision_outcome_unknown');
          return json(502, { error: 'Хэрэглэгчийн profile үүссэн эсэхийг баталж чадсангүй. Давтан урилга илгээхээс өмнө төлөвийг шалгана уу.', code: 'provision_outcome_unknown', outcomeUnknown: true, reconciliationRequired: true });
        }
        const outcome = provisionOutcome(provision);
        if (outcome === 'unknown') {
          log('provision_outcome_unknown');
          return json(502, { error: 'Хэрэглэгчийн profile болон эрхийн өөрчлөлт хадгалагдсан эсэх нь тодорхойгүй. Auth урилгыг хэвээр хадгалсан; давтахаас өмнө администратор төлөвийг тулгаж шалгана уу.',
            code: 'provision_outcome_unknown', outcomeUnknown: true, reconciliationRequired: true });
        }
        if (outcome === 'rejected') {
          log('profile_provisioning_failed');
          // GoTrue may return an existing unconfirmed user's ID. Neither an
          // invite response nor a confirmed SQL rejection proves this operation
          // exclusively owns the Auth user, so automatic deletion is unsafe.
          return json(500, { error: 'Энэ хүсэлтээр profile болон эрхийг үүсгэж чадсангүй. Auth урилгыг хэвээр хадгалсан; администратор бүртгэлийн төлөвийг тулгаж шалгана уу.',
            code: 'profile_provisioning_failed', outcomeUnknown: false, reconciliationRequired: true });
        }
        return json(200, { ok: true, message: 'Хэрэглэгч амжилттай нэмэгдэж, нууц үг тохируулах урилга илгээгдлээ.', userId: invitation.user.id });
      })()]);
    } catch (error) {
      const known = error instanceof RequestFailure;
      if (!known) log('unexpected_sdk_failure');
      return json(known ? error.status : 502, { error: known ? error.message : 'Урилгын үйлчилгээний хүсэлт амжилтгүй. Давтахаас өмнө төлөвийг шалгана уу.',
        code: known ? error.code : 'invitation_backend_failed', outcomeUnknown: mutationStarted, reconciliationRequired: mutationStarted });
    } finally { clearTimeout(timer); }
  };
}
