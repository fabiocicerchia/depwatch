@domain:dependency-discovery @area:manifest-detection @from:src/input
Feature: Reading the lock file beside a manifest
  Serves anyone measuring a project: drift is read from exact installed versions whenever the lock file is right there, instead of from range floors that overstate it.

  Background:
    Given the operator runs depwatch check on a manifest in a project directory

  @id:dependency-discovery.manifest-detection.004 @rule:input.lock.prefer-adjacent-lock @verified @source:src/input.ts#resolveInput @test:src/lockfile.test.ts#prefers the lock file sitting next to the manifest @test:src/lockfile.test.ts#honours the yarn and pnpm lock files too @test:src/lockfile.test.ts#finds Cargo.lock and composer.lock
  Scenario Outline: The lock file beside a manifest is read instead of the manifest
    Given the project holds <manifest> and <lock> side by side
    When the operator checks <manifest>
    Then the versions measured are the exact ones in <lock>
    And the operator sees "depwatch: exact versions from <lock> (direct dependencies only; --transitive for the full tree)" on stderr
    And the report names its source as "<manifest> + <lock>"

    Examples:
      | manifest      | lock              |
      | package.json  | package-lock.json |
      | package.json  | yarn.lock         |
      | package.json  | pnpm-lock.yaml    |
      | Cargo.toml    | Cargo.lock        |
      | composer.json | composer.lock     |

  @id:dependency-discovery.manifest-detection.005 @rule:input.lock.manifest-when-no-lock @verified @source:src/input.ts#resolveInput @test:src/lockfile.test.ts#leaves the manifest alone when there is no lock file
  Scenario: A manifest without a lock file beside it is read as it is
    Given the project holds package.json and no lock file
    When the operator checks package.json
    Then the versions measured are the floors of the ranges in package.json
    And no note about exact versions is shown

  @id:dependency-discovery.manifest-detection.006 @rule:input.lock.no-lock-opt-out @verified @source:src/input.ts#resolveInput @test:src/lockfile.test.ts#respects --no-lock
  Scenario: The operator can opt out of reading the lock file
    Given the project holds package.json and package-lock.json side by side
    When the operator checks package.json with --no-lock
    Then the versions measured are the floors of the ranges in package.json
    And no note about exact versions is shown

  @id:dependency-discovery.manifest-detection.007 @rule:input.lock.go-sum-is-not-a-lock @verified @source:src/input.ts#resolveInput @test:src/lockfile.test.ts#does not read go.sum in place of go.mod
  Scenario: A Go module is measured from go.mod even when go.sum sits beside it
    Given the project holds go.mod and go.sum side by side
    When the operator checks go.mod
    Then the dependencies measured are the requires listed in go.mod
    And no note about exact versions is shown

  @id:dependency-discovery.manifest-detection.008 @rule:input.manifest.empty-is-refused @inferred @source:src/input.ts#loadManifest @questionable
  Scenario: A file with nothing to score is refused rather than reported clean
    Given the project holds a package.json that declares no dependencies and no lock file
    When the operator checks package.json
    Then the run fails with "no dependencies found in package.json"
    And no report is produced
