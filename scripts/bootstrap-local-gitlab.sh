#!/usr/bin/env bash
# Bootstrap a local GitLab + Runner for integration testing.
#
# Idempotent: safe to re-run against an already-bootstrapped instance.
# Writes the discovered tokens / IDs to .env.local-gitlab in repo root for
# consumption by `npm run test:integration:local`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
ENV_FILE="${ENV_FILE:-.env.local-gitlab}"
WORKSPACE_PROJECT_NAME="${WORKSPACE_PROJECT_NAME:-junie-workspace}"
WORKSPACE_PROJECT_DEFAULT_BRANCH="main"
GITLAB_HOST_URL="${GITLAB_HOST_URL:-http://localhost:8080}"
GITLAB_INTERNAL_URL="${GITLAB_INTERNAL_URL:-http://gitlab}"
RUNNER_DESCRIPTION="${RUNNER_DESCRIPTION:-junie-test-runner}"
WRAPPER_IMAGE="${WRAPPER_IMAGE:-junie-gitlab-wrapper:test}"

log()  { printf '[bootstrap] %s\n' "$*" >&2; }
fail() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

###############################################################################
# 1. Wait for GitLab readiness.
#    /-/readiness needs a monitoring token; /api/v4/version is auth-protected
#    but reachable as soon as Rails is up — 401 means "alive", connection
#    refused / 502 / 503 means "still booting".
###############################################################################
log "Waiting for GitLab API to come up at ${GITLAB_HOST_URL}/api/v4/version ..."
deadline=$(( SECONDS + 900 ))
while true; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${GITLAB_HOST_URL}/api/v4/version" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" || "$code" == "401" ]]; then
        break
    fi
    if (( SECONDS >= deadline )); then
        fail "GitLab API did not come up within 15 minutes (last HTTP code: ${code})"
    fi
    sleep 5
done
log "GitLab API is up (HTTP ${code})."

###############################################################################
# 2. Mint a root personal access token via gitlab-rails runner.
#    Idempotent: looks up an existing token by name first.
#    Also self-heals the case where initial seed didn't create the `root`
#    user (a race seen on first boot under Rosetta emulation on Apple
#    Silicon — Healthy flips before users table is seeded).
###############################################################################
PAT_NAME="junie-test-bootstrap"
ROOT_PASSWORD="${LOCAL_GITLAB_ROOT_PASSWORD:-JunieTestRoot1!}"
log "Provisioning root PAT '${PAT_NAME}' ..."

ROOT_TOKEN="$(dc exec -T gitlab gitlab-rails runner - <<'RUBY'
require "securerandom"

user = User.find_by_username("root")
unless user
  user = User.new(
    username: "root",
    email: "admin@junie-test.local",
    name: "Administrator",
    password: SecureRandom.urlsafe_base64(40),
    admin: true
  )
  user.skip_confirmation!
  user.assign_attributes(password_automatically_set: true) if user.respond_to?(:password_automatically_set=)
  if defined?(Organizations::Organization) && user.respond_to?(:assign_personal_namespace)
    org = Organizations::Organization.default_organization || Organizations::Organization.first
    user.assign_personal_namespace(org) if org
  end
  user.save(validate: false)
  warn "created missing root user id=#{user.id}"
end

pat_name = "junie-test-bootstrap"
PersonalAccessToken.where(user: user, name: pat_name).find_each(&:revoke!)
# NOTE: do NOT include :sudo scope. GitLab treats tokens with `sudo` as
# requiring an explicit `Sudo:` header; without it, every Bearer-auth
# request (gitbeaker uses Authorization: Bearer by default) is rejected
# as `invalid_token`. The :api scope alone is enough for root.
token = user.personal_access_tokens.create!(
  scopes: [:api, :read_repository, :write_repository],
  name: pat_name,
  expires_at: 30.days.from_now
)
puts token.token
RUBY
)"
ROOT_TOKEN="$(printf '%s' "$ROOT_TOKEN" | tr -d '\r' | tail -n 1)"
[[ -n "$ROOT_TOKEN" ]] || fail "Failed to mint root PAT"
log "Minted root PAT (length=${#ROOT_TOKEN})."

