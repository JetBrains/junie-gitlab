interface GitLabE2EConfig {
    gitlabHost: string;
    gitlabToken: string;
    projectId: string;
}

export const gitLabConfig: GitLabE2EConfig = {
    gitlabHost: process.env.TEST_GITLAB_HOST || "https://gitlab.com",
    gitlabToken: process.env.TEST_GITLAB_TOKEN || "",
    projectId: process.env.TEST_GITLAB_PROJECT_ID || "JetBrainsOfficial/junie-test-project",
};
