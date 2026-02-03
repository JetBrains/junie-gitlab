+ create a network first:
```bash
docker network create gitlab-net --driver bridge
```

+ run compose:
```bash
docker-compose up -d
```

+ get password (run within the gitlab's container):
```bash
grep 'Password:' /etc/gitlab/initial_root_password
```

+ register the runner (run within the runner's container):
```yaml
gitlab-runner register \
  --url "http://gitlab" \
  --registration-token "YOUR_TOKEN_GOES_HERE" \
  --executor "docker" \
  --description "sample-runner" \
  --docker-image "alpine:latest" \
  --docker-network-mode "gitlab-net"
```

> You can find the registration token on the runner's settings page.

+ add the following to the runner's config (/etc/gitlab-runner/config.toml):
```yaml
  [runners.docker]
    git_strategy = "fetch"
    pull_policy = "always"
```


+ for versions prior to `18.9`: enable required features (run in gitlab's container):
```bash
gitlab-rails console
Feature.enable(:custom_webhook_template_serialization)
```