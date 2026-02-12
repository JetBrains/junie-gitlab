import {Variable, webhookEnv} from "./webhook-env.js";
import {createProjectHook, getAllProjectHooks} from "./api/gitlab-api.js";
import {logger} from "./utils/logging.js";

export async function initialize() {

    const projectId = webhookEnv.projectId.value!;
    const gitlabToken = webhookEnv.gitlabToken.value!;
    const apiV4Url = webhookEnv.apiV4Url.value!;
    const defaultBranch = webhookEnv.defaultBranch.value!;

    const existingWebhooks = await getAllProjectHooks(projectId);

    const junieWebhook = existingWebhooks.find(hook => {
        const template = hook.custom_webhook_template as string | undefined;
        if (!template) return false;
        try {
            const parsedTemplate: WebhookTemplate = JSON.parse(template);
            const variables = parsedTemplate.variables ?? [];
            logger.debug(`Webhook template #${hook.id} has ${variables.length} variables: ` + JSON.stringify(variables));
            return variables.find(v => v.key === webhookEnv.isJunieWebhook.key)?.value === "true";
        } catch (e) {
            logger.info(`Failed to parse webhook template #${hook.id}`);
            return false;
        }
    }) ?? null;

    logger.info(`Existing webhook: ${junieWebhook ? junieWebhook.id : "none"}`);

    if (!junieWebhook) {
        logger.info("Creating a new webhook...");
        const webhookUrl = `${apiV4Url}/projects/${projectId}/pipeline?ref=${defaultBranch}`;
        const template: WebhookTemplate = {
            variables: [],
        };
        Object.keys(webhookEnv).forEach(key => {
            const value = (webhookEnv as any)[key];
            if (value instanceof Variable && value.mappedValue !== null) {
                template.variables!.push({key: value.key, value: value.mappedValue});
            }
        });
        const templateString = JSON.stringify(template, null, 2);
        logger.debug(`Generated webhook template:\n${templateString}`);
        const result = await createProjectHook(
            projectId,
            webhookUrl,
            {
                name: "Junie",
                description: "Junie webhook",
                issuesEvents: false,
                noteEvents: true,
                mergeRequestsEvents: true,
                pushEvents: false,
                token: gitlabToken,
                enableSSLVerification: true,
                customHeaders: [{key: "Authorization", value: `Bearer ${gitlabToken}`}],
                customWebhookTemplate: templateString,
            }
        );
        logger.info("Webhook created with id " + result.id);
    } else {
        // TODO: validate existing one
    }

    logger.info("Initialization completed successfully");
}

interface WebhookTemplate {
    event?: string;
    project_name?: string;
    variables?: {key: string, value: string}[];
}
