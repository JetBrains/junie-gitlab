import {FetchedData} from "../api/gitlab-data-fetcher.js";
import {
    GitLabExecutionContext,
    isIssueCommentEvent,
    isMergeRequestCommentEvent,
    isMergeRequestEvent,
    IssueCommentEventContext,
    MergeRequestCommentEventContext,
    MergeRequestEventContext
} from "../context.js";
import {
    CODE_REVIEW_TRIGGER_PHRASE_REGEXP,
    createCodeReviewPrompt,
    createMinorFixPrompt,
    generateMcpNote,
    GIT_OPERATIONS_NOTE,
    MINOR_FIX_ACTION,
    MINOR_FIX_TRIGGER_PHRASE_REGEXP
} from "../constants/gitlab.js";
import {sanitizeContent} from "./sanitizer.js";
import {DiscussionSchema} from '@gitbeaker/core';

/**
 * GitLab Prompt Formatter - similar to GitHub's NewGitHubPromptFormatter
 * Generates rich prompts with full context from GitLab
 */
export class GitLabPromptFormatter {

    /**
     * Generates the final prompt with all notes appended
     */
    generatePrompt(
        context: GitLabExecutionContext,
        fetchedData: FetchedData,
        customPrompt?: string,
        useMcp: boolean = false
    ): string {
        const prompt = this.buildPrompt(context, fetchedData, customPrompt);
        const mcpNote = this.getMcpNote(context, useMcp);
        return sanitizeContent(prompt + mcpNote + GIT_OPERATIONS_NOTE);
    }

    /**
     * Builds the main prompt without appending notes
     */
    private buildPrompt(
        context: GitLabExecutionContext,
        fetchedData: FetchedData,
        customPrompt?: string
    ): string {
        const repositoryInfo = this.getRepositoryInfo(context);
        const actorInfo = this.getActorInfo(context);

        let userInstruction: string | undefined;
        let mrOrIssueInfo: string | undefined;
        let commitsInfo: string | undefined;
        let discussionsInfo: string | undefined;
        let changedFilesInfo: string | undefined;

        // Handle different event types
        if (isMergeRequestCommentEvent(context)) {
            // Check if this is a minor-fix request
            const isMinorFix = customPrompt
                ? MINOR_FIX_TRIGGER_PHRASE_REGEXP.test(customPrompt)
                : MINOR_FIX_TRIGGER_PHRASE_REGEXP.test(context.commentText);

            if (isMinorFix) {
                // Extract user request from comment text
                const userRequest = this.extractMinorFixRequest(
                    customPrompt || context.commentText
                );
                return createMinorFixPrompt(
                    context.projectId,
                    context.mergeRequestId,
                    userRequest
                );
            }

            // Check if this is a code review request
            const isCodeReview = customPrompt
                ? CODE_REVIEW_TRIGGER_PHRASE_REGEXP.test(customPrompt)
                : CODE_REVIEW_TRIGGER_PHRASE_REGEXP.test(context.commentText);

            if (isCodeReview) {
                // Use specialized code review prompt
                return createCodeReviewPrompt(context.mergeRequestId);
            }

            userInstruction = this.getUserInstructionForMRComment(context, customPrompt);
            mrOrIssueInfo = this.getMRInfo(fetchedData);
            commitsInfo = this.getCommitsInfo(fetchedData);
            discussionsInfo = this.getDiscussionsInfo(fetchedData);
            changedFilesInfo = this.getChangedFilesInfo(fetchedData);
        } else if (isIssueCommentEvent(context)) {
            userInstruction = this.getUserInstructionForIssueComment(context, customPrompt);
            mrOrIssueInfo = this.getIssueInfo(fetchedData);
            discussionsInfo = this.getDiscussionsInfo(fetchedData);

        } else if (isMergeRequestEvent(context)) {
            // Check if this is a code review request
            const isCodeReview = customPrompt && CODE_REVIEW_TRIGGER_PHRASE_REGEXP.test(customPrompt);

            if (isCodeReview) {
                return createCodeReviewPrompt(context.mrEventId);
            }

            userInstruction = this.getUserInstructionForMREvent(context, customPrompt);
            mrOrIssueInfo = this.getMRInfo(fetchedData);
            commitsInfo = this.getCommitsInfo(fetchedData);
            discussionsInfo = this.getDiscussionsInfo(fetchedData);
            changedFilesInfo = this.getChangedFilesInfo(fetchedData);
        }

        // Build the final prompt similar to GitHub
        return `You were triggered as a GitLab AI Assistant by ${context.eventKind} event. Your task is to:

${userInstruction || ""}
${repositoryInfo || ""}
${mrOrIssueInfo || ""}
${commitsInfo || ""}
${discussionsInfo || ""}
${changedFilesInfo || ""}
${actorInfo || ""}
`;
    }

