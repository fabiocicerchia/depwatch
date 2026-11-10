@domain:policy-gates @area:baselines @from:src/baseline
Feature: Accepting today's findings and reporting only what gets worse
  Lets a team with a long-running project record the dependency findings it already accepts, so checks and the editor pane show only dependencies whose drift or quadrant has worsened since.

  Background:
    Given the manifest "package.json" is scored into drift and quadrant per dependency

  @id:policy-gates.baselines.002 @rule:policy.baselines.records-only-findings @verified @source:src/baseline.ts#serialise @test:src/baseline.test.ts#records the findings and their drift, worst first @test:src/baseline.test.ts#leaves out healthy and unscorable dependencies, and empty manifests
  Scenario: Recording a baseline accepts only the current findings
    Given "request" is 1.5 libyears behind in the "replace" quadrant
    And "lodash" is 9.2 libyears behind in the "upgrade" quadrant
    And "chalk" is in the "healthy" quadrant
    And "ghost" could not be scored
    When the operator records the current findings as accepted
    Then the baseline lists "request" at 1.5 libyears in "replace" and "lodash" at 9.2 libyears in "upgrade", worst first
    And the baseline does not list "chalk" or "ghost"
    And a manifest with no findings does not appear in the baseline at all

  @id:policy-gates.baselines.003 @rule:policy.baselines.further-drift-resurfaces @verified @source:src/baseline.ts#acceptedIn @test:src/baseline.test.ts#accepts a dependency that has not changed @test:src/baseline.test.ts#accepts one that improved @test:src/baseline.test.ts#surfaces one that drifted further @test:src/baseline.test.ts#does not let rounding count as worse @test:src/cli-baseline.test.ts#still reports a dependency that got worse
  Scenario Outline: A dependency that drifted further than accepted is reported again
    Given a baseline accepted "drifter" at 2 libyears in the "upgrade" quadrant
    And "drifter" is now <current> libyears behind in the "upgrade" quadrant
    When the operator runs a check against the baseline
    Then "drifter" is <shown> in the report

    Examples:
      | current | shown     |
      | 2       | not shown |
      | 0.5     | not shown |
      | 2.004   | not shown |
      | 2.6     | shown     |

  @id:policy-gates.baselines.004 @rule:policy.baselines.worse-quadrant-resurfaces @verified @source:src/baseline.ts#acceptedIn @test:src/baseline.test.ts#surfaces one that fell to a worse quadrant at the same drift @test:src/baseline.test.ts#accepts a dependency that has not changed @test:src/cli-baseline.test.ts#still reports a dependency that fell to a worse quadrant
  Scenario Outline: A dependency that fell to a worse quadrant is reported again even at the same drift
    Given a baseline accepted "dying" at 0 libyears in the "<accepted>" quadrant
    And "dying" is now 0 libyears behind in the "<now>" quadrant
    When the operator runs a check against the baseline
    Then "dying" is <shown> in the report

    Examples:
      | accepted | now     | shown     |
      | watch    | watch   | not shown |
      | watch    | replace | shown     |
      | upgrade  | replace | shown     |

  @id:policy-gates.baselines.005 @rule:policy.baselines.unrecorded-dependency-reported @verified @source:src/baseline.ts#acceptedIn @test:src/baseline.test.ts#accepts nothing for a manifest, or a dependency, it has never seen @test:src/cli-baseline.test.ts#still reports a dependency that was not there when it was written
  Scenario Outline: A dependency or manifest the baseline never recorded is always reported
    Given a baseline for "package.json" accepted "request" and "lodash"
    And <situation>
    When the operator runs a check against the baseline
    Then <reported> appears in the report

    Examples:
      | situation                                                              | reported                              |
      | "left-pad" was added since and is in the "replace" quadrant            | "left-pad"                            |
      | the check is of "other/package.json", which the baseline does not list | every finding of "other/package.json" |

  @id:policy-gates.baselines.007 @rule:policy.baselines.unreadable-baseline-accepts-nothing @verified @source:src/baseline.ts#parse @test:src/baseline.test.ts#rejects nonsense and unknown versions @test:src/cli-baseline.test.ts#ignores a baseline it cannot understand rather than accepting nothing silently
  Scenario Outline: A baseline that cannot be understood accepts nothing
    Given the baseline file is <content>
    When the operator runs a check against the baseline
    Then the operator sees a warning that the file is not a baseline this version understands and is being ignored
    And every finding appears in the report

    Examples:
      | content                          |
      | not valid JSON                   |
      | written with baseline version 99 |
      | missing its list of manifests    |
