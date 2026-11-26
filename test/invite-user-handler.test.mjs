import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Run the Edge entry point on Node 24 with a synthetic authenticated manager.
// The handler receives Requests normally. All backend calls here are mocks.
const roleId = "00000000-0000-4000-8000-000000000001";
const input = {
  email: "staff@example.invalid", firstName: "Test", lastName: "Staff",
  department: "Test", position: "Staff", phone: "99000000", roleId,
};
const localSetup = "http://localhost:4173/?setup=1";
let callback = localSetup;
let handler;
let invitations = [];
let provisions = [];

function lookup(table, privileged) {
  const query = {
    select: () => query, eq: () => query, ilike: () => query,
    single: async () => ({ data: { organization_id: "tenant", status: "active" } }),
    maybeSingle: async () => ({
      data: !privileged && table === "roles" ? { id: roleId, organization_id: "tenant" } : null,
    }),
  };
  return query;
}

globalThis.invitationTestClient = (_url, key) => ({
  from: table => lookup(table, key === "synthetic-server"),
  auth: {
    getUser: async () => ({ data: { user: { id: "actor" } } }),
    admin: {
      inviteUserByEmail: async (email, options) => {
        invitations.push({ email, options });
        return { data: { user: { id: "invited" } } };
      },
    },
  },
  rpc: async (name, payload) => {
    if (name === "has_permission") return { data: true };
    assert.equal(name, "provision_invited_user");
    provisions.push(payload);
    return {};
  },
});

globalThis.Deno = {
  serve: fn => { handler = fn; },
  env: { get: key => ({
    SUPABASE_URL: "http://localhost", SUPABASE_ANON_KEY: "synthetic-public",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-server", ERP_INVITE_REDIRECT_URL: callback,
  })[key] },
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "npm:@supabase/supabase-js@2") return {
      url: "data:text/javascript,export const createClient = globalThis.invitationTestClient",
      shortCircuit: true,
    };
    return next(specifier, context);
  },
});
try {
  await import("../supabase/functions/invite-user/index.ts");
} finally {
  hook.deregister();
}

function submit(body) {
  return handler(new Request("http://localhost/functions/v1/invite-user", {
    method: "POST", headers: { Origin: "http://localhost:4173", Authorization: "Bearer synthetic" },
    body: JSON.stringify(body),
  }));
}

test.beforeEach(() => { invitations = []; provisions = []; callback = localSetup; });

test("malformed bodies and impossible dates stop before invite or provision", async () => {
  for (const body of [null, [], false, { ...input, startDate: "2026-02-30" }]) {
    assert.equal((await submit(body)).status, 400);
  }
  assert.deepEqual(invitations, []);
  assert.deepEqual(provisions, []);
});

test("unknown server callback stops before sending email", async () => {
  callback = "https://example.invalid";
  assert.equal((await submit(input)).status, 500);
  assert.deepEqual(invitations, []);
  assert.deepEqual(provisions, []);
});

test("valid invitation uses server callback and provisions exact employment date", async () => {
  const response = await submit({ ...input, startDate: "2024-02-29", redirectTo: "https://example.invalid" });
  assert.equal(response.status, 200);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].options.redirectTo, localSetup);
  assert.equal(provisions.length, 1);
  assert.equal(provisions[0].profile_start_date, "2024-02-29");
});
