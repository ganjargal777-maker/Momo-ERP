import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inviteRedirectUrl, isValidStartDate } from "../supabase/functions/invite-user/invitation.mjs";

test("invitations default to the existing hosted setup page", () => {
  assert.equal(inviteRedirectUrl(), "https://erp.momoshop.mn/?setup=1");
});

test("the local setup callback is allowed by both the function and Auth", async () => {
  const callback = "http://localhost:4173/?setup=1";
  assert.equal(inviteRedirectUrl(callback), callback);
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const redirects = config.match(/additional_redirect_urls\s*=\s*(\[[^\]]*\])/u);
  assert.ok(JSON.parse(redirects[1]).includes(callback));
});

test("invalid settings fail closed", () => {
  for (const url of ["", "https://example.invalid/?setup=1", "http://localhost:4173/", "http://localhost:4173/?setup=1&next=elsewhere"]) {
    assert.throws(() => inviteRedirectUrl(url), /Unsupported invitation callback/);
  }
});

test("start date accepts omitted dates and real calendar dates including leap days", () => {
  for (const date of [null, undefined, "", "2024-02-29", "2000-02-29", "2026-11-26"]) {
    assert.equal(isValidStartDate(date), true);
  }
});

test("start date rejects invalid dates and non-string fields before sending mail", () => {
  for (const date of ["2026-02-29", "1900-02-29", "2026-04-31", "0000-01-01", "2026-00-01", "2026-11-00", "2026-1-1", 0, false, {}, ["2026-01-01"]]) {
    assert.equal(isValidStartDate(date), false);
  }
});
