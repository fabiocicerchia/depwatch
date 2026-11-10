@domain:dependency-discovery @area:direct-vs-transitive @from:src/input
Feature: Counting only the dependencies the project chose
  Keeps total drift a statement about the dependencies a team declared, so the number stays comparable whether or not a lock file was read.

  Background:
    Given the project holds package.json declaring react and lodash
    And package-lock.json beside it also resolves 40 transitive packages

  @id:dependency-discovery.direct-vs-transitive.001 @rule:input.scope.direct-from-manifest-versions-from-lock @inferred @source:src/input.ts#loadManifest
  Scenario: With a lock file, only the dependencies declared in the manifest are counted
    When the operator checks package.json
    Then the report lists react and lodash only
    And each is measured at the version package-lock.json resolved
    And the note says "direct dependencies only; --transitive for the full tree"

  @id:dependency-discovery.direct-vs-transitive.002 @rule:input.scope.transitive-opt-in @inferred @source:src/input.ts#loadManifest
  Scenario: The operator can opt in to counting the whole locked tree
    When the operator checks package.json with --transitive
    Then the report lists react, lodash and the 40 transitive packages
    And the note says "exact versions from package-lock.json (whole tree)"

  @id:dependency-discovery.direct-vs-transitive.003 @rule:input.scope.lock-checked-directly-counts-all @verified @source:src/input.ts#loadManifest @test:src/lockfile.test.ts#does not redirect a lock file to itself @questionable
  Scenario: Checking a lock file directly counts every package it locks
    When the operator checks package-lock.json
    Then the report lists react, lodash and the 40 transitive packages
    And no note about exact versions is shown
