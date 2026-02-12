import {Variable, webhookEnv} from "./webhook-env.js";
import {
    createPipelineTriggerToken,
    createProjectAccessToken,
    createProjectHook, deletePipelineTriggerToken, getAllPipelineTriggerTokens,
    getAllProjectHooks
} from "./api/gitlab-api.js";
import {logger} from "./utils/logging.js";
import {AccessLevel} from "@gitbeaker/rest";

export async function initialize(projectIds: number[]) {

    const apiV4Url = webhookEnv.apiV4Url.value!;
    const defaultBranch = webhookEnv.defaultBranch.value!;

    const junieProjectId = webhookEnv.junieProjectId.value!;
    logger.info(`Initializing Junie CLI in project ${junieProjectId}`);

    for (const projectId of projectIds) {
        logger.info(`Initializing project ${projectId}...`);
        const existingWebhooks = await getAllProjectHooks(projectId);

        const junieWebhook = existingWebhooks.find(hook => {
            const template = hook.custom_webhook_template as string | undefined;
            if (!template) return false;
            try {
                const parsedTemplate: WebhookTemplate = JSON.parse(template);
                const variables = parsedTemplate.variables;
                logger.debug(`Webhook template #${hook.id} has ${Object.keys(variables ?? {}).length} variables: ` + JSON.stringify(variables));
                return variables?.[webhookEnv.isJunieWebhook.key] === "true";
            } catch (e) {
                logger.info(`Failed to parse webhook template #${hook.id}`);
                return false;
            }
        }) ?? null;

        logger.info(`Existing webhook: ${junieWebhook ? junieWebhook.id : "none"}`);

        if (!junieWebhook) {
            logger.info("Creating a new webhook...");

            const triggerTokenName = `junie trigger for the project #${projectId}`;
            const existingTriggerTokens = (await getAllPipelineTriggerTokens(junieProjectId)).filter(token => token.description === triggerTokenName);
            if (existingTriggerTokens.length > 0) {
                logger.info(`Deleting existing trigger tokens (${existingTriggerTokens.length})`);
                for (const token of existingTriggerTokens) {
                    await deletePipelineTriggerToken(junieProjectId, token.id);
                }
            }
            const triggerToken = await createPipelineTriggerToken(junieProjectId, triggerTokenName);
            logger.debug(`Generated trigger token with id ${triggerToken.id}`);
            const triggerTokenValue = triggerToken.token;

            const patExpiration = new Date();
            patExpiration.setFullYear(patExpiration.getFullYear() + 1);
            const pat = await createProjectAccessToken(
                projectId,
                "junie's access token",
                undefined,
                ["write_repository", "api"],
                AccessLevel.MAINTAINER, // refine this choice if needed
                patExpiration.toISOString(),
            );
            logger.info(`Generated PAT "${pat.name}" with id ${pat.id} and expiration date ${pat.expires_at}`);

            const webhookUrl = `${apiV4Url}/projects/${junieProjectId}/trigger/pipeline?ref=${defaultBranch}&token={trigger_token}&inputs[project_token]={project_token}`;

            const template: WebhookTemplate = {
                variables: {},
            };
            Object.keys(webhookEnv).forEach(key => {
                const value = (webhookEnv as any)[key];
                if (value instanceof Variable && value.mappedValue !== null) {
                    template.variables![value.key] = value.mappedValue;
                }
            });
            const templateString = JSON.stringify(template, null, 2);
            logger.debug(`Generated webhook template:\n${templateString}`);



            const result = await createProjectHook(
                projectId,
                webhookUrl.toString(),
                {
                    name: "Junie",
                    description: "Junie webhook",
                    issuesEvents: false,
                    noteEvents: true,
                    mergeRequestsEvents: true,
                    pushEvents: false,
                    enableSSLVerification: true,
                    customWebhookTemplate: templateString,
                    urlVariables: [
                        {key: "project_token", value: pat.token},
                        {key: "trigger_token", value: triggerTokenValue},
                    ]
                }
            );

            logger.info("Webhook created with id " + result.id);
        } else {
            // TODO: validate existing one
        }
    }

    logger.info("Initialization completed successfully");
}

interface WebhookTemplate {
    variables?: Record<string, string>;
}
