# Tests

Two kinds of tests live here:

- **`unit/`** — plain unit tests, no GitLab required.
- **`integration/`** — end-to-end tests that drive a real GitLab instance via webhooks and verify Junie behavior (creates MRs, posts comments, etc).

## Quick start: integration tests locally

Prerequisites:
- Docker Desktop running (Apple Silicon works — GitLab runs under amd64 emulation).
- ~6 GB free RAM (GitLab is heavy).
- Junie API key exported in the shell:
  ```bash
  export JUNIE_API_KEY=perm-...
  ```
  (or any BYOK alternative: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)

Bootstrap the local GitLab + build the wrapper image (one-time, plus on each Junie code change):

```bash
npm run gitlab:up
```

This builds `junie-gitlab-wrapper:test`, starts the `docker-compose.test.yml` stack (GitLab + runner), mints a root PAT, creates the `junie-workspace` project, registers the runner, pushes Junie API keys as CI/CD variables, and writes everything to `.env.local-gitlab` (gitignored). Idempotent — re-run any time.

Run the tests:

```bash
npm run test:integration
```

Tear everything down when done:

```bash
npm run gitlab:down
```

## What happens during a test

Each test gets its own fresh GitLab project via the `LocalGitLabFixture` (in `tests/fixtures/`):

1. Creates a new private project (`test-issue-comment-<uuid>` etc).
2. Commits `script-sample.yaml` as `.gitlab-ci.yml` (image swapped to the locally-built wrapper).
3. Copies all CI/CD variables from `junie-workspace` (API keys, `GITLAB_TOKEN_FOR_JUNIE`).
4. Calls `initialize()` to set up webhook + project access token + trigger token, all pointing at the project itself (each test project is its own self-hosted Junie).
5. The test performs whatever actions it defines (e.g. creates an MR and writes a comment) and polls GitLab API for the expected result.
6. After the test: pipeline logs and artifacts are downloaded into `test-results/<project-slug>/` (plus `runner.log`). If the test passed — project is deleted. If it failed — project is kept for manual inspection.

## URLs you'll see in logs

GitLab is reached by two different URLs depending on **who** is making the request:

- **`http://localhost:8080`** — your terminal / test process on the host. Click these in test logs.
- **`http://gitlab`** — internal docker-network DNS. GitLab itself uses this for webhooks; the runner uses it to fetch the repo. Not reachable from your browser.

Login to the UI: `root` / the password from `docker-compose.test.yml` (or whatever you reset it to via `gitlab-rails runner`).

## Failed tests

If a test fails, the fixture **keeps** the GitLab project. The log prints:

```
Test failed — keeping project #N (http://localhost:8080/root/test-...) for investigation.
```

Click the URL to inspect MRs, issues, comments, pipelines.

`test-results/` also contains every pipeline job's log (`job.log`), its artifacts (`artifacts.zip`, including Junie's working dir / logs / sessions), and the runner container's stdout (`runner.log`).

## Env vars

Set in `.env.local-gitlab` by the bootstrap script (don't edit by hand):

| Variable | Purpose |
|---|---|
| `LOCAL_GITLAB_ROOT_TOKEN` | Root PAT, used by tests to drive GitLab API |
| `TEST_GITLAB_HOST` | Default `http://localhost:8080` |
| `TEST_GITLAB_INTERNAL_HOST` | Default `http://gitlab` |
| `JUNIE_WORKSPACE_PROJECT_ID` | Workspace project id (source of CI variables) |
| `JUNIE_WORKSPACE_DEFAULT_BRANCH` | Default branch, usually `main` |

Optional override:
- `WRAPPER_IMAGE` — override the wrapper image tag injected into each test project's `.gitlab-ci.yml`. Defaults to `junie-gitlab-wrapper:test`.