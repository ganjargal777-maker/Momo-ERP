# MOMO ERP overnight state

## 2026-11-26 22:05 Asia/Ulaanbaatar

Branch `codex/overnight-erp-20261126`. Accepted implementation commit
`6791cc4008b858ca9ba78ebd9dbc51d1271a3674` on the published base
`82d60c7c4af50e5ceecd6455ea86963e5dbcbc82`. The readiness work was active
and unpublished at base selection. Its dirty files were left in its checkout.

### Employee invitations

The Edge handler supports an exact server-configured local setup callback,
keeps the existing hosted default, and rejects invalid bodies and impossible
employment dates before requesting email. Local Auth allows the setup URL.
See the invite-user README for the server setting.

| Scope | Result | Evidence |
| --- | --- | --- |
| Input and callback unit tests | 5 PASS | Node 24, `node --test test/invitation.test.mjs` |
| Handler regression with mocked SDK | 3 PASS | `node --test test/invite-user-handler.test.mjs`. Invalid payload/config sends no invite. Valid input uses the server callback. |
| Actual synthetic local Auth, PG15, PostgREST, Mailpit and Chromium | PASS | Isolated stack `momo-browser-dbfb4499-fd0`. Signed-in manager submitted the worktree handler under a Node Deno adapter. Impossible date returned 400. Valid invite returned 200, and the profile and role persisted. Browser followed the local email link, saved the password and opened ERP. A fresh Auth client signed in with that password. |
| Edge gateway and hosted acceptance | SKIPPED | Local handler ran under the adapter. No deployed Edge gateway or hosted account was tested. |

The local runner used six non-bootstrap migrations, a locally served SDK and a
stub for icons. It exited 0 after cleanup at approximately 14:04 UTC. The
one-off script and stack were removed. The two Node regression files above are
retained. No external mail or production writes.

### Other modules and next run

The active readiness checkout separately reports 13/13 local browser checks
passing for login, recovery and core ERP, and 58 PASS / 1 SKIPPED in its
focused PG15 suite. Those are its results. Its CRUD, dashboard and packaging
changes have yet to be integrated into this branch.

Next, check for the published readiness commit, integrate it on the overnight
branch, retain both sets of Auth redirect entries and rerun the changed-path
invite tests with the combined migrations. Recheck profile provisioning under
the readiness Auth trigger and tenant guards before claiming combined acceptance.

Production rollout remains BLOCKED pending verified backup/restore, rollback
and hosted acceptance. Phase 6C remains gated. Stop starting new changes at
2026-11-27 08:00 Asia/Ulaanbaatar.
