@domain:drift @area:version-comparison @from:lib/semver
Feature: Ordering versions to find installed and newest releases
  Gives operators a drift figure they can trust by ranking the version strings of npm, PyPI, Cargo, Composer and RubyGems packages on their numbers, the same way across all of them, and telling stable releases apart from prereleases.

  Background:
    Given a package's registry has published a list of version strings

  @id:drift.version-comparison.001 @rule:drift.version-comparison.numeric-ordering @verified @source:src/lib/semver.ts#compareVersions @test:src/lib/engine.test.ts#ranks by the numeric core, not by string
  Scenario Outline: Versions rank by their numbers, not alphabetically, and a release after its own prereleases
    Given the registry lists versions "<a>" and "<b>"
    When depwatch compares "<a>" with "<b>"
    Then "<a>" ranks <relation> "<b>"

    Examples:
      | a      | b          | relation    |
      | 1.10.0 | 1.9.0      | after       |
      | 1.2    | 1.2.0      | the same as |
      | v2.0.0 | 2.0.0      | the same as |
      | =3.1.0 | 3.1.0      | the same as |
      | 2.0.0  | 10.0.0     | before      |
      | 1.0.0  | 1.0.0-rc.1 | after       |

  @id:drift.version-comparison.002 @rule:drift.version-comparison.prerelease-classification @verified @source:src/lib/semver.ts#isPrerelease @test:src/lib/engine.test.ts#puts a release ahead of its own prereleases
  Scenario Outline: A version is a prerelease when anything but build metadata or a post-release follows its numbers
    Given the registry lists version "<version>"
    When depwatch classifies "<version>"
    Then "<version>" is treated as <kind>

    Examples:
      | version       | kind             |
      | 1.0.0-rc.1    | a prerelease     |
      | 2.0.0b1       | a prerelease     |
      | 1.4.0.dev3    | a prerelease     |
      | 1.2.3         | a stable release |
      | 1.2.3+build.5 | a stable release |
      | 1.2.post1     | a stable release |
      | 1.0-r2        | a stable release |

  @id:drift.version-comparison.004 @rule:drift.version-comparison.same-core-prereleases-tie @inferred @source:src/lib/semver.ts#compareVersions @questionable
  Scenario: Prereleases of the same release rank as equal
    Given the registry lists only versions "2.0.0-rc.1" and "2.0.0-rc.2"
    When depwatch compares "2.0.0-rc.2" with "2.0.0-rc.1"
    Then the two versions rank the same
    And the newest release reported for a package that has only these prereleases is whichever one the registry lists first

  @id:drift.version-comparison.005 @rule:drift.version-comparison.non-numeric-ranks-lowest @inferred @source:src/lib/semver.ts#versionCore @questionable
  Scenario: A version with no leading number ranks below every numbered release
    Given the registry lists versions "dev-main" and "0.1.0"
    When depwatch compares "dev-main" with "0.1.0"
    Then "dev-main" ranks before "0.1.0"
    And "dev-main" is treated as a prerelease