api() {
    local method="$1"; shift
    local path="$1"; shift
    curl -fsS -X "$method" \
         -H "PRIVATE-TOKEN: $ROOT_TOKEN" \
         -H "Content-Type: application/json" \
         "${GITLAB_HOST_URL}/api/v4${path}" "$@"
}

###############################################################################
# 3. Application settings: allow webhooks to local network + relax import
#    limits so creating projects with README seeding works smoothly.
###############################################################################
log "Updating application settings ..."
api PUT /application/settings --data '{
    "allow_local_requests_from_web_hooks_and_services": true,
    "outbound_local_requests_whitelist": ["gitlab"]
}' >/dev/null

###############################################################################
# 4. Enable custom webhook template feature flag (GitLab < 18.9).
###############################################################################
log "Enabling custom_webhook_template_serialization feature flag ..."
dc exec -T gitlab gitlab-rails runner \
    "Feature.enable(:custom_webhook_template_serialization)" >/dev/null || \
    log "Feature flag could not be set (probably already enabled on this version) — continuing."

###############################################################################
# 4b. Ensure default work item types are seeded.
#     Same Rosetta first-boot race as the missing root user: if the seed
#     step didn't run, Issues create returns 500 with
#     WorkItems::Type::DEFAULT_TYPES_NOT_SEEDED.
###############################################################################
log "Seeding default work item types if needed ..."
dc exec -T gitlab gitlab-rails runner - <<'RUBY' || log "Work item types seed reported an error — continuing."
if defined?(Gitlab::DatabaseImporters::WorkItems::BaseTypeImporter)
  before = WorkItems::Type.count
  Gitlab::DatabaseImporters::WorkItems::BaseTypeImporter.upsert_types
  warn "work item types: #{before} -> #{WorkItems::Type.count}"
else
  warn "BaseTypeImporter not defined on this GitLab version"
end
RUBY

###############################################################################
# 5. Register the GitLab Runner.
#    Uses the modern /api/v4/user/runners endpoint (instance-type).
#    Idempotent: skips re-registration if config.toml already has a token.
###############################################################################
RUNNER_CONFIG_EXISTS="$(dc exec -T gitlab-runner sh -c '[ -s /etc/gitlab-runner/config.toml ] && grep -q "^\\[\\[runners\\]\\]" /etc/gitlab-runner/config.toml && echo yes || echo no' | tr -d '\r')"

if [[ "$RUNNER_CONFIG_EXISTS" == "yes" ]]; then
    log "Runner already registered — skipping registration."
else
    log "Creating runner via /api/v4/user/runners ..."
    RUNNER_RESPONSE="$(api POST /user/runners --data "{
        \"runner_type\": \"instance_type\",
        \"description\": \"${RUNNER_DESCRIPTION}\",
        \"run_untagged\": true,
        \"locked\": false
    }")"
    RUNNER_AUTH_TOKEN="$(printf '%s' "$RUNNER_RESPONSE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
    [[ -n "$RUNNER_AUTH_TOKEN" ]] || fail "Failed to create runner: $RUNNER_RESPONSE"

    log "Registering runner inside container ..."
    dc exec -T gitlab-runner gitlab-runner register \
        --non-interactive \
        --url "${GITLAB_INTERNAL_URL}" \
        --token "${RUNNER_AUTH_TOKEN}" \
        --executor docker \
        --docker-image alpine:latest \
        --docker-network-mode junie-test-net \
        --docker-pull-policy if-not-present \
        --docker-privileged=false \
        --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
        --description "${RUNNER_DESCRIPTION}" >/dev/null

    # Patch config.toml:
    #   - pin pull_policy so a locally-built wrapper image isn't re-pulled
    #   - allow >1 concurrent job so parallel test files don't serialize
    dc exec -T gitlab-runner sh -c '
        sed -i "s|pull_policy = .*|pull_policy = \"if-not-present\"|" /etc/gitlab-runner/config.toml
        sed -i "s|^concurrent = .*|concurrent = 4|"                /etc/gitlab-runner/config.toml
    ' >/dev/null || true
    dc restart gitlab-runner >/dev/null
    log "Runner registered."
