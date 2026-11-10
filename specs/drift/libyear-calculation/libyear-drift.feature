@domain:drift @area:libyear-calculation @from:libyear/engine
Feature: Measuring dependency drift in libyears
  Gives teams an objective, gateable number for how far each dependency and the whole manifest lag behind the newest releases.

  Background:
    Given the registry publishes each version of a package with its release date

  @id:drift.libyear-calculation.001 @rule:drift.libyears.age-gap-to-newest-stable @verified @source:src/lib/libyear/engine.ts#libyearsForDep @test:src/lib/engine.test.ts#measures the age gap between what you run and what is current
  Scenario: Drift is the time between the release you run and the newest stable release
    Given package "left-pad" published 1.0.0 on 2022-01-01, 2.0.0 on 2024-01-01 and 3.0.0-rc.1 on 2024-06-01
    And the manifest runs "left-pad" at 1.0.0
    When the operator checks the manifest
    Then "left-pad" shows latest version 2.0.0
    And "left-pad" is 2 libyears behind

  @id:drift.libyear-calculation.002 @rule:drift.libyears.prerelease-only-package-has-latest @inferred @source:src/lib/libyear/engine.ts#libyearsForDep
  Scenario: A package that has only ever shipped prereleases is measured against its newest prerelease
    Given package "nightly-kit" published only 0.1.0-beta.1 on 2023-01-01 and 0.2.0-beta.1 on 2024-01-01
    And the manifest runs "nightly-kit" at 0.1.0-beta.1
    When the operator checks the manifest
    Then "nightly-kit" shows latest version 0.2.0-beta.1
    And "nightly-kit" is 1 libyear behind

  @id:drift.libyear-calculation.003 @rule:drift.libyears.range-floor-matches-nearest-release @verified @source:src/lib/libyear/engine.ts#matchVersion @test:src/lib/engine.test.ts#matches a range floor to the release it names
  Scenario Outline: A version taken from a range is matched to the newest release at or below it
    Given package "left-pad" published 1.0.0 on 2022-01-01 and 2.0.0 on 2024-01-01
    And the manifest declares "left-pad" with range <declared>
    When the operator checks the manifest
    Then "left-pad" is dated as running <matched>
    And "left-pad" is <libyears> libyears behind

    Examples:
      | declared | matched | libyears |
      | ^1.0     | 1.0.0   | 2        |
      | ^1.5     | 1.0.0   | 2        |
      | ^2.0     | 2.0.0   | 0        |

  @id:drift.libyear-calculation.004 @rule:drift.libyears.undatable-scores-zero @verified @source:src/lib/libyear/engine.ts#libyearsForDep @test:src/lib/engine.test.ts#reports unknown as zero rather than guessing @questionable
  Scenario Outline: A dependency that cannot be dated scores zero drift rather than a guess
    Given <situation>
    When the operator checks the manifest
    Then the dependency is 0 libyears behind
    And its pulse is <pulse>

    Examples:
      | situation                                                         | pulse                                 |
      | the registry gives no release dates for any version               | not shown                             |
      | the manifest runs 0.5.0 but the oldest published version is 1.0.0 | measured from the latest release date |

  @id:drift.libyear-calculation.005 @rule:drift.libyears.never-negative @inferred @source:src/lib/libyear/engine.ts#libyearsForDep
  Scenario Outline: Running a version newer than the latest stable release never reports negative drift
    Given package "left-pad" published 1.0.0 on 2022-01-01, 2.0.0 on 2024-01-01 and 3.0.0-rc.1 on 2024-06-01
    And the manifest runs "left-pad" at <running>
    When the operator checks the manifest
    Then "left-pad" is 0 libyears behind

    Examples:
      | running    |
      | 2.0.0      |
      | 3.0.0-rc.1 |

  @id:drift.libyear-calculation.006 @rule:drift.libyears.pulse-since-latest-release @verified @source:src/lib/libyear/engine.ts#libyearsForDep @test:src/lib/engine.test.ts#measures the age gap between what you run and what is current
  Scenario: Pulse is the time since the package last shipped a stable release, measured at the scoring date
    Given package "left-pad" published its latest stable release 2.0.0 on 2024-01-01
    And the manifest is scored as of 2025-01-01
    When the operator checks the manifest
    Then "left-pad" shows a pulse of 1 year

  @id:drift.libyear-calculation.007 @rule:drift.libyears.manifest-total-and-worst-five @verified @source:src/lib/libyear/engine.ts#buildReport @test:src/lib/engine.test.ts#totals drift across the manifest
  Scenario Outline: A manifest's total drift is the sum of its dependencies' drift, and the five furthest behind are named
    Given the manifest has dependencies at <drifts> libyears behind
    When the operator checks the manifest
    Then the total drift is <total> libyears
    And the worst offenders listed are <worst>

    Examples:
      | drifts                                | total | worst         |
      | a 2, b 0                              | 2     | a, b          |
      | a 1.25, b 3.5, c 0.4, d 2, e 0.1, f 5 | 12.25 | f, b, d, a, c |
