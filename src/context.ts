import {webhookEnv} from "./webhook-env.js";
import {logger} from "./utils/logging.js";

/**
 * MR event actions
 */
export type MREventAction = 'open' | 'update' | 'reopen' | 'close' | 'merge';

/**
 * Configuration options passed from CLI
 */
export interface CLIOptions {
    cleanupAfterIdleRun?: boolean;
    mrMode: 'append' | 'new';
    customPrompt: string | null;
}

/**
 * Base context shared by all event types
 */
interface BaseGitLabContext {
    // Project info
    projectId: number;
    projectName: string;
    pipelineId: number;

    // API configuration
    apiV4Url: string;
    defaultBranch: string;
    gitlabToken: string;
    junieApiKey: string;

    // Junie configuration
    junieVersion: string | null;
    junieModel: string | null;
    junieGuidelinesFilename: string | null;
    useMcp: boolean;
    junieBotTaggingPattern: RegExp;

    // CLI options
    cliOptions: CLIOptions;
}

/**
 * Issue comment event context (note on issue)
 */
export interface IssueCommentEventContext extends BaseGitLabContext {
    eventKind: 'note';
    isMR: false;
    issueId: number;
    issueUrl: string;
    commentText: string;
    commentId: number;
}

/**
 * Merge request comment event context (note on MR)
 */
export interface MergeRequestCommentEventContext extends BaseGitLabContext {
    eventKind: 'note';
    isMR: true;
    mergeRequestId: number;
    mergeRequestSourceBranch: string;
    mergeRequestTargetBranch: string;
    mergeRequestDiscussionId: string;
    commentText: string;
    commentId: number;
}

/**
 * Merge request event context (MR opened, updated, etc.)
 */
export interface MergeRequestEventContext extends BaseGitLabContext {
    eventKind: 'merge_request';
    isMR: true;
    mrEventId: number;
    mrEventSourceBranch: string;
    mrEventTargetBranch: string;
    mrEventTitle: string;
    mrEventDescription: string;
    mrEventAction: MREventAction;
    mrEventUrl: string;
}

/**
 * Union type representing all possible GitLab execution contexts
 */
export type GitLabExecutionContext =
    | IssueCommentEventContext
    | MergeRequestCommentEventContext
    | MergeRequestEventContext;

/**
 * Extracts GitLab execution context from environment variables and CLI options
 */
