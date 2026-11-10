@domain:viability @area:release-signals @from:src/signals
Feature: Judging release activity from a package's version history
  Gives every user a viability reading for every dependency in every ecosystem, using only the release history the registry already returned, so a stalled project shows up without any extra lookups.

  Background:
    Given depwatch has the published versions and release dates of the dependency from its registry

  @id:viability.release-signals.001 @rule:viability.release-signals.pulse-is-days-since-newest-release @verified @source:src/signals.ts#timelineSignals @test:src/viability.test.ts#derives pulse and median cadence from the version list alone
  Scenario: Pulse is the number of days since the newest dated release
    Given the dependency's newest dated release was published 10 days before the moment being scored
    And some of its versions have no release date
    When the user checks the manifest
    Then the dependency's last release age is 10 days
    And versions without a release date are left out of the measurement
    And in a trend run, the age is measured from each sampled commit's date, not from today

  @id:viability.release-signals.002 @rule:viability.release-signals.cadence-is-median-of-recent-gaps @verified @source:src/signals.ts#timelineSignals @test:src/viability.test.ts#derives pulse and median cadence from the version list alone
  Scenario Outline: Release cadence is the median gap between the most recent releases only
    Given the dependency's dated releases are <history>
    When the user checks the manifest
    Then the dependency's release cadence is <cadence> days

    Examples:
      | history                                                                         | cadence |
      | four releases 120, 90, 60 and 10 days ago (gaps 30, 30, 50)                     | 30      |
      | a single dated release                                                          | unknown |
      | 12 releases: the oldest a 1000-day gap before the rest, then 10 gaps of 30 days | 30      |

  @id:viability.release-signals.004 @rule:viability.release-signals.no-dates-means-unknown @verified @source:src/signals.ts#timelineSignals @test:src/viability.test.ts#returns no signals when the registry has no dates
  Scenario: A package whose registry gives no release dates has unknown release signals
    Given none of the dependency's versions has a release date
    When the user checks the manifest
    Then the dependency's last release age is unknown
    And its release cadence is unknown
    And it is not marked archived
