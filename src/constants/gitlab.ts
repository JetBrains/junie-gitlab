// ============================================================================
// Actions and Triggers
// ============================================================================

export const CODE_REVIEW_ACTION = "code-review";

export const CODE_REVIEW_TRIGGER_PHRASE_REGEXP = new RegExp(CODE_REVIEW_ACTION, 'i');

export const FIX_CI_ACTION = "fix-ci";

export const FIX_CI_TRIGGER_PHRASE_REGEXP = new RegExp(FIX_CI_ACTION, 'i');

export const MINOR_FIX_ACTION = "minor-fix";

export const MINOR_FIX_TRIGGER_PHRASE_REGEXP = new RegExp(MINOR_FIX_ACTION, 'i');

// ============================================================================
// Templates and Messages
// ============================================================================

// Feedback messages
export const JUNIE_STARTED_MESSAGE = "Hey, it's Junie by JetBrains! I started processing your request";
export const JUNIE_FINISHED_PREFIX = "✅ Junie finished\n\n";
export const JUNIE_NO_CHANGES_MESSAGE = "Task completed. No changes were made.";
export const MR_LINK_PREFIX = "📝 Merge Request link: ";

// MR intro header
export const MR_INTRO_HEADER =
    "## Hey! This MR was made for you with Junie, the coding agent by JetBrains Early Access Preview\n\n" +
    "It's still learning, developing, and might make mistakes. Please make sure you review the changes before you accept them.\n" +
    "We'd love your feedback — join our Discord to share bugs, ideas: [here](https://jb.gg/junie/github).\n\n";

// System instructions
export const GIT_OPERATIONS_NOTE = "\n\nIMPORTANT: Do NOT commit or push changes. The system will handle all git operations (staging, committing, and pushing) automatically.";

// MCP integration
const SUMMARY_POSTING_NOTE = "\n\nIMPORTANT: Do NOT post your summary as a comment. The summary will be posted automatically by the system.";
const THREAD_REPLY_NOTE = "\n\nIMPORTANT: If you are responding to a question in an existing discussion thread (user tagged you in <user_instruction> in Discussion #...), DO NOT use MCP tools to create new comments - your response will be automatically posted as a reply in that thread.";

/**
 * Generates MCP note with project/issue/MR identifiers
 */
export function generateMcpNote(params: { projectId: number; issueId?: number; mergeRequestId?: number; commentId?: number }): string {
    let note = "\nContent for MCP usage (if needed):";
    note += `\ncurrent project ID: ${params.projectId}`;

    if (params.issueId !== undefined) {
        note += `\ncurrent issue ID: ${params.issueId}`;
    }

    if (params.mergeRequestId !== undefined) {
        note += `\ncurrent merge request ID: ${params.mergeRequestId}`;
    }

    if (params.commentId !== undefined) {
        note += `\ncurrent comment ID: ${params.commentId}`;
    }

    note += SUMMARY_POSTING_NOTE;

    // Add thread reply note for MR comments (discussions)
    if (params.mergeRequestId && params.commentId) {
        note += THREAD_REPLY_NOTE;
    }

    return note;
}

/**
 * Creates a minor-fix prompt for making small changes to a merge request
 * @param projectId - The GitLab project ID
 * @param mergeRequestId - The merge request IID
 * @param userRequest - Optional user request (text after "minor-fix")
 * @returns The formatted minor-fix prompt
 */