fi

# registry.jetbrains.team/p/matterhorn/public/* is anonymous-pullable
# via the standard Docker registry bearer-token flow — no login needed.

###############################################################################
# 6. Create / locate the Junie Workspace project on the same GitLab.
###############################################################################
log "Locating workspace project '${WORKSPACE_PROJECT_NAME}' ..."
WORKSPACE_PROJECT_ID="$(api GET "/projects?search=${WORKSPACE_PROJECT_NAME}&owned=true" | sed -n "s/.*\"id\":\\([0-9]*\\)[^}]*\"path\":\"${WORKSPACE_PROJECT_NAME}\".*/\\1/p" | head -n1)"

if [[ -z "$WORKSPACE_PROJECT_ID" ]]; then
    log "Creating workspace project ..."
    WORKSPACE_RESPONSE="$(api POST /projects --data "{
        \"name\": \"${WORKSPACE_PROJECT_NAME}\",
        \"path\": \"${WORKSPACE_PROJECT_NAME}\",
        \"visibility\": \"private\",
        \"initialize_with_readme\": true,
        \"default_branch\": \"${WORKSPACE_PROJECT_DEFAULT_BRANCH}\"
    }")"
    WORKSPACE_PROJECT_ID="$(printf '%s' "$WORKSPACE_RESPONSE" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -n1)"
    [[ -n "$WORKSPACE_PROJECT_ID" ]] || fail "Failed to create workspace project: $WORKSPACE_RESPONSE"

else
    log "Workspace project already exists with ID ${WORKSPACE_PROJECT_ID}."
fi

# (Re)commit .gitlab-ci.yml in the workspace project on every bootstrap, so
# changes to script-sample.yaml or the sed patches below take effect on
# already-bootstrapped instances without needing a full teardown.
#
# Two patches applied via sed before committing the CI file:
#   1. Rewrite the image reference so the pipeline uses the locally-built
#      wrapper (`${WRAPPER_IMAGE}`) instead of the published `:latest`.
#      Runner has pull_policy=if-not-present.
#   2. Drop the job-level `GITLAB_TOKEN_FOR_JUNIE: "$INPUT_TOKEN"`
#      override. On GitLab 17.5 the `$[[ inputs.X ]]` interpolation
#      inside `variables.*.value` is not honored, so $INPUT_TOKEN is
#      empty and the override clobbers the webhook-provided token. We
#      deliver the token directly via webhook URL variable
#      `variables[GITLAB_TOKEN_FOR_JUNIE]={project_token}` (see
#      initializer.ts), so the override is unnecessary.
log "Committing .gitlab-ci.yml (from script-sample.yaml) to workspace project ${WORKSPACE_PROJECT_ID} ..."
CI_CONTENT_B64="$(sed \
    -e "s|registry.jetbrains.team/p/matterhorn/public/junie-gitlab-wrapper:latest|${WRAPPER_IMAGE}|g" \
    -e '/GITLAB_TOKEN_FOR_JUNIE:[[:space:]]*"\$INPUT_TOKEN"/d' \
    script-sample.yaml | base64 | tr -d '\n')"
ci_payload="{
    \"branch\": \"${WORKSPACE_PROJECT_DEFAULT_BRANCH}\",
    \"content\": \"${CI_CONTENT_B64}\",
    \"encoding\": \"base64\",
    \"commit_message\": \"Update Junie pipeline definition\"
}"
if api PUT "/projects/${WORKSPACE_PROJECT_ID}/repository/files/.gitlab-ci.yml" --data "$ci_payload" >/dev/null 2>&1; then
    log "Updated .gitlab-ci.yml in workspace project."
else
    api POST "/projects/${WORKSPACE_PROJECT_ID}/repository/files/.gitlab-ci.yml" --data "$ci_payload" >/dev/null
    log "Created .gitlab-ci.yml in workspace project."
fi

