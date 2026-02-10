import {
    FeedbackRequest,
    IssueCommentReactionRequest,
    IssueCommentRequest,
    MergeRequestDiscussionRequest,
    MergeRequestNoteRequest
} from "./feedback-request.js";
import {
    JUNIE_STARTED_MESSAGE,
    JUNIE_FINISHED_PREFIX,
    JUNIE_NO_CHANGES_MESSAGE,
    MR_LINK_PREFIX,
    MR_INTRO_HEADER,
} from "../constants/gitlab.js";
import {IssueCommentEventContext, MergeRequestCommentEventContext, MergeRequestEventContext} from "../context.js";
import {GitLabPromptFormatter} from "../utils/gitlab-prompt-formatter.js";
import {FetchedData} from "../api/gitlab-data-fetcher.js";


export type TaskExtractionResult = FailedTaskExtractionResult | SuccessfulTaskExtractionResult;

export class FailedTaskExtractionResult {
    public readonly success = false;

    constructor(public readonly reason: string) {
    }
}

export interface JunieTask {
    task?: string;
}

export interface SuccessfulTaskExtractionResult {
    success: true;
    checkoutBranch: string | null;
    generateJuniePrompt(useMcp: boolean): JunieTask;
    getTitle(): string;
    generateMrIntro(outcome: string | null): string;
    generateExecutionStartedFeedback(): FeedbackRequest[];
    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[];
}

export class IssueCommentTask implements SuccessfulTaskExtractionResult {
    public readonly success = true;
    public readonly checkoutBranch = null;
    private readonly formatter = new GitLabPromptFormatter();

    constructor(
        public readonly context: IssueCommentEventContext,
        public readonly fetchedData: FetchedData,
    ) {}

    generateJuniePrompt(useMcp: boolean): JunieTask {
        const { cliOptions: { customPrompt } } = this.context;

        // Use GitLabPromptFormatter for rich context
        const taskText = this.formatter.generatePrompt(
            this.context,
            this.fetchedData,
            customPrompt ?? undefined,
            useMcp
        );

        return {
            task: taskText
        };
    }

    getTitle(): string {
        return this.fetchedData.issue?.title ?? "Issue";
    }

    generateMrIntro(outcome: string | null): string {
        return MR_INTRO_HEADER + (outcome ?? "");
    }

    generateExecutionStartedFeedback(): FeedbackRequest[] {
        const { projectId, issueId, commentId } = this.context;
        return [
            new IssueCommentRequest(projectId, issueId, JUNIE_STARTED_MESSAGE),
            new IssueCommentReactionRequest(projectId, issueId, commentId, "thumbsup"),
        ];
    }

    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[] {
        const { projectId, issueId } = this.context;

        let message = JUNIE_FINISHED_PREFIX;

        if (createdMrUrl) {
            message += MR_LINK_PREFIX + createdMrUrl;
        } else if (outcome) {
            if (taskName) {
                message += `**Task:** ${taskName}\n\n`;
            }
            message += outcome;
        } else {
            message += JUNIE_NO_CHANGES_MESSAGE;
        }

        return [
            new IssueCommentRequest(projectId, issueId, message.trim()),
        ];
    }
}

export class MergeRequestCommentTask implements SuccessfulTaskExtractionResult {
    public readonly success = true;
    private readonly formatter = new GitLabPromptFormatter();

    constructor(
        public readonly context: MergeRequestCommentEventContext,
        public readonly fetchedData: FetchedData,
    ) { }

    get checkoutBranch(): string {
        return this.context.mergeRequestSourceBranch;
    }

    generateJuniePrompt(useMcp: boolean): JunieTask {
        const { cliOptions: { customPrompt } } = this.context;

        // Use GitLabPromptFormatter for rich context
        const taskText = this.formatter.generatePrompt(
            this.context,
            this.fetchedData,
            customPrompt ?? undefined,
            useMcp
        );

        return {
            task: taskText
        };
    }

    getTitle(): string {
        return this.fetchedData.mergeRequest?.title ?? "Merge Request";
    }

    generateMrIntro(outcome: string | null): string {
        return MR_INTRO_HEADER + (outcome ?? "");
    }

    generateExecutionStartedFeedback(): FeedbackRequest[] {
        const { projectId, mergeRequestId, mergeRequestDiscussionId } = this.context;
        return [
            new MergeRequestDiscussionRequest(
                projectId,
                mergeRequestId,
                mergeRequestDiscussionId,
                JUNIE_STARTED_MESSAGE
            ),
        ];
    }

    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[] {
        const { projectId, mergeRequestId, mergeRequestDiscussionId } = this.context;

        let message = JUNIE_FINISHED_PREFIX;

        if (createdMrUrl) {
            message += MR_LINK_PREFIX + createdMrUrl;
        } else if (outcome) {
            if (taskName) {
                message += `**Task:** ${taskName}\n\n`;
            }
            message += outcome;
        } else {
            message += JUNIE_NO_CHANGES_MESSAGE;
        }

        return [
            new MergeRequestDiscussionRequest(
                projectId,
                mergeRequestId,
                mergeRequestDiscussionId,
                message.trim()
            ),
        ];
    }

}

export class MergeRequestEventTask implements SuccessfulTaskExtractionResult {
    public readonly success = true;
    private readonly formatter = new GitLabPromptFormatter();

    constructor(
        public readonly context: MergeRequestEventContext,
        public readonly fetchedData: FetchedData,
    ) { }

    get checkoutBranch(): string {
        return this.context.mrEventSourceBranch;
    }

    generateJuniePrompt(useMcp: boolean): JunieTask {
        const { cliOptions: { customPrompt } } = this.context;

        // Use GitLabPromptFormatter for rich context
        const taskText = this.formatter.generatePrompt(
            this.context,
            this.fetchedData,
            customPrompt ?? undefined,
            useMcp
        );

        return {
            task: taskText
        };
    }

    getTitle(): string {
        return this.fetchedData.mergeRequest?.title ?? this.context.mrEventTitle;
    }

    generateMrIntro(outcome: string | null): string {
        return MR_INTRO_HEADER + (outcome ?? "");
    }

    generateExecutionStartedFeedback(): FeedbackRequest[] {
        const { projectId, mrEventId } = this.context;
        return [
            new MergeRequestNoteRequest(
                projectId,
                mrEventId,
                JUNIE_STARTED_MESSAGE
            ),
        ];
    }

    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[] {
        const { projectId, mrEventId } = this.context;

        let message = JUNIE_FINISHED_PREFIX;

        if (createdMrUrl) {
            message += MR_LINK_PREFIX + createdMrUrl;
        } else if (outcome) {
            if (taskName) {
                message += `**Task:** ${taskName}\n\n`;
            }
            message += outcome;
        } else {
            message += JUNIE_NO_CHANGES_MESSAGE;
        }

        return [
            new MergeRequestNoteRequest(
                projectId,
                mrEventId,
                message.trim()
            ),
        ];
    }

}