// ============================================================================
// Actions and Triggers
// ============================================================================

export const CODE_REVIEW_ACTION = "code-review";

export const CODE_REVIEW_TRIGGER_PHRASE_REGEXP = new RegExp(CODE_REVIEW_ACTION, 'i');

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
