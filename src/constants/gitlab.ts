// ============================================================================
// Actions and Triggers
// ============================================================================

export const CODE_REVIEW_ACTION = "code-review";

export const CODE_REVIEW_TRIGGER_PHRASE_REGEXP = new RegExp(CODE_REVIEW_ACTION, 'i');

export const FIX_CI_ACTION = "fix-ci";

export const FIX_CI_TRIGGER_PHRASE_REGEXP = new RegExp(FIX_CI_ACTION, 'i');

export const MINOR_FIX_ACTION = "minor-fix";

export const MINOR_FIX_TRIGGER_PHRASE_REGEXP = new RegExp(MINOR_FIX_ACTION, 'i');

export const PROJECT_ACCESS_TOKEN_NAME = "Junie by JetBrains";

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
    const issueDescriptionSection = `<issue_description>`;
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
   - Review the MR title, description, comments, and commits in the ${issueDescriptionSection} section below. This is important to ensure we align with the MR intent and decisions being made.
   - Use 'gitlab.get_merge_request_diffs' tool with projectId=${projectId} and mergeRequestIid=${mergeRequestId} to get the MR diff
   - Understand the context of the changes and what the MR is trying to accomplish.${gatherInfoUserRequestNote}

2. Implement the Fix
   - Make the requested changes to the codebase.
   - Keep changes minimal and focused on the specific request.
   - Follow the existing code style and conventions in the repository.
   - Ensure your fix aligns with the MR's original intent and you take into consideration any decision taken in the MR conversations.
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
export function createFixCIFailuresPrompt(projectId: number, pipelineId?: number, mergeRequestId?: number): string {
    const issueDescriptionSection = `<issue_description>`;
    return `
Your task is to analyze CI failures and fix them. Follow these steps:

### Steps to follow
1. Gather Information
${pipelineId ? `   - Use 'gitlab.list_pipeline_jobs' tool with projectId=${projectId} and pipelineId=${pipelineId} to get all jobs
   - Identify which jobs have failed (status: 'failed')
   - For each failed job, use 'gitlab.get_pipeline_job_output' tool with projectId=${projectId} and jobId to retrieve the job logs` : ''}
   - If NO failed jobs were found, stop and submit IMMEDIATELY, reporting that there are no failures for this pipeline. Do not check anything else.
   - If failed jobs WERE found, review the MR title, description, comments, and commits in the ${issueDescriptionSection} section below. This is important to ensure we align with the MR intent and decisions being made.
${mergeRequestId ? `   - If failed jobs WERE found, use 'gitlab.get_merge_request_diffs' tool with projectId=${projectId} and mergeRequestIid=${mergeRequestId} to get the MR diff` : ''}

2. If failed jobs WERE found, analyze each failure:
   - Open and explore relevant source files to understand the context
   - Identify the failing step and error message.
   - Determine the root cause (test failure, build error, linting issue, timeout, flaky test, etc.)
   - Correlate the error with changes in the MR diff.
   - Determine if the failure is related to the MR diff or a pre-existing issue

3. Implement the Fix
   - Make the necessary changes to fix the CI failures.
   - Keep changes minimal and focused on fixing the specific failures.
   - Follow the existing code style and conventions in the repository.
   - Ensure your fix aligns with the MR's original intent and you take into consideration any decision taken in the MR conversations.
   - Do NOT make unrelated changes or "improvements" beyond what is needed to fix the CI.

4. Validation
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
- When you have fixed CI failures, submit your response specifying fixed jobs, error types, root cause, and changes made.
- If you did NOT make changes due to uncertainty or errors, submit your response specifying failed jobs, error types, root causes, why no fix was applied, and suggested next steps.
`;
}

