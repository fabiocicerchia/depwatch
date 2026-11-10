@domain:ecosystem-support @area:javascript @from:ecosystems/bun
Feature: Scoring Bun projects from their lock files
  Lets JavaScript teams who use Bun get exact-version drift from their Bun lock file, and tells them plainly when the lock file is in a format depwatch cannot read.

  Background:
    Given the npm registry publishes the release history of every package in the project

  @id:ecosystem-support.javascript.001 @rule:ecosystems.bun.text-lockfile-exact-versions @verified @source:src/ecosystems/bun.ts#parseBunLock @test:src/ecosystems/python.test.ts#reads bun.lock JSONC (comments, trailing commas)
  Scenario: A Bun text lock file is scored with exact npm versions
    Given a bun.lock file that contains comments and trailing commas
    And it pins "react" at 18.3.1 and "@remix-run/router" at 1.15.0
    When the operator checks the bun.lock file
    Then the report is for the npm ecosystem
    And "react" is listed at version 18.3.1 as an exact version
    And "@remix-run/router" is listed at version 1.15.0 as an exact version

  @id:ecosystem-support.javascript.002 @rule:ecosystems.bun.binary-lockfile-refused @verified @source:src/ecosystems/bun.ts#bunBinaryError @test:src/ecosystems/python.test.ts#gives an actionable error for the binary bun.lockb
  Scenario: A binary Bun lock file is refused with instructions to emit a readable one
    Given a project whose only Bun lock file is the binary bun.lockb
    When the operator checks the bun.lockb file
    Then the check fails without a report
    And the error says bun.lockb is a binary lockfile depwatch cannot read
    And the error tells the operator to run `bun install --save-text-lockfile` or to point depwatch at package.json

  @id:ecosystem-support.javascript.003 @rule:ecosystems.bun.non-registry-entries-skipped @inferred @source:src/ecosystems/bun.ts#parseBunLock
  Scenario Outline: Bun lock entries without a published version number are left out of the report
    Given a bun.lock file that pins "react" at 18.3.1
    And it also has an entry "<name>" whose version is "<version>"
    When the operator checks the bun.lock file
    Then "react" is listed at version 18.3.1
    And "<name>" does not appear in the report

    Examples:
      | name        | version                   |
      | @acme/ui    | workspace:packages/ui     |
      | acme-utils  | github:acme/utils#a1b2c3d |
      | local-lib   | file:../local-lib         |
      | linked-tool | link:linked-tool          |

  @id:ecosystem-support.javascript.004 @rule:ecosystems.bun.one-entry-per-package @inferred @source:src/ecosystems/bun.ts#parseBunLock @questionable
  Scenario: A package locked at several versions in a Bun lock file is reported once, at its first version
    Given a bun.lock file that lists "lodash" at 4.17.21 first
    And it also lists a nested "lodash" at 3.10.1 later in the file
    When the operator checks the bun.lock file
    Then "lodash" appears once in the report
    And "lodash" is listed at version 4.17.21

  @id:ecosystem-support.javascript.005 @rule:ecosystems.bun.unreadable-lockfile-yields-no-dependencies @inferred @source:src/ecosystems/bun.ts#parseJsonc @questionable
  Scenario: A Bun lock file that cannot be read is reported as having no dependencies
    Given a bun.lock file that is not valid JSON even after removing comments and trailing commas
    When the operator checks the bun.lock file
    Then the check fails without a report
    And the error says "no dependencies found in bun.lock"
