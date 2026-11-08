@domain:drift @area:precision @from:src/round
Feature: Reporting drift at two decimals
  Gives everyone reading or gating on drift one agreed precision, so a number shown in a report is the same number a CI gate compares.

  Background:
    Given a manifest whose dependencies have known installed and latest release dates

  @id:drift.precision.001 @rule:drift.precision.two-decimal-figures @inferred @source:src/round.ts#round2 @questionable
  Scenario Outline: Drift, pulse and viability are reported at two decimals
    Given a dependency whose exact drift works out to <raw> libyears
    When the operator checks the manifest
    Then the dependency's drift is reported as <shown> libyears
    And the manifest's total drift is the sum of the dependency drifts, rounded to two decimals

    Examples:
      | raw    | shown                                                       |
      | 2.3456 | 2.35                                                        |
      | 0.004  | 0                                                           |
      | 1.005  | 1 (or 1.01, depending on how the value is stored in binary) |

  @id:drift.precision.002 @rule:drift.precision.ratchet-compares-reported-decimals @verified @source:src/round.ts#round2 @test:src/gates.test.ts#compares at the two decimals every surface reports @test:src/gates.test.ts#fails when drift grew by more than --max-libyears-increase @test:src/gates.test.ts#passes on a large total that did not grow
  Scenario Outline: The drift ratchet judges growth at the precision the report shows
    Given the accepted baseline total drift is <baseline> libyears
    And the drift allowance is set to <allowance> libyears
    When the operator checks the manifest and its total drift is <current> libyears
    Then the drift ratchet <outcome>

    Examples:
      | baseline | current             | allowance | outcome                                                                                        |
      | 3.10     | 3.52                | 0.42      | passes                                                                                         |
      | 0.1      | 0.10000000000000002 | 0         | passes                                                                                         |
      | 40       | 40                  | 0         | passes                                                                                         |
      | 3.10     | 3.52                | 0.25      | fails with "drift grew by 0.42 libyears (3.10 → 3.52), more than --max-libyears-increase 0.25" |
