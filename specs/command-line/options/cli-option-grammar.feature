@domain:command-line @area:options @from:src/flags
Feature: Giving the CLI its options
  Operators and CI pipelines pass options to depwatch commands, and a mistyped or incomplete option must stop the run loudly instead of silently changing what gets measured or gated.

  Background:
    Given the operator runs a depwatch command on a manifest such as package.json

  @id:command-line.options.004 @rule:cli.options.unknown-option-refused @inferred @source:src/flags.ts#parseFlags
  Scenario: An unknown option is refused
    When the operator runs "depwatch check package.json --jsno"
    Then depwatch prints "depwatch: unknown option --jsno" on stderr
    And the command exits with code 2
    And no report is produced

  @id:command-line.options.005 @rule:cli.options.value-required @inferred @source:src/flags.ts#parseFlags
  Scenario Outline: An option that takes a value is refused when the value is missing
    When the operator ends the command line with "<option>" and nothing after it
    Then depwatch prints "depwatch: <option> needs a value" on stderr
    And the command exits with code 2

    Examples:
      | option         |
      | --out          |
      | --baseline     |
      | --accepted     |
      | --eco          |
      | --max-libyears |
      | --stale        |

  @id:command-line.options.006 @rule:cli.options.numeric-value-required @inferred @source:src/flags.ts#parseFlags
  Scenario Outline: A numeric option is refused when its value is not a number
    When the operator runs "depwatch check package.json <option> <value>"
    Then depwatch prints "depwatch: <option> needs a number" on stderr
    And the command exits with code 2

    Examples:
      | option                  | value    |
      | --max-libyears          | ten      |
      | --max-replace           | many     |
      | --max-libyears-increase | Infinity |
      | --max-points            | 12x      |
      | --stale                 | one      |
      | --risky                 | NaN      |

  @id:command-line.options.008 @rule:policy.ratchet.requires-baseline @inferred @source:src/flags.ts#assertConsistent
  Scenario: A drift ratchet without a baseline to compare against is refused
    Given no --baseline option is given
    When the operator runs "depwatch check package.json --ci --max-libyears-increase 0.5"
    Then depwatch prints "depwatch: --max-libyears-increase needs --baseline <file> to compare against" on stderr
    And the command exits with code 2
    And no report is produced

  @id:command-line.options.009 @rule:policy.baselines.write-accepted-default-file @verified @source:src/flags.ts#parseFlags @test:src/cli-baseline.test.ts#takes an explicit filename @test:src/cli-baseline.test.ts#falls back to the shared default filename @test:src/cli-baseline.test.ts#does not swallow the next flag as a filename
  Scenario Outline: Recording accepted findings defaults to the shared baseline file
    When the operator runs "depwatch check package.json <arguments>"
    Then the accepted findings are written to "<file>"
    And the --json switch is <json>

    Examples:
      | arguments                      | file                    | json |
      | --write-accepted accepted.json | accepted.json           | off  |
      | --write-accepted               | .depwatch-baseline.json | off  |
      | --write-accepted --json        | .depwatch-baseline.json | on   |
