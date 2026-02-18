import {logger} from "./utils/logging.js";

export abstract class Variable<T> {
    protected constructor(
        public readonly key: string,
        public readonly value: T,
        public readonly mappedValue: string | null,
    ) { }
}

class StringVariable extends Variable<string | null> {
    public constructor(key: string, mappedValue: string | null = null) {
        const value = process.env[key] ?? null;
        super(key, value, mappedValue);
    }
}

class NumericVariable extends Variable<number | null> {
    public constructor(key: string, mappedValue: string | null = null) {
        const stringValue = process.env[key] ?? null;
        super(key, stringValue ? Number(stringValue) : null, mappedValue);
    }
}

class BooleanVariable extends Variable<boolean> {
    public constructor(key: string, mappedValue: string | null = null) {
        const value = process.env[key] === "true";
        super(key, value, mappedValue);
    }
}

export const webhookEnv = {
    isJunieWebhook: new StringVariable("JUNIE_WEBHOOK", "true"),
    junieBotTaggingPattern: new StringVariable("JUNIE_BOT_TAGGING_PATTERN"),
    junieVersion: new StringVariable("JUNIE_VERSION"),
    useMcp: new BooleanVariable("USE_MCP", "true"),
    junieModel: new StringVariable("JUNIE_MODEL"),
    junieGuidelinesFilename: new StringVariable("JUNIE_GUIDELINES_FILENAME"),
    junieProjectId: new NumericVariable("CI_PROJECT_ID"),
    junieProjectDefaultBranch: new StringVariable("CI_DEFAULT_BRANCH"),

    apiV4Url: new StringVariable("CI_API_V4_URL"),
    projectId: new NumericVariable("PROJECT_ID", "{{project.id}}"),
    pipelineId: new NumericVariable("CI_PIPELINE_ID"),

    eventKind: new StringVariable("EVENT_KIND", "{{object_kind}}"),

    // secrets:
    gitlabToken: new StringVariable("GITLAB_TOKEN_FOR_JUNIE"),
    junieApiKey: new StringVariable("JUNIE_API_KEY"),

    // issues-related env vars:
    issueId: new NumericVariable("ISSUE_ID", "{{issue.iid}}"),
    commentText: new StringVariable("COMMENT_TEXT", "{{object_attributes.note}}"),
    issueUrl: new StringVariable("ISSUE_URL", "{{issue.url}}"),

    // MRs-related env vars (for note events on MRs):
    mergeRequestId: new NumericVariable("MERGE_REQUEST_ID", "{{merge_request.iid}}"),
    mergeRequestSourceBranch: new StringVariable("MERGE_REQUEST_SOURCE_BRANCH", "{{merge_request.source_branch}}"),
    mergeRequestTargetBranch: new StringVariable("MERGE_REQUEST_TARGET_BRANCH", "{{merge_request.target_branch}}"),
    mergeRequestDiscussionId: new StringVariable("DISCUSSION_ID", "{{object_attributes.discussion_id}}"),

    // MR event vars (for merge_request events):
    mergeRequestEventId: new NumericVariable("MR_EVENT_ID", "{{object_attributes.iid}}"),
    mergeRequestEventSourceBranch: new StringVariable("MR_EVENT_SOURCE_BRANCH", "{{object_attributes.source_branch}}"),
    mergeRequestEventTargetBranch: new StringVariable("MR_EVENT_TARGET_BRANCH", "{{object_attributes.target_branch}}"),
    mergeRequestEventTitle: new StringVariable("MR_EVENT_TITLE", "{{object_attributes.title}}"),
    mergeRequestEventDescription: new StringVariable("MR_EVENT_DESCRIPTION", "{{object_attributes.description}}"),
    mergeRequestEventAction: new StringVariable("MR_EVENT_ACTION", "{{object_attributes.action}}"),
    mergeRequestEventUrl: new StringVariable("MR_EVENT_URL", "{{object_attributes.url}}"),

    objectId: new NumericVariable("OBJECT_ID", "{{object_attributes.id}}"),
};

logger.debug("Detected parameters:");
logger.debug(JSON.stringify(webhookEnv, null, 2));
