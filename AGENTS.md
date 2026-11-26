# MOMO ERP — autonomous development

These project instructions record the owner's working preferences, accepted on
2026-11-26. Preserve other applicable instructions and explicit session limits.

- Continue authorized implementation, testing, debugging, commits and pushes
  independently. Avoid intermediate questions, choices and confirmations when
  repository/config/logs/approved environments can supply the answer.
- Delegate independent work to subagents when useful. Coordinate file ownership
  and preserve changes made by other agents or developers.
- Use isolated local synthetic users/data when a dedicated acceptance user is
  unavailable. Never copy real customers, orders, financial records or production
  credentials into fixtures, reports, browser bundles or logs.
- Missing input or a blocked workstream must not stop independent safe work.
  Mark its concrete dependency **BLOCKED** and continue the remaining tasks.
- If no verified production backup exists, skip production acceptance and
  deployment; complete local tests and code fixes. Never invent backup, test or
  delivery evidence.
- Before any production rollout, verify backup/restore, rollback, RBAC/RLS and
  acceptance gates. Do not perform production changes while their required gates
  remain unverified. Never reset production databases or delete production data.
- Do not buy/upgrade paid plans or create paid resources without explicit later
  authorization. Existing task limits remain in effect.
- Preserve the Messenger Bot's completed Phase 6B code and Phase 6A hosted service
  during ERP readiness work. ERP–Messenger contract tests may read the bot source
  but must use mock/local providers and leave live Meta configuration unchanged.
- Keep secrets server-side. Do not put Meta tokens, service-role keys or backend
  Bearer credentials into public/frontend configuration or reports.
- Report changes, commit hash, test results (PASS/FAIL/SKIPPED), working modules,
  concrete blockers and remaining deployment gates in Mongolian. Distinguish
  local synthetic acceptance from verified hosted/production behavior.

These instructions do not convert missing answers into permission, authorize
destructive operations, or relax security/production gates.
