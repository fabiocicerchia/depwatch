@domain:policy-gates @area:ci-integration @from:examples/ci
Feature: Gating a non-GitHub CI pipeline on dependency drift
  Operators running depwatch in CI systems other than GitHub Actions get one script (or image) that measures a manifest, writes the report and turns the configured budgets into a pass or fail build.

  Background:
    Given the operator runs the depwatch CI script in their pipeline
    And the pipeline is configured only through environment variables

  @id:policy-gates.ci-integration.001 @rule:policy-gates.ci-integration.build-outcome-follows-depwatch-exit-codes @inferred @source:examples/ci/depwatch-ci.sh#measure @questionable
  Scenario Outline: The build outcome follows depwatch's exit code, and only a breached threshold can be softened
    Given the manifest check ends with "<check_result>"
    And FAIL_ON_THRESHOLD is "<fail_on_threshold>"
    When the operator runs the CI script
    Then the script exits with code <exit_code>
    And the log shows "<message>"

    Examples:
      | check_result        | fail_on_threshold | exit_code | message                                                      |
      | clean               | true              | 0         | (no outcome message)                                         |
      | threshold breached  | true              | 1         | (no outcome message)                                         |
      | threshold breached  | false             | 0         | depwatch-ci: threshold breached (FAIL_ON_THRESHOLD is false) |
      | manifest unreadable | true              | 2         | depwatch-ci: could not measure package.json                  |
      | manifest unreadable | false             | 2         | depwatch-ci: could not measure package.json                  |

  @id:policy-gates.ci-integration.002 @rule:policy-gates.ci-integration.ratchet-measures-base-branch @inferred @source:examples/ci/depwatch-ci.sh#the ratchet
  Scenario: The drift ratchet measures the base branch and gates on how much drift the change adds
    Given MAX_LIBYEARS_INCREASE is "0.5"
    And BASE_REF is "main"
    And package.json exists on main and measures 12.34 libyears
    When the operator runs the CI script
    Then the log shows "depwatch-ci: main measures 12.34 libyears"
    And the check fails the build when the change's total drift exceeds main's by more than 0.5 libyears

  @id:policy-gates.ci-integration.003 @rule:policy-gates.ci-integration.ratchet-skipped-with-warning @inferred @source:examples/ci/depwatch-ci.sh#the ratchet @questionable
  Scenario Outline: When the base branch cannot be measured, the ratchet is skipped with a warning instead of failing the build
    Given MAX_LIBYEARS_INCREASE is "0.5"
    And <situation>
    When the operator runs the CI script
    Then the log shows "<warning>"
    And the build is gated only by the other configured thresholds

    Examples:
      | situation                                   | warning                                                                   |
      | BASE_REF is not set                         | depwatch-ci: no BASE_REF to compare against — the ratchet is skipped      |
      | the working directory is not a git checkout | depwatch-ci: not a git checkout — the ratchet is skipped                  |
      | the branch main cannot be fetched           | depwatch-ci: could not fetch main — the ratchet is skipped                |
      | package.json does not exist on main         | depwatch-ci: package.json does not exist on main — the ratchet is skipped |
      | package.json on main cannot be measured     | depwatch-ci: could not measure main — the ratchet is skipped              |

  @id:policy-gates.ci-integration.004 @rule:policy-gates.ci-integration.json-report-always-written @inferred @source:examples/ci/depwatch-ci.sh#measure
  Scenario: The JSON report is written even when the build fails on a threshold
    Given MAX_LIBYEARS is "25"
    And the manifest measures 31.2 libyears
    And REPORT is "./out/depwatch.json"
    When the operator runs the CI script
    Then the script exits with code 1
    And ./out/depwatch.json holds the report for the manifest

  @id:policy-gates.ci-integration.005 @rule:policy-gates.ci-integration.chart-optional-and-non-fatal @inferred @source:examples/ci/depwatch-ci.sh#measure
  Scenario: The quadrant chart is written only when asked for, and failing to write it never changes the build outcome
    Given CHART is "depwatch.svg"
    And the chart cannot be written
    When the operator runs the CI script
    Then the log shows "depwatch-ci: could not write depwatch.svg"
    And the script exits with the same code as the gated check
