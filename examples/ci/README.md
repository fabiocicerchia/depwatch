# depwatch in CI

On **GitHub Actions**, use the composite action in this repository's root — it
does everything here and adds a job summary, a sticky pull request comment and
step outputs:

```yaml
- uses: fabiocicerchia/depwatch@v0   # pin to a SHA
  with:
    manifest: package.json
    max-libyears: 25
    max-libyears-increase: 0
```

See [docs/github-action.md](../../docs/github-action.md).

Everywhere else, [`depwatch-ci.sh`](depwatch-ci.sh) is that action's behaviour in
one POSIX shell script — install, optionally measure the base branch, gate — and
the files in this directory are that script wired into each platform
idiomatically. Copy the one you need to the path in the table and adjust the
budget.

## The two thresholds

`MAX_LIBYEARS` is an absolute budget: fail above this many libyears in total. It
is the right gate once you have a number you are willing to defend, and the wrong
one before that — on a repository already well behind, a budget above today's
figure never fires, and one below it fails every change for debt that change did
not create.

`MAX_LIBYEARS_INCREASE` is a **ratchet** and gates from the first day: whatever
the total is, this change may not add more than this to it. `0` means "do not
make it worse". It needs `BASE_REF` to compare against, and reports itself
skipped — rather than failing — when there is nothing to compare to.

Most of the files below set both, because they answer different questions.

## Platforms

| Platform | File | Copy to | Base ref from |
| --- | --- | --- | --- |
| GitLab CI | [gitlab-ci.yml](gitlab-ci.yml) | `.gitlab-ci.yml` | `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` |
| CircleCI | [circleci/config.yml](circleci/config.yml) | `.circleci/config.yml` | trunk by name¹ |
| Travis CI | [travis.yml](travis.yml) | `.travis.yml` | `TRAVIS_BRANCH` |
| Azure DevOps | [azure-pipelines.yml](azure-pipelines.yml) | `azure-pipelines.yml` | `System.PullRequest.TargetBranch` |
| AWS CodeBuild / CodePipeline | [buildspec.yml](buildspec.yml) | `buildspec.yml` | `CODEBUILD_WEBHOOK_BASE_REF` |
| Devtron | [devtron-task.yaml](devtron-task.yaml) | pipeline pre-build stage | — (branch builds)¹ |
| Northflank | [northflank-job.json](northflank-job.json) | `northflank create job --file` | — (single-commit clone)¹ |
| Spacelift | [spacelift-config.yml](spacelift-config.yml) | `.spacelift/config.yml` | `SPACELIFT_STACK_BRANCH` |
| Jenkins | [Jenkinsfile](Jenkinsfile) | `Jenkinsfile` | `CHANGE_TARGET` |
| Bitbucket Pipelines | [bitbucket-pipelines.yml](bitbucket-pipelines.yml) | `bitbucket-pipelines.yml` | `BITBUCKET_PR_DESTINATION_BRANCH` |
| Google Cloud Build | [cloudbuild.yaml](cloudbuild.yaml) | `cloudbuild.yaml` | `_BASE_BRANCH` substitution¹ |
| Tekton | [tekton-task.yaml](tekton-task.yaml) | `kubectl apply -f` | `base-ref` param |
| Argo Workflows | [argo-workflow.yaml](argo-workflow.yaml) | `kubectl apply -f` | `base-ref` param |
| Harness | [harness-pipeline.yaml](harness-pipeline.yaml) | pipeline YAML | `<+codebase.targetBranch>` |
| Buildkite | [buildkite/pipeline.yml](buildkite/pipeline.yml) | `.buildkite/pipeline.yml` | `BUILDKITE_PULL_REQUEST_BASE_BRANCH` |
| Drone / Woodpecker | [drone.yml](drone.yml) | `.drone.yml` | `DRONE_TARGET_BRANCH` |

¹ These platforms expose no target-branch variable, or check out a single commit
with no history. The ratchet is either pointed at the trunk by name — which is
the right comparison on a pull request and a no-op on the trunk itself — or left
off in favour of the absolute budget. Each file says which, and why.

## Configuration

`depwatch-ci.sh` is configured entirely through the environment, because that is
the one thing every platform here agrees on.

| Variable | Default | Description |
| --- | --- | --- |
| `MANIFEST` | `package.json` | Manifest, lock file or SBOM to measure. |
| `MAX_LIBYEARS` | unset | Absolute drift budget. Unset means no gate. |
| `MAX_LIBYEARS_INCREASE` | unset | The ratchet. Needs `BASE_REF`. |
| `MAX_REPLACE` | unset | Cap on dependencies in the *replace* quadrant. |
| `BASE_REF` | unset | What the ratchet compares against. |
| `DEPWATCH_REF` | `main` | Git ref of depwatch to build. **Pin it.** |
| `DEPWATCH_HOME` | `/tmp/depwatch` | Where it is installed. Cache this on `DEPWATCH_REF`. |
| `REPORT` | `./depwatch.json` | Where to write the JSON report. |
| `CHART` | unset | Where to write the quadrant SVG. |
| `FAIL_ON_THRESHOLD` | `true` | `false` to warn instead of failing. |
| `STALE` / `RISKY` | `1` / `0.5` | What counts as behind, and as fading. |
| `TRANSITIVE` / `NO_LOCK` | `false` | Score the whole tree; ignore the lock file. |
| `ECO` | inferred | Force the ecosystem. |

Exit codes are depwatch's own: `0` clean, `1` a threshold was breached, `2` the
manifest could not be read. `FAIL_ON_THRESHOLD=false` softens `1` and
deliberately not `2` — a broken invocation reporting "no drift" is worse than a
red build.

## Why it builds from source

depwatch is not published to a registry, so there is no `npm i -g depwatch`.
The script clones the ref you pin and builds it, which takes a few seconds and
makes exactly what runs auditable. On a platform with a build cache, cache
`DEPWATCH_HOME` keyed on `DEPWATCH_REF`.

For container platforms there is a [Dockerfile](Dockerfile) that bakes the
bundle in, so nothing is cloned at run time:

```sh
docker build -t depwatch --build-arg DEPWATCH_REF=main examples/ci
docker run --rm -v "$PWD:/src" -w /src -e MAX_LIBYEARS=25 depwatch
```

## Adopting a gate

Measure before you gate. `FAIL_ON_THRESHOLD=false` publishes the number and the
report while reporting a breach as a warning — run it for a fortnight, then set
a budget you can defend and turn it back on.
