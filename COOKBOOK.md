# Junie GitLab Wrapper Cookbook

Real-world recipes for automating development workflows with Junie in GitLab. Each recipe solves a specific problem teams face daily.

## Prerequisites

Before using these recipes, complete the basic setup described in [README.md](./README.md#setup) in the *Setup* section. You'll need:
- `JUNIE_API_KEY` and `GITLAB_TOKEN_FOR_JUNIE` configured in GitLab CI/CD variables of the Junie Workspace project
- `.gitlab-ci.yml` file with Junie stages added to the Junie Workspace project's main branch
- A project initialization being done using the `junie-init` job
- If your task requires MCP support, make sure MCP support is enabled (an automatically generated webhook should contain `USE_MCP` variable set to `"true"`)

---


## Basic Usage

Mention `#junie` in any comment on merge requests or issues:
   - `#junie implement email validation` on an issue → Junie creates an MR with the implementation
   - `#junie add error handling here` on an MR → Junie implements the changes
   - `#junie fix the bug in login flow` → Junie analyzes and proposes a solution

---

## 1. Automated Code Review

**Problem:** MRs sit waiting for review, slowing down delivery. You want consistent feedback on code quality, security issues, and best practices before human reviewers look at the code.

**Solution:** Junie automatically reviews every MR, leaving structured feedback with actionable suggestions.

### Option A: On-Demand Code Review via Comments

Trigger code reviews on-demand by mentioning Junie in comments:

```
#junie code-review
```

**Requirements:**
- Complete [Initial Setup](./README.md#setup) (run `junie-init` once per project)
- **Important:** Make sure MCP support is enabled

**How it works:**
1. Write `#junie code-review` in any MR comment
2. Junie analyzes the MR diff and provides a structured review
3. Posts inline comments on specific lines (when MCP is enabled)
4. Provides comprehensive review summary


### Option B: Automatic Code Review on Every MR Update

> 🚧 This flow is still in progress


---

## 2. On-Demand CI Failure Analysis (fix-ci)

**Problem:** When pipelines fail, developers need to investigate logs, identify root causes, and figure out fixes. This is time-consuming and can block progress, especially for complex test failures or obscure build errors.

**Solution:** Junie analyzes failed pipelines on-demand, identifies the root cause, and implements fixes when you mention it in a comment.

Trigger CI failure analysis by mentioning Junie in MR comments:

```
#junie fix-ci
```

**Requirements:**
- Complete [Initial Setup](./README.md#setup) (run `junie-init` once per project)
- **Important:** Make sure MCP support is enabled

**How it works:**
1. Write `#junie fix-ci` in any MR comment where tests have failed
2. Junie finds the most recent **failed** pipeline for the MR (skips running/pending pipelines)
3. Uses GitLab MCP tools to:
   - Get all jobs from the pipeline
   - Retrieve logs from failed jobs
   - Get MR diff to correlate failures
4. Analyzes errors, determines root cause, and correlates with MR changes
5. Implements the fixes automatically (or provides analysis if uncertain)

---

## 3. Minor Fix Requests (minor-fix)

**Problem:** Reviewers often request small changes during code review - renaming variables, fixing typos, adjusting formatting, or making minor logic tweaks. These small tasks can be tedious and time-consuming.

**Solution:** Junie can make small, focused changes to merge requests on-demand when you mention it with specific instructions.

Trigger minor fixes by mentioning Junie in MR comments with your request:

```
#junie minor-fix rename userId to customerId
#junie minor-fix add input validation for email field
#junie minor-fix fix typo in error message
```

**Requirements:**
- Complete [Initial Setup](./README.md#setup) (run `junie-init` once per project)
- **Important:** Make sure MCP support is enabled

**How it works:**
1. Write `#junie minor-fix <your request>` in any MR comment
2. Junie retrieves the MR diff using GitLab MCP tools
3. Understands the context and identifies relevant files
4. Makes the requested changes to the codebase
5. The system automatically commits and pushes the changes

**Examples:**
- `#junie minor-fix rename the function processData to handleUserData`
- `#junie minor-fix add error handling for null values in the login method`
- `#junie minor-fix update the comment to explain the algorithm better`

**Guidelines:**
- Keep requests small and focused (one or two changes at a time)
- Be specific about what needs to change
- Junie will follow existing code style and conventions
- Changes are committed automatically - no manual git operations needed