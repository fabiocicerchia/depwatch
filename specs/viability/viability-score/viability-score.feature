@domain:viability @area:viability-score @from:src/viability
Feature: Scoring dependency viability
  Gives every dependency a 0-to-1 viability score (higher is healthier), so that maintainers can tell a dependency they can catch up on from one whose project is dying, and missing data never counts against it.

  Background:
    Given the report shows each dependency's viability score from 0 to 1, rounded to two decimals

  @id:viability.viability-score.001 @rule:viability.score.archived-is-terminal @verified @source:src/viability.ts#viabilityScore @test:src/viability.test.ts#treats archived as terminal regardless of everything else
  Scenario: An archived project scores zero whatever its other signals say
    Given a dependency whose repository is archived
    And it released yesterday, has 20 maintainers, a 14-day release cadence and funding
    When the operator checks the manifest
    Then the dependency's viability score is 0

  @id:viability.viability-score.002 @rule:viability.score.unknown-when-no-signals @verified @source:src/viability.ts#viabilityScore @test:src/viability.test.ts#is unknown, not dead, when nothing could be fetched
  Scenario Outline: A dependency with no viability data scores neutral, not dead
    Given a dependency for which no release dates, commits, maintainers or issues could be obtained
    And <funding>
    When the operator checks the manifest
    Then the dependency's viability score is 0.5

    Examples:
      | funding           |
      | it has no funding |
      | it has funding    |

  @id:viability.viability-score.003 @rule:viability.score.release-pulse-decay @verified @source:src/viability.ts#viabilityScore @test:src/viability.test.ts#renormalises rather than penalising missing signals
  Scenario Outline: Release recency alone scores fully alive within six months and dead after three years
    Given a dependency whose only known signal is that its latest release was <age> days ago
    When the operator checks the manifest
    Then the dependency's viability score is <score>

    Examples:
      | age   | score |
      | 10    | 1     |
      | 180   | 1     |
      | 637.5 | 0.5   |
      | 1095  | 0     |
      | 2000  | 0     |

  @id:viability.viability-score.004 @rule:viability.score.missing-signals-renormalised @verified @source:src/viability.ts#viabilityScore @test:src/viability.test.ts#lets pulse outweigh a healthy historical cadence once a package stops
  Scenario Outline: Missing signals are left out of the weighting instead of counting against the dependency
    Given a dependency that released <release> days ago with a median release gap of <cadence> days
    And no commit, maintainer or issue data is available
    When the operator checks the manifest
    Then the dependency's viability score is <score>

    Examples:
      | release | cadence | score |
      | 1970    | 30      | 0.33  |
      | 30      | 60      | 1     |

  @id:viability.viability-score.005 @rule:viability.score.bus-factor @verified @source:src/viability.ts#busFactor @test:src/viability.test.ts#penalises a bus factor of one
  Scenario Outline: A dependency with fewer maintainers scores lower
    Given a dependency whose only known signal is that it has <maintainers> maintainers
    When the operator checks the manifest
    Then the dependency's viability score is <score>

    Examples:
      | maintainers | score |
      | 0           | 0     |
      | 1           | 0.4   |
      | 2           | 0.7   |
      | 3           | 1     |
      | 6           | 1     |

  @id:viability.viability-score.006 @rule:viability.score.funding-nudge-capped @verified @source:src/viability.ts#viabilityScore @test:src/viability.test.ts#lets funding nudge but never rescue
  Scenario Outline: Funding adds a small bonus but never lifts the score above 1
    Given a dependency whose signals alone score <base>
    And it has funding
    When the operator checks the manifest
    Then the dependency's viability score is <score>

    Examples:
      | base | score |
      | 0.5  | 0.55  |
      | 0    | 0.05  |
      | 1    | 1     |

  @id:viability.viability-score.007 @rule:viability.score.calibrated-profiles @verified @source:src/viability.ts#viabilityScore @test:src/viability.test.ts#scores a thriving project high @test:src/viability.test.ts#puts a stable, slow-moving, well-staffed library in the middle, not the danger zone @test:src/viability.test.ts#scores an abandoned-but-not-archived project low
  Scenario Outline: Thriving, finished and abandoned projects land in distinct viability bands
    Given a dependency with a <profile> profile
    When the operator checks the manifest
    Then the dependency's viability score is <band>

    Examples:
      | profile                                                                                              | band                |
      | thriving: released 20 days ago, committed 3 days ago, 30-day cadence, 6 maintainers, 20% issues open | above 0.9           |
      | finished: released 365 days ago, committed 60 days ago, yearly cadence, 3 maintainers                | between 0.5 and 0.9 |
      | abandoned: released 1500 days ago, committed 1200 days ago, 800-day cadence, 1 maintainer            | below 0.1           |