    private getUserInstructionForMRComment(
        context: MergeRequestCommentEventContext,
        customPrompt?: string,
    ): string {
        let instruction: string;

        // Check if comment is part of a discussion thread
        const discussionId = context.mergeRequestDiscussionId;
        const discussionPrefix = discussionId ? `Discussion #${discussionId}:\n` : '';

        if (customPrompt) {
            instruction = `${customPrompt}\n\n${discussionPrefix}Comment: ${context.commentText}`;
        } else {
            instruction = discussionPrefix + context.commentText;
        }

        return `<user_instruction>
${instruction}
</user_instruction>`;
    }

    private getUserInstructionForIssueComment(
        context: IssueCommentEventContext,
        customPrompt?: string
    ): string {
        const instruction = customPrompt
            ? `${customPrompt}\n\nComment: ${context.commentText}`
            : context.commentText;

        return `<user_instruction>
${instruction}
</user_instruction>`;
    }

    private getUserInstructionForMREvent(
        context: MergeRequestEventContext,
        customPrompt?: string
    ): string {
        const instruction = customPrompt || `Handle merge request ${context.mrEventAction}`;

        return `<user_instruction>
${instruction}
</user_instruction>`;
    }

    private getRepositoryInfo(context: GitLabExecutionContext): string {
        return `<repository>
Project ID: ${context.projectId}
Project: ${context.projectName}
</repository>`;
    }

    private getActorInfo(context: GitLabExecutionContext): string {
        return `<actor>
Event: ${context.eventKind}
Pipeline ID: ${context.pipelineId}
</actor>`;
    }

    private getMRInfo(fetchedData: FetchedData, userInstruction?: string): string | undefined {
        const mr = fetchedData.mergeRequest;
        if (!mr) return undefined;

        const stats = mr.diff_refs
            ? `Base SHA: ${mr.diff_refs.base_sha}\nHead SHA: ${mr.diff_refs.head_sha}`
            : '';

        // Add MR description only if it's not already in userInstruction (to avoid duplication)
        const shouldIncludeDescription = mr.description &&
                                         mr.description.trim().length > 0 &&
                                         (!userInstruction || !userInstruction.includes(mr.description));

        const descriptionSection = shouldIncludeDescription
            ? `\nDescription:\n${mr.description}`
            : '';

        return `<merge_request_info>
MR !${mr.iid}
Title: ${mr.title}${descriptionSection}
Author: @${mr.author.username}
State: ${mr.state}
Branch: ${mr.source_branch} -> ${mr.target_branch}
${stats}
Changes: ${mr.changes_count}
Discussions: ${mr.user_notes_count}
Upvotes: ${mr.upvotes} / Downvotes: ${mr.downvotes}
${mr.draft || mr.work_in_progress ? 'Draft: Yes' : ''}
</merge_request_info>`;
    }