export function createMinorFixPrompt(projectId: number, mergeRequestId: number, userRequest?: string): string {
    const userRequestSection = userRequest
        ? `\n### User Request\nThe user has specifically requested: "${userRequest}"\nFocus on addressing this request while following all the guidelines below.\n`
        : '';
    const gatherInfoUserRequestNote = userRequest
        ? `\n   - Focus specifically on understanding what "${userRequest}" means in the context of this MR. Identify the relevant files, functions, or code sections that relate to this request.`
        : '';

    return `
Your task is to make a minor fix to this Merge Request based on the user's request.
${userRequestSection}
### Steps to follow
1. Gather Information
   - Use 'gitlab.get_merge_request_diffs' tool with projectId=${projectId} and mergeRequestIid=${mergeRequestId} to get the MR diff
   - Understand the context of the changes and what the MR is trying to accomplish.${gatherInfoUserRequestNote}

2. Implement the Fix
   - Make the requested changes to the codebase.
   - Keep changes minimal and focused on the specific request.
   - Follow the existing code style and conventions in the repository.
   - Do NOT make unrelated changes or "improvements" beyond what was requested.

3. Validation
   - Ensure your changes compile/build successfully.
   - Run relevant tests if applicable.
   - Verify the fix addresses the user's request.

### Guidelines
- **Scope**: Only make changes directly related to the user's request. Do not refactor or "improve" unrelated code.
- **Style**: Match the existing code style, naming conventions, and patterns in the repository.
- **Safety**: Be conservative with changes. When in doubt, make the smaller change.
- **Testing**: If you modify logic, ensure existing tests still pass. Add tests only if explicitly requested.

### Output
Submit a brief summary of the changes you made and why they address the user's request.
`;
}

/**
 * Creates a fix-ci prompt for analyzing failed GitLab CI/CD pipelines
 * @param projectId - The GitLab project ID
 * @param pipelineId - The pipeline ID that failed
 * @param mergeRequestId - Optional merge request IID if this is an MR pipeline
 * @returns The formatted fix-ci prompt
 */
export function createFixCIFailuresPrompt(projectId: number, pipelineId: number, mergeRequestId?: number): string {
    return `
Your task is to analyze CI failures and fix them. Follow these steps:

### Steps to follow
1. Gather Information
   - Use 'gitlab.list_pipeline_jobs' tool with projectId=${projectId} and pipelineId=${pipelineId} to get all jobs
   - Identify which jobs have failed (status: 'failed')
   - For each failed job, use 'gitlab.get_pipeline_job_output' tool with projectId=${projectId} and jobId to retrieve the job logs
   ${mergeRequestId ? `- Use 'gitlab.get_merge_request_diffs' tool with projectId=${projectId} and mergeRequestIid=${mergeRequestId} to get the MR diff` : ''}

2. If NO failed jobs were found:
   - Submit ONLY the following message:
   ---
   ## CI Status

   No failed checks found for this pipeline. All CI checks have passed or are still running.
   ---

3. If failed jobs WERE found, analyze each failure:
   - Open and explore relevant source files to understand the context
   - Identify the failing step and error message.
   - Determine the root cause (test failure, build error, linting issue, timeout, flaky test, etc.)
   ${mergeRequestId ? '- Correlate the error with changes in the MR diff.' : '- Determine if the failure is related to recent changes or a pre-existing issue'}
   ${mergeRequestId ? '- Determine if the failure is related to the MR diff or a pre-existing issue' : ''}

4. Implement the Fix
   - Make the necessary changes to fix the CI failures.
   - Keep changes minimal and focused on fixing the specific failures.
   - Follow the existing code style and conventions in the repository.
   - Do NOT make unrelated changes or "improvements" beyond what is needed to fix the CI.

5. Validation
   - Ensure your changes compile/build successfully.
   - Run relevant tests if applicable.
   - Verify the fix addresses the CI failure. If you are unsure, revert any change made in this session.

### Guidelines
- **Scope**: Only make changes directly related to fixing the CI failures. Do not refactor or "improve" unrelated code.
- **Style**: Match the existing code style, naming conventions, and patterns in the repository.
- **Safety**: Be conservative with changes. When in doubt, make the smaller change.
- **Testing**: If you modify logic, ensure existing tests still pass. Add tests only if explicitly needed.
- **Certainty**: Do NOT apply any changes unless you are 100% certain the CI checks will pass after your fix. If you are unsure, do not make changes — instead, submit an analysis explaining the issue and your uncertainty.

### Output
- DO NOT post inline comments.
- When you have fixed CI failures, submit your response using EXACTLY this format:
    ---
    ## CI Fix Applied

    **Fixed Job:** [name of the CI job that was failing]
    **Error Type:** [test failure / build error / lint error / timeout / other]

    ### Root Cause
    [1-3 sentences explaining why this failed]

    ### Changes Made
    - \`path/to/file.ts\`: [brief description of what was changed]
    - [additional files if applicable]

    ### Verification
    [Confirm that build passes and tests succeed, or describe what was verified]
    ---
- If you did NOT make changes due to uncertainty or errors, submit your response using this format instead:
    ---
    ## CI Analysis (No Changes Made)

    **Failed Job:** [name of the CI job that was failing]
    **Error Type:** [test failure / build error / lint error / timeout / other]

    ### Root Cause
    [1-3 sentences explaining why this failed]

    ### Why No Fix Was Applied
    [Explain your uncertainty and why you chose not to make changes]

    ### Suggested Investigation
    [What the developer should look into to resolve this]
    ---
`;
}

