@domain:ecosystem-support @area:infrastructure @from:ecosystems/gh-actions
Feature: Measuring GitHub Actions used by workflows
  Lets a team see how far behind, and how viable, the third-party actions and reusable workflows its CI depends on are, the same way it sees its package dependencies.

  Background:
    Given depwatch scores GitHub Actions using release history published on GitHub

  @id:ecosystem-support.infrastructure.008 @rule:ecosystems.gh-actions.workflow-files-recognised @verified @source:src/ecosystems/gh-actions.ts#githubActions @test:src/ecosystems/phase4.test.ts#reads uses refs from a workflow, skipping local and docker @questionable
  Scenario Outline: Workflow files and action definitions are read as GitHub Actions manifests
    Given a repository containing the file "<file>"
    When the operator checks "<file>"
    Then the manifest is reported under the ecosystem "githubactions"

    Examples:
      | file                           |
      | .github/workflows/ci.yml       |
      | .github/workflows/release.yaml |
      | action.yml                     |
      | action.yaml                    |

  @id:ecosystem-support.infrastructure.009 @rule:ecosystems.gh-actions.uses-refs-are-dependencies @verified @source:src/ecosystems/gh-actions.ts#parseUses @test:src/ecosystems/phase4.test.ts#reads uses refs from a workflow, skipping local and docker
  Scenario Outline: Each remote action or reusable workflow a workflow uses is a dependency named by its repository
    Given a workflow with the step "uses: <uses>"
    When the operator checks the workflow
    Then the report lists <outcome>

    Examples:
      | uses                                      | outcome                     |
      | actions/checkout@v4.1.1                   | actions/checkout at v4.1.1  |
      | actions/setup-node@v4                     | actions/setup-node at v4    |
      | some/reusable/.github/workflows/wf.yml@v1 | some/reusable at v1         |
      | ./.github/actions/local                   | no dependency for that step |
      | docker://alpine:3.19                      | no dependency for that step |

  @id:ecosystem-support.infrastructure.010 @rule:ecosystems.gh-actions.one-entry-per-action @inferred @source:src/ecosystems/gh-actions.ts#parseUses @questionable
  Scenario: An action used several times appears once, at the version it is first used with
    Given a workflow that uses "actions/checkout@v3.6.0" in its first job
    And the same workflow uses "actions/checkout@v4.1.1" in a later job
    When the operator checks the workflow
    Then the report lists actions/checkout once
    And its current version is v3.6.0

  @id:ecosystem-support.infrastructure.011 @rule:ecosystems.gh-actions.only-exact-tags-count-as-pinned @verified @source:src/ecosystems/gh-actions.ts#isExactTag @test:src/ecosystems/phase4.test.ts#reads uses refs from a workflow, skipping local and docker @questionable
  Scenario Outline: Only a full version tag counts as a pinned action; a moving major tag or a commit SHA is an estimate
    Given a workflow that uses "<uses>"
    When the operator checks the workflow
    Then the dependency is <treatment>

    Examples:
      | uses                                                   | treatment                                                |
      | actions/checkout@v4.1.1                                | treated as an exact pin                                  |
      | actions/checkout@4.1.1                                 | treated as an exact pin                                  |
      | actions/setup-node@v4                                  | counted in the "upper bound" note as coming from a range |
      | actions/cache@0b2256b8c012f0828dc542b3febcab082c67f72b | counted in the "upper bound" note as coming from a range |

  @id:ecosystem-support.infrastructure.012 @rule:ecosystems.gh-actions.versions-from-releases-then-tags @inferred @source:src/ecosystems/gh-actions.ts#githubActions
  Scenario Outline: An action's version history comes from its published GitHub releases, or from its tags when it has none
    Given the repository "<repo>" <history>
    When the operator checks a workflow that uses "<repo>"
    Then the versions considered for "<repo>" are <versions>

    Examples:
      | repo               | history                                                             | versions                                                  |
      | acme/deploy-action | has published releases v2.0.0 and v2.1.0 and a draft release v3.0.0 | v2.0.0 and v2.1.0, dated by their publish dates           |
      | acme/lint-action   | has no releases but tags v1.0.0 and v1.1.0                          | v1.0.0 and v1.1.0, dated by the commit each tag points to |

  @id:ecosystem-support.infrastructure.013 @rule:ecosystems.gh-actions.github-token-raises-limit @inferred @source:src/ecosystems/gh-actions.ts#ghHeaders
  Scenario: A GitHub token in the environment is used for every GitHub Actions lookup
    Given the operator has set GITHUB_TOKEN in the environment
    When the operator checks a workflow
    Then every GitHub request for its actions is made as that token's identity rather than anonymously

  @id:ecosystem-support.infrastructure.014 @rule:ecosystems.gh-actions.unreachable-action-is-unscored @inferred @source:src/ecosystems/gh-actions.ts#ghJson
  Scenario: An action GitHub cannot answer for is reported as unscored instead of failing the run
    Given GitHub refuses lookups for "acme/deploy-action" because the rate limit is exhausted
    And the workflow also uses "actions/checkout@v4.1.1", which GitHub answers
    When the operator checks the workflow
    Then actions/checkout is scored
    And the report says "1 dep(s) had no registry data and were not scored"
    And the check still produces a report

  @id:ecosystem-support.infrastructure.015 @rule:ecosystems.gh-actions.sbom-github-purls-scored-as-actions @inferred @source:src/ecosystems/gh-actions.ts#githubActions @questionable
  Scenario Outline: SBOM components with a GitHub package URL are scored as GitHub Actions
    Given a CycloneDX SBOM with the component "<purl>"
    When the operator checks the SBOM
    Then the component is scored in the ecosystem "githubactions" as actions/checkout

    Examples:
      | purl                                      |
      | pkg:githubactions/actions/checkout@v4.1.1 |
      | pkg:github/actions/checkout@v4.1.1        |
