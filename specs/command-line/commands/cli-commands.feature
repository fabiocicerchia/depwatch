@domain:command-line @area:commands @from:src/cli
Feature: Running depwatch from the command line
  Gives operators and CI pipelines a predictable check, chart and trend command whose exit code and output streams they can script against.

  Background:
    Given a project with a dependency manifest at "package.json"

  @id:command-line.commands.001 @rule:cli.commands.usage-and-misuse-exit-codes @inferred @source:src/cli.ts#main
  Scenario Outline: Asking for help succeeds while a malformed invocation is refused with the usage text
    Given the operator has depwatch installed
    When the operator runs depwatch with arguments <args>
    Then the usage text is printed to <stream>
    And the exit code is <code>

    Examples:
      | args               | stream | code |
      | --help             | stdout | 0    |
      | -h                 | stdout | 0    |
      | (none)             | stdout | 2    |
      | check              | stderr | 2    |
      | audit package.json | stderr | 2    |

  @id:command-line.commands.002 @rule:cli.commands.failure-exits-with-message @inferred @source:src/cli.ts#main
  Scenario: A run that cannot complete reports why and exits with code 2
    Given the manifest "missing/package.json" does not exist
    When the operator runs "depwatch check missing/package.json"
    Then stderr shows a line starting with "depwatch:" followed by the reason
    And the exit code is 2

  @id:command-line.commands.003 @rule:cli.check.gates-apply-only-under-ci @inferred @source:src/cli.ts#checkCommand
  Scenario Outline: Thresholds fail the check only when CI mode is on
    Given the manifest's total drift is 7.40 libyears
    When the operator runs "depwatch check package.json --max-libyears 5 <ci>"
    Then the two-axis table is printed to stdout
    And stderr <message>
    And the exit code is <code>

    Examples:
      | ci        | message                                                              | code |
      | --ci      | shows "depwatch: total drift 7.40 libyears exceeds --max-libyears 5" | 1    |
      | (omitted) | shows no gate message                                                | 0    |

  @id:command-line.commands.004 @rule:cli.check.unusable-ratchet-baseline-refused @inferred @source:src/cli.ts#readBaseline
  Scenario: A drift ratchet against an unusable previous report is refused rather than passed
    Given "previous.json" is a truncated report with no total drift in it
    When the operator runs "depwatch check package.json --ci --max-libyears-increase 0 --baseline previous.json"
    Then stderr shows "depwatch: baseline previous.json has no usable totalLibyears"
    And the exit code is 2

  @id:command-line.commands.005 @rule:cli.output.json-stdout-stays-clean @inferred @source:src/cli.ts#loadReport
  Scenario Outline: JSON output carries only the report, with input notes withheld
    Given a lock file sits beside the manifest, so depwatch has a note about which file it measured
    When the operator runs "depwatch check package.json <format>"
    Then stdout contains <stdout>
    And stderr <notes>

    Examples:
      | format    | stdout               | notes                                            |
      | --json    | only the JSON report | shows no "depwatch:" input notes                 |
      | (omitted) | the two-axis table   | shows the input notes, each prefixed "depwatch:" |

  @id:command-line.commands.006 @rule:cli.chart.title-shows-total-drift @inferred @source:src/cli.ts#chartCommand @questionable
  Scenario: The quadrant chart is titled with the manifest and its total drift
    Given the manifest's total drift is 7.4 libyears
    When the operator runs "depwatch chart package.json --out chart.svg"
    Then "chart.svg" contains an SVG chart titled "package.json — drift × viability (7.40 libyears)"
    And nothing is written to stdout
    And the exit code is 0
