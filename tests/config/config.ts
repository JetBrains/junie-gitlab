interface GitLabE2EConfig {
    gitlabHost: string;
    gitlabInternalHost: string;
    gitlabToken: string;
    junieWorkspaceProjectId?: number;
}

const workspaceProjectIdRaw = process.env.JUNIE_WORKSPACE_PROJECT_ID;

export const gitLabConfig: GitLabE2EConfig = {
    gitlabHost: process.env.TEST_GITLAB_HOST || "http://localhost:8080",
    gitlabInternalHost: process.env.TEST_GITLAB_INTERNAL_HOST || "http://gitlab",
    gitlabToken: process.env.LOCAL_GITLAB_ROOT_TOKEN || "",
    junieWorkspaceProjectId: workspaceProjectIdRaw ? Number(workspaceProjectIdRaw) : undefined
};
