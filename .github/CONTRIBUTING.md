# Contributing to HomeOps

HomeOps is local-first, source-compliant, and human-in-the-loop. Keep changes
small, deterministic, and auditable.

Before opening a pull request:

1. Run `npm test`.
2. Run `npm run compatibility` and `npm run plugin:check` when changing modes,
   wrappers, regions, or plugins.
3. Add offline fixtures and tests for deterministic behavior.
4. Keep `README.md`, `DATA_CONTRACT.md`, and `docs/ROADMAP.md` synchronized.
5. Do not commit private configuration, credentials, personal data, or raw
   portal pages.

Provider changes must document source terms, robots/access limitations, request
bounds, caching, and any required user acknowledgement. Do not bypass login,
CAPTCHA, anti-bot controls, rate limits, or access restrictions.
