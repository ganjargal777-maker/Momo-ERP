import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://erp.momoshop.mn",
  "http://localhost:4173",
]);

const json = (origin: string, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://erp.momoshop.mn",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });

const requiredText = (value: unknown, maxLength: number) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS") return json(origin, 200, { ok: true });
  if (request.method !== "POST") return json(origin, 405, { error: "Зөвхөн POST хүсэлт зөвшөөрнө." });
  if (!allowedOrigins.has(origin)) return json(origin, 403, { error: "Энэ origin-оос хүсэлт зөвшөөрөхгүй." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization?.startsWith("Bearer ")) {
    return json(origin, 401, { error: "Нэвтрэх мэдээлэл баталгаажаагүй байна." });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = authorization.slice("Bearer ".length);
  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) return json(origin, 401, { error: "Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү." });

  const [{ data: callerProfile, error: profileError }, { data: canManage, error: permissionError }] = await Promise.all([
    callerClient.from("profiles").select("organization_id,status").eq("id", userData.user.id).single(),
    callerClient.rpc("has_permission", { required_permission: "users.manage" }),
  ]);
  if (profileError || permissionError || callerProfile?.status !== "active" || !callerProfile.organization_id || canManage !== true) {
    return json(origin, 403, { error: "Хэрэглэгч нэмэх эрх хүрэлцэхгүй байна." });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(origin, 400, { error: "Хүсэлтийн өгөгдөл буруу байна." });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const firstName = requiredText(body.firstName, 100);
  const lastName = requiredText(body.lastName, 100);
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const department = requiredText(body.department, 120);
  const position = requiredText(body.position, 120);
  const roleId = typeof body.roleId === "string" ? body.roleId : "";
  const startDate = body.startDate === "" || body.startDate == null ? null : String(body.startDate);
  const active = body.active !== false;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(origin, 400, { error: "Цахим хаяг буруу байна." });
  if (!firstName || !lastName || !department || !position) return json(origin, 400, { error: "Заавал бөглөх талбаруудыг бүрэн оруулна уу." });
  if (!/^\d{8}$/.test(phone)) return json(origin, 400, { error: "Утасны дугаар 8 оронтой байна." });
  if (!uuidPattern.test(roleId)) return json(origin, 400, { error: "Хандах эрхийн сонголт буруу байна." });
  if (startDate && !datePattern.test(startDate)) return json(origin, 400, { error: "Ажилд орсон огноо буруу байна." });

  const { data: role, error: roleError } = await callerClient
    .from("roles")
    .select("id,organization_id")
    .eq("id", roleId)
    .maybeSingle();
  if (roleError) {
    console.error("invite-user role lookup failed", roleError);
    return json(origin, 500, { error: "Хандах эрхийн мэдээллийг шалгаж чадсангүй." });
  }
  if (!role || role.organization_id !== callerProfile.organization_id) {
    return json(origin, 400, { error: "Сонгосон хандах эрх тухайн байгууллагад олдсонгүй." });
  }

  const { data: duplicateProfile } = await adminClient.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (duplicateProfile) return json(origin, 409, { error: "Энэ цахим хаягтай хэрэглэгч бүртгэлтэй байна." });

  const { data: invitation, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: "https://erp.momoshop.mn/?setup=1",
    data: {
      organization_id: callerProfile.organization_id,
      first_name: firstName,
      last_name: lastName,
      phone,
    },
  });
  if (inviteError || !invitation.user) {
    const inviteMessage = inviteError?.message ?? "";
    const duplicate = /already|registered|exists/i.test(inviteMessage);
    const rateLimited = /rate|limit|too many/i.test(inviteMessage);
    console.error("invite-user auth invitation failed", inviteError);
    return json(origin, duplicate ? 409 : 502, {
      error: duplicate
        ? "Энэ цахим хаягтай хэрэглэгч бүртгэлтэй байна."
        : rateLimited
          ? "Урилгын имэйл илгээх хязгаарт хүрсэн байна. Түр хүлээгээд дахин оролдоно уу."
          : "Урилгын имэйл илгээж чадсангүй. Supabase Auth email тохиргоог шалгана уу.",
    });
  }

  const { error: provisionError } = await adminClient.rpc("provision_invited_user", {
    invited_user_id: invitation.user.id,
    actor_user_id: userData.user.id,
    target_organization_id: callerProfile.organization_id,
    target_role_id: roleId,
    profile_first_name: firstName,
    profile_last_name: lastName,
    profile_email: email,
    profile_phone: phone,
    profile_department: department,
    profile_position: position,
    profile_start_date: startDate,
    profile_is_active: active,
  });

  if (provisionError) {
    console.error("invite-user profile provisioning failed", provisionError);
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invitation.user.id);
    if (cleanupError) console.error("invite-user cleanup failed", cleanupError);
    return json(origin, 500, { error: "Хэрэглэгчийн profile болон эрхийг үүсгэж чадсангүй. Урилгыг цуцаллаа." });
  }

  return json(origin, 200, {
    ok: true,
    message: "Хэрэглэгч амжилттай нэмэгдэж, нууц үг тохируулах урилга илгээгдлээ.",
    userId: invitation.user.id,
  });
});
