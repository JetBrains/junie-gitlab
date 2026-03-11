import {
    FeedbackRequest,
    IssueCommentReactionRequest,
    IssueCommentRequest,
    MergeRequestDiscussionRequest,
    MergeRequestNoteRequest
} from "./feedback-request.js";
import {
    CODE_REVIEW_TRIGGER_PHRASE_REGEXP,
    JUNIE_FINISHED_PREFIX,
    JUNIE_NO_CHANGES_MESSAGE,
    JUNIE_STARTED_MESSAGE,
    MR_INTRO_HEADER,
    MR_LINK_PREFIX,
} from "../constants/gitlab.js";
import {
    isMRCommandEvent,
    IssueCommentEventContext,
    MergeRequestCommentEventContext,
    MergeRequestEventContext
} from "../context.js";
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
    codeReviewTask?: { diffCommand: string; description?: string };
}

export interface SuccessfulTaskExtractionResult {
    success: true;
    checkoutBranch: string;

    generateJuniePrompt(useMcp: boolean): Promise<JunieTask>;

    getTitle(): string;

    generateMrIntro(outcome: string | null): string;

    generateExecutionStartedFeedback(): FeedbackRequest[];

    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[];
}

export class IssueCommentTask implements SuccessfulTaskExtractionResult {
    public readonly success = true;
    private readonly formatter = new GitLabPromptFormatter();

    constructor(
        public readonly context: IssueCommentEventContext,
        public readonly fetchedData: FetchedData,
        public readonly checkoutBranch: string,
    ) {
    }

    async generateJuniePrompt(useMcp: boolean): Promise<JunieTask> {
        const {customPrompt} = this.context;

        // Use GitLabPromptFormatter for rich context
        const taskText = await this.formatter.generatePrompt(
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
        const {projectId, issueId, commentId} = this.context;
        return [
            new IssueCommentRequest(projectId, issueId, JUNIE_STARTED_MESSAGE),
            new IssueCommentReactionRequest(projectId, issueId, commentId, "thumbsup"),
        ];
    }

    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[] {
        const {projectId, issueId} = this.context;

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
    ) {
    }

    get checkoutBranch(): string {
        return this.context.mergeRequestSourceBranch;
    }

    async generateJuniePrompt(useMcp: boolean): Promise<JunieTask> {
        const {customPrompt} = this.context;

        // Use GitLabPromptFormatter for rich context
        const taskText = await this.formatter.generatePrompt(
            this.context,
            this.fetchedData,
            customPrompt ?? undefined,
            useMcp
        );

        if (isMRCommandEvent(CODE_REVIEW_TRIGGER_PHRASE_REGEXP, this.context, customPrompt ?? undefined)) {
            const diffCommand = `git diff origin/${this.context.mergeRequestTargetBranch}...`;
            const description = taskText
            return {codeReviewTask: {diffCommand, description}};
        }

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
        const {projectId, mergeRequestId, mergeRequestDiscussionId} = this.context;
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
        const {projectId, mergeRequestId, mergeRequestDiscussionId} = this.context;

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
    ) {
    }

    get checkoutBranch(): string {
        return this.context.mrEventSourceBranch;
    }

    async generateJuniePrompt(useMcp: boolean): Promise<JunieTask> {
        const {customPrompt} = this.context;

        // Use GitLabPromptFormatter for rich context
        const taskText = await this.formatter.generatePrompt(
            this.context,
            this.fetchedData,
            customPrompt ?? undefined,
            useMcp
        );

        if (customPrompt && CODE_REVIEW_TRIGGER_PHRASE_REGEXP.test(customPrompt)) {
            const diffCommand = `git diff origin/${this.context.mrEventTargetBranch}...`;
            const description = taskText
            return {codeReviewTask: {diffCommand, description}};
        }

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
        const {projectId, mrEventId} = this.context;
        return [
            new MergeRequestNoteRequest(
                projectId,
                mrEventId,
                JUNIE_STARTED_MESSAGE
            ),
        ];
    }

    generateExecutionFinishedFeedback(outcome: string | null, taskName: string | null, createdMrUrl: string | null): FeedbackRequest[] {
        const {projectId, mrEventId} = this.context;

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