export function extractGitLabContext(cliOptions: CLIOptions): GitLabExecutionContext {
    const projectId = webhookEnv.projectId.value;
    const eventKind = webhookEnv.eventKind.value;

    if (!projectId) {
        throw new Error("CI_PROJECT_ID is required");
    }

    if (!eventKind) {
        throw new Error("EVENT_KIND is required");
    }

    const junieBotTaggingPatternString = webhookEnv.junieBotTaggingPattern.value ?? "junie";
    const junieBotTaggingPattern = new RegExp(junieBotTaggingPatternString, "i");

    // Base context shared by all event types
    const baseContext: BaseGitLabContext = {
        // Project info
        projectId,
        projectName: webhookEnv.projectName.value ?? "unknown",
        pipelineId: webhookEnv.pipelineId.value ?? 0,

        // API configuration
        apiV4Url: webhookEnv.apiV4Url.value!,
        defaultBranch: webhookEnv.defaultBranch.value!,
        gitlabToken: webhookEnv.gitlabToken.value!,
        junieApiKey: webhookEnv.junieApiKey.value!,

        // Junie configuration
        junieVersion: webhookEnv.junieVersion.value,
        junieModel: webhookEnv.junieModel.value,
        junieGuidelinesFilename: webhookEnv.junieGuidelinesFilename.value,
        useMcp: webhookEnv.useMcp.value,
        junieBotTaggingPattern,

        // CLI options
        cliOptions,
    };

    let context: GitLabExecutionContext;

    switch (eventKind) {
        case 'note': {
            const commentText = webhookEnv.commentText.value;
            const commentId = webhookEnv.objectId.value;

            if (!commentText || !commentId) {
                throw new Error("Comment text and ID are required for note events");
            }

            // Check if this is a comment on an issue or MR
            const issueId = webhookEnv.issueId.value;
            const mergeRequestId = webhookEnv.mergeRequestId.value;

            if (issueId && webhookEnv.issueUrl.value) {
                // Issue comment event
                context = {
                    ...baseContext,
                    eventKind: 'note',
                    isMR: false,
                    issueId,
                    issueUrl: webhookEnv.issueUrl.value,
                    commentText,
                    commentId,
                };
            } else if (
                mergeRequestId &&
                webhookEnv.mergeRequestSourceBranch.value &&
                webhookEnv.mergeRequestTargetBranch.value &&
                webhookEnv.mergeRequestDiscussionId.value
            ) {
                // MR comment event
                context = {
                    ...baseContext,
                    eventKind: 'note',
                    isMR: true,
                    mergeRequestId,
                    mergeRequestSourceBranch: webhookEnv.mergeRequestSourceBranch.value,
                    mergeRequestTargetBranch: webhookEnv.mergeRequestTargetBranch.value,
                    mergeRequestDiscussionId: webhookEnv.mergeRequestDiscussionId.value,
                    commentText,
                    commentId,
                };
            } else {
                throw new Error("Invalid note event: missing issue or MR context");
            }
            break;
        }

        case 'merge_request': {
            const mrEventId = webhookEnv.mergeRequestEventId.value;
            const mrEventSourceBranch = webhookEnv.mergeRequestEventSourceBranch.value;
            const mrEventTargetBranch = webhookEnv.mergeRequestEventTargetBranch.value;
            const mrEventTitle = webhookEnv.mergeRequestEventTitle.value;
            const mrEventDescription = webhookEnv.mergeRequestEventDescription.value;
            const mrEventAction = webhookEnv.mergeRequestEventAction.value;
            const mrEventUrl = webhookEnv.mergeRequestEventUrl.value;

            if (
                !mrEventId ||
                !mrEventSourceBranch ||
                !mrEventTargetBranch ||
                !mrEventTitle ||
                mrEventDescription === null ||
                !mrEventAction ||
                !mrEventUrl
            ) {
                throw new Error("Missing required fields for merge_request event");
            }

            context = {
                ...baseContext,
                eventKind: 'merge_request',
                isMR: true,
                mrEventId,
                mrEventSourceBranch,
                mrEventTargetBranch,
                mrEventTitle,
                mrEventDescription,
                mrEventAction: mrEventAction as MREventAction,
                mrEventUrl,
            };
            break;
        }

        default:
            throw new Error(`Unsupported event kind: ${eventKind}`);
    }

    logger.debug("GitLab execution context:");
    logger.debug(JSON.stringify(context, null, 2));

    return context;
}

// ============================================================================
// Type Guard Functions
// ============================================================================

/**
 * Checks if the context is an issue comment event
 */
export function isIssueCommentEvent(
    context: GitLabExecutionContext
): context is IssueCommentEventContext {
    return context.eventKind === 'note' && !context.isMR;
}

/**
 * Checks if the context is a merge request comment event
 */
export function isMergeRequestCommentEvent(
    context: GitLabExecutionContext
): context is MergeRequestCommentEventContext {
    return context.eventKind === 'note' && context.isMR;
}

/**
 * Checks if the context is a merge request event (open, update, etc.)
 */
export function isMergeRequestEvent(
    context: GitLabExecutionContext
): context is MergeRequestEventContext {
    return context.eventKind === 'merge_request';
}

/**
 * Checks if the context is a note event (issue or MR comment)
 */
export function isNoteEvent(
    context: GitLabExecutionContext
): context is IssueCommentEventContext | MergeRequestCommentEventContext {
    return context.eventKind === 'note';
}

export function isMRCommandEvent(command: RegExp, context: MergeRequestCommentEventContext, customPrompt?: string) {
    const isCommandInPrompt = customPrompt && command.test(customPrompt);
    const isCommandInComment = command.test(context.commentText);
    const result = isCommandInPrompt || isCommandInComment;
    console.log(`Is MR command ${command} event: ${result}`);
    return result;

}