###############################################################################
# 7. Push Junie / BYOK secrets as masked CI/CD variables on the workspace.
#    `upsert` semantics: PUT-then-POST.
###############################################################################
upsert_workspace_var() {
    local key="$1" value="$2"
    [[ -n "$value" ]] || return 0
    local payload
    payload="$(printf '{"key":"%s","value":%s,"variable_type":"env_var","protected":false,"masked":true}' \
              "$key" "$(printf '%s' "$value" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
    if api PUT "/projects/${WORKSPACE_PROJECT_ID}/variables/${key}" --data "$payload" >/dev/null 2>&1; then
        log "Updated workspace CI/CD var ${key}"
    else
        api POST "/projects/${WORKSPACE_PROJECT_ID}/variables" --data "$payload" >/dev/null
        log "Created workspace CI/CD var ${key}"
    fi
}

upsert_workspace_var JUNIE_API_KEY      "${JUNIE_API_KEY:-}"
upsert_workspace_var OPENAI_API_KEY     "${OPENAI_API_KEY:-}"
upsert_workspace_var ANTHROPIC_API_KEY  "${ANTHROPIC_API_KEY:-}"
upsert_workspace_var GROK_API_KEY       "${GROK_API_KEY:-}"
upsert_workspace_var OPENROUTER_API_KEY "${OPENROUTER_API_KEY:-}"
upsert_workspace_var GOOGLE_API_KEY     "${GOOGLE_API_KEY:-}"

# GITLAB_TOKEN_FOR_JUNIE — README recommends restricting this to the `init`
# environment, but in our local flow:
#   - GitLab 17.5 doesn't honor `$[[ inputs.X ]]` interpolation in
#     `variables.*.value`, so `$INPUT_TOKEN` is empty.
#   - Custom `variables[KEY]=val` in the webhook URL is rejected by the
#     trigger pipeline API for non-`raw` variables.
# So neither prod-style path delivers a usable per-project token.
#
# For local tests we install the root PAT globally (scope `*`) and let the
# wrapper use it. The root PAT has access to every test project the fixture
# creates. This is intentionally weaker than prod (which uses per-project
# tokens) but is fine on a localhost-only GitLab.
log "Setting GITLAB_TOKEN_FOR_JUNIE (scope: *) on workspace project ..."
token_var_payload="$(printf '{"key":"GITLAB_TOKEN_FOR_JUNIE","value":%s,"variable_type":"env_var","protected":false,"masked":false,"environment_scope":"*"}' \
    "$(printf '%s' "$ROOT_TOKEN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
if api PUT "/projects/${WORKSPACE_PROJECT_ID}/variables/GITLAB_TOKEN_FOR_JUNIE?filter%5Benvironment_scope%5D=%2A" --data "$token_var_payload" >/dev/null 2>&1; then
    log "Updated GITLAB_TOKEN_FOR_JUNIE"
else
    api POST "/projects/${WORKSPACE_PROJECT_ID}/variables" --data "$token_var_payload" >/dev/null
    log "Created GITLAB_TOKEN_FOR_JUNIE"
fi
# Clean up the old init-scoped variant if it exists (from earlier bootstrap runs).
api DELETE "/projects/${WORKSPACE_PROJECT_ID}/variables/GITLAB_TOKEN_FOR_JUNIE?filter%5Benvironment_scope%5D=init" >/dev/null 2>&1 || true

###############################################################################
# 8. Persist discovered values for the test runner.
###############################################################################
log "Writing ${ENV_FILE} ..."
cat > "${ENV_FILE}" <<EOF
# Generated by scripts/bootstrap-local-gitlab.sh — do not edit by hand.
TEST_MODE=local
TEST_GITLAB_HOST=${GITLAB_HOST_URL}
TEST_GITLAB_INTERNAL_HOST=${GITLAB_INTERNAL_URL}
LOCAL_GITLAB_ROOT_TOKEN=${ROOT_TOKEN}
JUNIE_WORKSPACE_PROJECT_ID=${WORKSPACE_PROJECT_ID}
JUNIE_WORKSPACE_DEFAULT_BRANCH=${WORKSPACE_PROJECT_DEFAULT_BRANCH}
EOF

log "GitLab ready, workspace project = ${WORKSPACE_PROJECT_ID}"
log "Tokens written to ${ENV_FILE}"