/**
 * Creates a code review prompt for GitLab merge requests
 * @param mergeRequestId - The merge request IID to review
 * @returns The formatted code review prompt
 */
export function createCodeReviewPrompt(mergeRequestId: number): string {
    return `
Your task is to review Merge Request #${mergeRequestId}:

1. Use the 'gitlab.get_merge_request_diffs' MCP tool with mergeRequestIid=${mergeRequestId} to get the diff.
2. Review this diff according to the criteria below.
3. For each specific finding, use the 'gitlab.create_merge_request_thread' MCP tool (if available) to provide feedback directly on the code with suggestions.
4. Once all findings are posted (or if the tool is unavailable), submit with your review as a bullet point list.

Additional instructions:
1. Review ONLY the changed lines against the Core Review Areas below, prioritizing repository style/guidelines adherence and avoiding overcomplication.
2. You may open files or search the project to understand context. Do NOT run tests, build, or make any modifications.
3. Do NOT create any new files. Do NOT commit or push any changes. This is a read-only code review and you don't have write access to the repository.

### Core Review Areas

1. **Adherence with this repository style and guidelines**
   - Naming, formatting, and package structure consistency with existing code and modules.
   - Reuse of existing utilities/patterns; avoiding introduction of new dependencies.

2. **Avoiding overcomplications**
   - Avoid new abstractions, frameworks, premature generalization, or unnecessarily complicated solutions.
   - Avoid touching of unrelated files.
   - Avoid unnecessary indirection (wrappers, flags, configuration) and ensure straightforward control flow.
   - Do not allow duplicate logic.

### If obviously applicable to the CHANGED lines only
- Security: newly introduced unsafe input handling, command execution, or data exposure.
- Performance: unnecessary allocations/loops/heavy work on UI thread introduced by the change.
- Error handling: swallowing exceptions or deviating from existing error-handling patterns.

### Output Format
- If the 'gitlab.create_merge_request_thread' MCP tool is available, use it for each specific finding with inline comments on code lines.
- **To create inline comments on specific lines, use the \`position\` parameter**:
    - \`position.position_type\`: Set to "text"
    - \`position.base_sha\`: Base commit SHA (from diff metadata)
    - \`position.head_sha\`: Head commit SHA (from diff metadata)
    - \`position.start_sha\`: Start commit SHA (usually same as base_sha)
    - \`position.new_path\`: Path to the file (e.g., "src/file.ts")
    - \`position.old_path\`: Path to the file (usually same as new_path)
    - \`position.new_line\`: Line number for added/changed lines (green in diff)
    - \`position.old_line\`: Line number for removed lines (red in diff)
    - Note: For unchanged lines, include both new_line and old_line
- \`commentBody\`: Your explanation. Use native GitLab suggestions syntax for code changes.
- Once all inline comments are posted, also submit your overall review as a bullet point list ONLY, with each comment following the format: - \`File.ts:Line: Comment\`. Do NOT include any summary, introduction, conclusion, notes, or any other text—ONLY the bullet points.
- Comment ONLY on the actual modifications in this diff. For lines that are modified (removed then re-added), comment only on what changed, not the unchanged parts of the line. Never comment on pre-existing code.
- Ensure that your suggestions are not already implemented, or equivalent to existing code.
- If you start to suggest a change and then realize it's already implemented or is not needed, skip the comment.
- Keep it concise (15–25 words per comment). No praise, questions, or speculation; omit low-impact nits.
- If unsure whether a comment applies, omit it. If no feedback is warranted, submit \`LGTM\` only .
- Only make comments of medium or high impact and only if you have high confidence in your findings.
- For small changes, max 3 comments; medium 6–8; large 8–12.

Merge Request ID: ${mergeRequestId}
`;
}
