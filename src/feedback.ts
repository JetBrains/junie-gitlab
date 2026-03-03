import {
    FeedbackRequest,
    IssueCommentReactionRequest,
    IssueCommentRequest,
    MergeRequestDiscussionRequest,
    MergeRequestNoteRequest
} from "./models/feedback-request.js";
import {addIssueComment, addIssueCommentEmoji, addMergeRequestDiscussionNote, addMergeRequestNote} from "./api/gitlab-api.js";
import {logger} from "./utils/logging.js";

function isNetworkError(e: unknown): boolean {
    return e instanceof TypeError && (e as any).cause?.code?.startsWith('UND_ERR');
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const delays = [2000, 5000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await fn();
        } catch (e) {
            if (attempt < delays.length && isNetworkError(e)) {
                logger.warn(`Network error on ${label}, retrying in ${delays[attempt]}ms...`);
                await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            } else {
                throw e;
            }
        }
    }
    throw new Error('unreachable');
}

export async function submitFeedback(request: FeedbackRequest) {

    if (request instanceof IssueCommentReactionRequest) {
        try {
            await addIssueCommentEmoji(
                request.projectId,
                request.issueId,
                request.commentId,
                request.emoji,
            );
        } catch (e) {
            logger.debug(`Failed to add emoji ${request.emoji} to comment ${request.commentId} in issue ${request.issueId} (probably it's already set)`);
        }
    } else if (request instanceof IssueCommentRequest) {
        try {
            await withRetry(
                () => addIssueComment(request.projectId, request.issueId, request.commentText),
                `issue comment ${request.issueId}`
            );
        } catch (e) {
            logger.error(`Failed to add comment to issue ${request.issueId}`, e);
        }
    } else if (request instanceof MergeRequestDiscussionRequest) {
        try {
            await withRetry(
                () => addMergeRequestDiscussionNote(request.projectId, request.mergeRequestId, request.discussionId, request.commentText),
                `discussion note ${request.discussionId} in MR ${request.mergeRequestId}`
            );
        } catch (e) {
            logger.error(`Failed to add note to discussion ${request.discussionId} in merge request ${request.mergeRequestId}`, e);
        }
    } else if (request instanceof MergeRequestNoteRequest) {
        try {
            await withRetry(
                () => addMergeRequestNote(request.projectId, request.mergeRequestId, request.commentText),
                `note in MR ${request.mergeRequestId}`
            );
        } catch (e) {
            logger.error(`Failed to add note to merge request ${request.mergeRequestId}`, e);
        }
    } else {
        throw new Error(`Unsupported feedback request type: ${request.constructor.name}`);
    }

}
