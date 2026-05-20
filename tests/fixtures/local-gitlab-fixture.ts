import {randomUUID} from "node:crypto";
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve, join} from "node:path";
import {execSync} from "node:child_process";
import {api, initApi, deleteProject, createRepositoryFile} from "../../src/api/gitlab-api.js";
import {initialize} from "../../src/initializer.js";
import {gitLabConfig} from "../config/config.js";

const ARTIFACTS_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../test-results"
);

const CLIENT_CI_YAML = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../script-sample.yaml"),
    "utf8"
);

async function copyProjectVariables(srcProjectId: number, dstProjectId: number): Promise<void> {
    const vars = await (api as any).ProjectVariables.all(srcProjectId) as Array<{
        key: string;
        value: string;
        variable_type?: "env_var" | "file";
        protected?: boolean;
        masked?: boolean;
        environment_scope?: string;
    }>;
    for (const v of vars) {
        await (api as any).ProjectVariables.create(dstProjectId, v.key, v.value, {
            variableType: v.variable_type ?? "env_var",
            protected: v.protected ?? false,
            masked: v.masked ?? false,
            environmentScope: v.environment_scope ?? "*",
        });
    }
}

export interface LocalProjectHandle {
    projectId: number;
    projectPath: string;
    webUrl: string;
    defaultBranch: string;
}

/**
 * Per-test fixture that provisions a fresh GitLab project on the local
 * Dockerized GitLab and wires it up to the shared Junie Workspace project
 * so a real webhook-triggered pipeline can run end-to-end.
 *
 * The host-side test process talks to GitLab via gitLabConfig.gitlabHost
 * (e.g. http://localhost:8080) while webhooks and runner jobs use
 * gitLabConfig.gitlabInternalHost (e.g. http://gitlab) — both must point at
 * the same instance.
 */
export class LocalGitLabFixture {
    private project?: LocalProjectHandle;

    static ensureBootstrapped(): void {
        if (!gitLabConfig.gitlabToken) {
            throw new Error("LOCAL_GITLAB_ROOT_TOKEN is empty. Did the bootstrap script complete?");
        }
        if (!gitLabConfig.junieWorkspaceProjectId) {
            throw new Error("JUNIE_WORKSPACE_PROJECT_ID is not set. Did the bootstrap script complete?");
        }
    }

    async create(namePrefix: string, junieRunFlags?: string): Promise<LocalProjectHandle> {
        LocalGitLabFixture.ensureBootstrapped();

        initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);

        const projectName = `${namePrefix}-${randomUUID().slice(0, 8)}`;
        const created = await api.Projects.create({
            name: projectName,
            path: projectName,
            visibility: "private",
            initializeWithReadme: true,
            defaultBranch: "main",
        } as any) as any;

        const handle: LocalProjectHandle = {
            projectId: created.id,
            projectPath: created.path_with_namespace,
            webUrl: created.web_url,
            defaultBranch: created.default_branch,
        };

        const wrapperImage = process.env.WRAPPER_IMAGE || "junie-gitlab-wrapper:test";
        let yaml = CLIENT_CI_YAML
            .replace(
                /registry\.jetbrains\.team\/p\/matterhorn\/public\/junie-gitlab-wrapper:latest/g,
                wrapperImage
            )
            .replace(/^\s*GITLAB_TOKEN_FOR_JUNIE:\s*"\$INPUT_TOKEN".*\n?/m, "");
        if (junieRunFlags) {
            yaml = yaml.replace(
                "node /app/dist/cli.js run --verbose",
                `node /app/dist/cli.js run --verbose ${junieRunFlags}`
            );
        }

        await createRepositoryFile(
            handle.projectId,
            ".gitlab-ci.yml",
            handle.defaultBranch,
            yaml,
            "ci: add Junie pipeline"
        );

        await copyProjectVariables(gitLabConfig.junieWorkspaceProjectId!, handle.projectId);

