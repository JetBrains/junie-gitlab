# Junie GitLab Wrapper Cookbook

Real-world recipes for automating development workflows with Junie in GitLab. Each recipe solves a specific problem teams face daily.

## Prerequisites

Before using these recipes, complete the basic setup described in [README.md](./README.md#setup). You'll need:
- `JUNIE_API_KEY` and `GITLAB_TOKEN_FOR_JUNIE` configured in GitLab CI/CD variables
- `.gitlab-ci.yml` file with Junie stages added

---

## Initial Configuration

**Run this once per repository** to set up the webhook that enables Junie to respond to comments and events.

<details>
<summary>View junie-init job configuration</summary>

```yaml
# .gitlab-ci.yml
stages:
  - junie

junie-init:
  stage: junie
  image: registry.jetbrains.team/p/matterhorn/public/junie-gitlab-wrapper:latest
  script:
    - node /app/dist/cli.js init --verbose
  when: manual
  rules:
    - if: $CI_PIPELINE_SOURCE == "api"
      when: never
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - .gitlab-ci.yml
      when: manual
```

</details>

**How to run:**
1. Add this job to your `.gitlab-ci.yml`
2. Go to **CI/CD → Pipelines** in GitLab
3. Run the `junie-init` job manually
4. This creates a webhook in **Settings → Webhooks** that triggers pipelines when users mention `@junie`

**Important:** You only need to run this once. After that, Junie will automatically respond to mentions in comments.

---

## Basic Interactive Setup

**Use this as your starting point.** This workflow enables interactive Junie assistance across merge requests and issues - respond to `@junie` mentions anywhere in your repository.

**Prerequisites:** Make sure you've completed the [Initial Configuration](#initial-configuration) step above.

<details>
<summary>View complete workflow</summary>

```yaml
# .gitlab-ci.yml
stages:
  - junie

junie-run:
  stage: junie
  image: registry.jetbrains.team/p/matterhorn/public/junie-gitlab-wrapper:latest
  script:
    - node /app/dist/cli.js run --cleanup --verbose
  after_script:
    - mkdir -p junie-artifacts/working-directory
    - mkdir -p junie-artifacts/logs
    - mkdir -p junie-artifacts/sessions
    - cp -R /junieCache/. ./junie-artifacts/working-directory/ 2>/dev/null || true
    - cp -R ~/.junie/logs/. ./junie-artifacts/logs/ 2>/dev/null || true
    - cp -R ~/.junie/sessions/. ./junie-artifacts/sessions/ 2>/dev/null || true
  rules:
    # Only run for comment events that mention @junie (case insensitive)
    # This prevents creating pipelines for every comment
    - if: $CI_PIPELINE_SOURCE == "api" && $EVENT_KIND == "note" && $COMMENT_TEXT =~ /@junie(\s|$)/i
      when: always
    - when: never
  variables:
    JUNIE_BOT_TAGGING_PATTERN: "junie[-a-zA-Z0-9]*"
  artifacts:
    paths:
      - junie-artifacts/working-directory
      - junie-artifacts/logs
      - junie-artifacts/sessions
    expire_in: 1 week
    when: always
```

</details>

**How to use:**
1. Mention `@junie` in any comment on merge requests or issues:
   - `@junie implement email validation` on an issue → Junie creates an MR with the implementation
   - `@junie add error handling here` on an MR → Junie implements the changes
   - `@junie fix the bug in login flow` → Junie analyzes and proposes a solution

**Performance optimization:**
The `rules` section includes `$COMMENT_TEXT =~ /@junie(\s|$)/i` which checks if the comment contains "@junie" (case insensitive) BEFORE starting the pipeline. This prevents creating unnecessary pipelines for every comment in your repository - pipelines only start when Junie is properly mentioned with @.

**Features enabled:**
- Works on merge requests, issues, and comments
- Only triggers on explicit `@junie` mentions (with @)
- Filters comments at CI rules level (before pipeline starts)
---

## 1. Automated Code Review

**Problem:** MRs sit waiting for review, slowing down delivery. You want consistent feedback on code quality, security issues, and best practices before human reviewers look at the code.

**Solution:** Junie automatically reviews every MR, leaving structured feedback with actionable suggestions.

### Option A: Automatic Code Review on Every MR Update (Recommended)

Automatically reviews every MR when it's opened or updated:

<details>
<summary>View complete workflow</summary>

```yaml
# Add to your .gitlab-ci.yml
junie-auto-code-review:
  stage: junie
  image: registry.jetbrains.team/p/matterhorn/public/junie-gitlab-wrapper:latest
  script:
    - node /app/dist/cli.js run --prompt "code-review" --verbose
  after_script:
    - mkdir -p junie-artifacts/working-directory
    - mkdir -p junie-artifacts/logs
    - mkdir -p junie-artifacts/sessions
    - cp -R /junieCache/. ./junie-artifacts/working-directory/ 2>/dev/null || true
    - cp -R ~/.junie/logs/. ./junie-artifacts/logs/ 2>/dev/null || true
    - cp -R ~/.junie/sessions/. ./junie-artifacts/sessions/ 2>/dev/null || true
  rules:
    # Only run for MR events, skip on close or merge
    - if: $CI_PIPELINE_SOURCE == "api" && $EVENT_KIND == "merge_request" && $MR_EVENT_ACTION != "close" && $MR_EVENT_ACTION != "merge"
      when: always
    - when: never
  variables:
    USE_MCP: "true"
    JUNIE_MODEL: "claude-sonnet-4-5-20250929"  # Use Claude for MCP compatibility
  artifacts:
    paths:
      - junie-artifacts/working-directory
      - junie-artifacts/logs
      - junie-artifacts/sessions
    expire_in: 1 week
    when: always
```

</details>

**How it works:**
1. Triggers automatically when MR is opened or updated
2. Uses built-in `code-review` prompt for structured, opinionated review
3. Posts inline comments on specific lines using GitLab MCP tools (when `USE_MCP: "true"`)
4. Provides comprehensive review summary

**The built-in code review focuses on:**
- **Repository style adherence** - naming, formatting, package structure
- **Avoiding overcomplications** - premature abstractions, unnecessary indirection
- **Security, performance, error handling** - only for obviously applicable cases
- **Best practices** - following language and framework conventions

### Option B: On-Demand Code Review via Comments

Trigger code reviews on-demand by mentioning Junie in comments:

```
@junie code-review
```

**Requirements:**
- Complete [Initial Configuration](#initial-configuration) (run `junie-init` once)
- Make sure `junie-run` job is configured (see [Basic Interactive Setup](#basic-interactive-setup))
- **Important:** Add MCP support to your `junie-run` job for inline code comments:

```yaml
junie-run:
  # ... other configuration ...
  variables:
    JUNIE_BOT_TAGGING_PATTERN: "junie[-a-zA-Z0-9]*"
    USE_MCP: "true"  # Required for inline comments
    JUNIE_MODEL: "claude-sonnet-4-5-20250929"  # MCP requires Claude model
```

**How it works:**
1. Write `@junie code-review` in any MR comment
2. Junie analyzes the MR diff and provides a structured review
3. Posts inline comments on specific lines (when MCP is enabled)
4. Provides comprehensive review summary

---