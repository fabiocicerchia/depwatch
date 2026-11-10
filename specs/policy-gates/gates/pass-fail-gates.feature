@domain:policy-gates @area:gates @from:src/gates
Feature: Failing a check on drift and replace thresholds
  Lets a team running depwatch in CI or the editor turn a report into a pass or a fail, with a reason naming the threshold and the value that crossed it, so the same verdict shows in both places.

  Background:
    Given a report has been produced for the manifest package.json

  @id:policy-gates.gates.003 @rule:policy.gates.unset-gates-never-fail @verified @source:src/gates.ts#gateFailures @test:src/gates.test.ts#passes when no gate is configured, however bad the report
  Scenario: A check with no gates configured always passes
    Given the report's total drift is 40.00 libyears
    And one dependency is in the replace quadrant
    And no gate thresholds are configured
    When the gates are applied to the report
    Then no gate failure is reported

  @id:policy-gates.gates.004 @rule:policy.gates.max-libyears-ceiling @verified @source:src/gates.ts#gateFailures @test:src/gates.test.ts#fails on total drift above --max-libyears @test:src/gates.test.ts#treats the threshold as a ceiling that may be reached
  Scenario Outline: Total drift above the libyears budget fails the check, reaching it does not
    Given the report's total drift is <total> libyears
    And the max-libyears threshold is <max>
    When the gates are applied to the report
    Then the outcome is <outcome>
    And a failing check reports "total drift <total> libyears exceeds --max-libyears <max>"

    Examples:
      | total | max | outcome              |
      | 3.50  | 2   | fail on max-libyears |
      | 2.00  | 2   | pass                 |
      | 1.20  | 2   | pass                 |

  @id:policy-gates.gates.005 @rule:policy.gates.ratchet-limits-growth @verified @source:src/gates.ts#gateFailures @test:src/gates.test.ts#fails when drift grew by more than --max-libyears-increase @test:src/gates.test.ts#passes when drift grew by exactly the allowance @test:src/gates.test.ts#passes on a large total that did not grow @test:src/gates.test.ts#passes when drift shrank @test:src/gates.test.ts#compares at the two decimals every surface reports
  Scenario Outline: Drift may not grow past the allowed increase over the baseline
    Given the baseline total drift is <baseline> libyears
    And the report's total drift is <total> libyears
    And the max-libyears-increase allowance is <allowance>
    When the gates are applied to the report
    Then the outcome is <outcome>

    Examples:
      | baseline | total | allowance | outcome                       |
      | 3.10     | 3.52  | 0.25      | fail on max-libyears-increase |
      | 3.10     | 3.35  | 0.25      | pass                          |
      | 3.10     | 3.52  | 0.42      | pass                          |
      | 40.00    | 40.00 | 0         | pass                          |
      | 9.00     | 1.00  | 0         | pass                          |

  @id:policy-gates.gates.007 @rule:policy.gates.ratchet-needs-baseline @verified @source:src/gates.ts#gateFailures @test:src/gates.test.ts#is inert without a baseline
  Scenario: The drift ratchet does nothing without a baseline
    Given the report's total drift is 40.00 libyears
    And the max-libyears-increase allowance is 0
    And no baseline total drift is given
    When the gates are applied to the report
    Then no gate failure is reported

  @id:policy-gates.gates.008 @rule:policy.gates.max-replace-ceiling @verified @source:src/gates.ts#gateFailures @test:src/gates.test.ts#fails on too many deps in the replace quadrant
  Scenario: Too many dependencies in the replace quadrant fails the check
    Given 2 scored dependencies are in the replace quadrant
    And the max-replace threshold is 1
    When the gates are applied to the report
    Then the check fails on max-replace
    And the reason reads "2 deps in the replace quadrant exceeds --max-replace 1"

  @id:policy-gates.gates.009 @rule:policy.gates.all-breaches-reported @verified @source:src/gates.ts#gateFailures @test:src/gates.test.ts#reports every breached gate, not just the first
  Scenario: Every breached gate is reported, not only the first
    Given the report's total drift is 9.00 libyears
    And one dependency is in the replace quadrant
    And the baseline total drift is 1.00 libyears
    And the max-libyears threshold is 1, the max-libyears-increase allowance is 0 and the max-replace threshold is 0
    When the gates are applied to the report
    Then three failures are reported, in order: max-libyears, max-libyears-increase, max-replace
