# Plugin development guidelines

- This repository is the canonical source for dsh-codex-quota-widget. Develop here, not in archived Lab task copies or installed node_modules.
- Run `npm test` after changes; run `npm run test:browser` for UI changes. Browser fixtures and CI use synthetic data only.
- Build artifacts are generated. Keep source, tests, dependency lockfile, documentation and CHANGELOG in Git; do not commit lib/dist/node_modules/runtime or real account screenshots.
- Never commit or log access/refresh tokens, cookies, account identity, auth files, private conversations or production backups. The client receives only allowlisted quota summaries.
- Do not run real-account integration probes in CI. Production verification is a separate, explicitly authorized operation; its evidence belongs outside this source repository.
- Creating a remote, pushing, publishing to GitHub/npm or changing production requires explicit authorization. A local commit or tag is not a published release.
- Never stop/restart/signal the production DSH service. Report any necessary lifecycle operation and leave it to the human.
- Review the final diff and stage explicit paths only; do not use `git add .` or `git add -A`.
- Update package version and CHANGELOG together for functional changes. Do not retag an existing published version.