    private getIssueInfo(fetchedData: FetchedData, userInstruction?: string): string | undefined {
        const issue = fetchedData.issue;
        if (!issue) return undefined;

        // Add issue description only if it's not already in userInstruction (to avoid duplication)
        const shouldIncludeDescription = issue.description &&
                                         issue.description.trim().length > 0 &&
                                         (!userInstruction || !userInstruction.includes(issue.description));

        const descriptionSection = shouldIncludeDescription
            ? `\nDescription:\n${issue.description}`
            : '';

        return `<issue_info>
Issue #${issue.iid}
Title: ${issue.title}${descriptionSection}
Author: @${issue.author.username}
State: ${issue.state}
Labels: ${issue.labels.join(', ') || 'none'}
Discussions: ${issue.user_notes_count}
</issue_info>`;
    }

    private getCommitsInfo(fetchedData: FetchedData): string | undefined {
        const commits = fetchedData.commits;
        if (!commits || commits.length === 0) return undefined;

        const formattedCommits = commits.map(commit => {
            const date = new Date(commit.created_at).toISOString().split('T')[0];
            return `[${date}] ${commit.short_id} - ${commit.title}`;
        }).join('\n');

        return `<commits>
${formattedCommits}
</commits>`;
    }

    private getDiscussionsInfo(fetchedData: FetchedData): string | undefined {
        const discussions = fetchedData.discussions;
        if (!discussions || discussions.length === 0) return undefined;

        const formattedDiscussions = discussions
            .filter(d => d.notes && (!d.individual_note || d.notes.some(n => !n.system)))
            .map(discussion => this.formatDiscussion(discussion))
            .filter(d => d.trim().length > 0)
            .join('\n\n---\n\n');

        if (!formattedDiscussions) return undefined;

        return `<discussions>
${formattedDiscussions}
</discussions>`;
    }

    private formatDiscussion(discussion: DiscussionSchema): string {
        // Filter out system notes (automated messages)
        if (!discussion.notes) return '';
        const userNotes = discussion.notes.filter(n => !n.system);
        if (userNotes.length === 0) return '';

        // Add discussion ID header if this is a thread (not individual note)
        const threadHeader = !discussion.individual_note
            ? `Discussion #${discussion.id}:\n`
            : '';

        const formattedNotes = userNotes.map(note => {
            const date = new Date(note.created_at).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            const resolved = note.resolvable && note.resolved ? ' [RESOLVED]' : '';
            return `[${date}] @${note.author.username}${resolved}:
${note.body}`;
        }).join('\n\n');

        return threadHeader + formattedNotes;
    }

    private getChangedFilesInfo(fetchedData: FetchedData): string | undefined {
        const changes = fetchedData.changes;
        if (!changes || changes.length === 0) return undefined;

        const formattedFiles = changes.map(file => {
            let status = 'modified';
            if (file.new_file) status = 'added';
            else if (file.deleted_file) status = 'deleted';
            else if (file.renamed_file) status = 'renamed';

            return `${file.new_path} (${status})`;
        }).join('\n');

        return `<changed_files>
${formattedFiles}
</changed_files>`;
    }

    /**
     * Generates MCP note based on context if MCP is enabled
     */
    private getMcpNote(context: GitLabExecutionContext, useMcp: boolean): string {
        if (!useMcp) {
            return '';
        }

        if (isIssueCommentEvent(context)) {
            return generateMcpNote({
                projectId: context.projectId,
                issueId: context.issueId,
                commentId: context.commentId
            });
        } else if (isMergeRequestCommentEvent(context)) {
            return generateMcpNote({
                projectId: context.projectId,
                mergeRequestId: context.mergeRequestId,
                commentId: context.commentId
            });
        } else if (isMergeRequestEvent(context)) {
            const mrEventContext = context as MergeRequestEventContext;
            return generateMcpNote({
                projectId: mrEventContext.projectId,
                mergeRequestId: mrEventContext.mrEventId
            });
        }

        return '';
    }

    /**
     * Extracts user request text after "minor-fix" keyword from comment
     * @param text - The comment text to parse
     * @returns The extracted user request, or undefined if no text after keyword
     */
    private extractMinorFixRequest(text: string): string | undefined {
        const match = text.match(new RegExp(`${MINOR_FIX_ACTION}\\s+(.+)`, 'i'));
        return match ? match[1].trim() : undefined;
    }
}