        const internalApiV4 = `${gitLabConfig.gitlabInternalHost}/api/v4`;
        const externalApiV4 = `${gitLabConfig.gitlabHost}/api/v4`;
        await initialize([handle.projectId], {
            apiV4Url: internalApiV4,
            junieProjectId: handle.projectId,
            junieProjectDefaultBranch: handle.defaultBranch,
            apiV4UrlForLocalProbe: externalApiV4,
        });

        this.project = handle;
        return handle;
    }

    async destroy({testPassed}: {testPassed: boolean}): Promise<void> {
        if (!this.project) return;
        const project = this.project;

        await collectPipelineArtifacts(project).catch(e =>
            console.error(`Failed to collect artifacts for project ${project.projectId}: ${e}`)
        );

        if (!testPassed) {
            console.log(
                `Test failed — keeping project #${project.projectId} ` +
                `(${project.webUrl.replace("http://gitlab", "http://localhost:8080")}) for investigation.`
            );
            this.project = undefined;
            return;
        }
        try {
            await deleteProject(project.projectId);
            console.log(`Test passed — destroyed isolated project #${project.projectId}`);
        } catch (e) {
            console.error(`Failed to delete project ${project.projectId}: ${e}`);
        } finally {
            this.project = undefined;
        }
    }
}

async function collectPipelineArtifacts(project: LocalProjectHandle): Promise<void> {
    const projectSlug = project.projectPath.replace(/[^a-zA-Z0-9_-]/g, "_");
    const outDir = join(ARTIFACTS_ROOT, projectSlug);
    mkdirSync(outDir, {recursive: true});

    const token = gitLabConfig.gitlabToken;
    const base = gitLabConfig.gitlabHost.replace(/\/$/, "");
    const headers = {"PRIVATE-TOKEN": token};

    const pipelinesRes = await fetch(
        `${base}/api/v4/projects/${project.projectId}/pipelines?per_page=20`,
        {headers}
    );
    if (!pipelinesRes.ok) {
        console.error(`Could not list pipelines for project ${project.projectId}: ${pipelinesRes.status}`);
        return;
    }
    const pipelines = await pipelinesRes.json() as Array<{id: number; status: string}>;
    if (pipelines.length === 0) {
        console.log(`No pipelines to collect for project ${project.projectId}`);
        return;
    }

    let jobsCollected = 0;
    for (const pipeline of pipelines) {
        const jobsRes = await fetch(
            `${base}/api/v4/projects/${project.projectId}/pipelines/${pipeline.id}/jobs`,
            {headers}
        );
        if (!jobsRes.ok) continue;
        const jobs = await jobsRes.json() as Array<{id: number; name: string; status: string; artifacts_file?: {filename: string}}>;
        for (const job of jobs) {
            const jobDir = join(outDir, `pipeline-${pipeline.id}`, `${job.name}-${job.id}`);
            mkdirSync(jobDir, {recursive: true});

            const traceRes = await fetch(
                `${base}/api/v4/projects/${project.projectId}/jobs/${job.id}/trace`,
                {headers}
            );
            if (traceRes.ok) {
                writeFileSync(join(jobDir, "job.log"), await traceRes.text());
            }

            if (job.artifacts_file) {
                const artRes = await fetch(
                    `${base}/api/v4/projects/${project.projectId}/jobs/${job.id}/artifacts`,
                    {headers}
                );
                if (artRes.ok) {
                    const buf = Buffer.from(await artRes.arrayBuffer());
                    writeFileSync(join(jobDir, "artifacts.zip"), buf);
                }
            }
            jobsCollected++;
        }
    }

    try {
        const runnerLogs = execSync(
            "docker logs --tail=2000 junie-test-runner",
            {stdio: ["ignore", "pipe", "pipe"]}
        );
        writeFileSync(join(outDir, "runner.log"), runnerLogs);
    } catch (e) {
        console.error(`Could not dump runner container logs: ${e}`);
    }

    console.log(`Collected ${jobsCollected} job artifact(s) into ${outDir}`);
}
