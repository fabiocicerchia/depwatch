@domain:policy-gates @area:baselines @from:src/cli
Feature: Accepting today's findings
  Lets a team adopt depwatch on an already-behind project by accepting current findings so checks report only what has got worse since.

  Background:
    Given a project with a dependency manifest at "package.json"
    And "request" is in the replace quadrant at 1.5 libyears behind and "lodash" is in the upgrade quadrant at 9.2 libyears behind

  @id:policy-gates.baselines.008 @rule:baselines.accept.write-records-current-findings @verified @source:src/cli.ts#writeAccepted @test:src/cli-baseline.test.ts#falls back to the shared default filename
  Scenario: Recording accepted findings stores every current finding and prints no report
    Given "react" is healthy
    When the operator runs "depwatch check package.json --write-accepted"
    Then ".depwatch-baseline.json" is written
    And stderr shows "depwatch: 2 finding(s) accepted in .depwatch-baseline.json"
    And no report is printed to stdout
    And the exit code is 0, even with --ci

  @id:policy-gates.baselines.009 @rule:baselines.accept.unchanged-findings-hidden @verified @source:src/cli.ts#applyBaseline @test:src/cli-baseline.test.ts#accepts everything it recorded
  Scenario: Accepted findings that have not got worse disappear from the check and its total
    Given both findings were accepted in ".depwatch-baseline.json"
    And neither has drifted further nor changed quadrant
    When the operator runs "depwatch check package.json"
    Then no dependencies are listed
    And the total drift is 0.00 libyears
    And stderr shows "depwatch: 2 finding(s) accepted by .depwatch-baseline.json"

  @id:policy-gates.baselines.010 @rule:baselines.accept.worsened-findings-resurface @verified @source:src/baseline.ts#acceptedIn @test:src/cli-baseline.test.ts#still reports a dependency that got worse @test:src/cli-baseline.test.ts#still reports a dependency that fell to a worse quadrant @test:src/cli-baseline.test.ts#still reports a dependency that was not there when it was written
  Scenario Outline: A finding that got worse since it was accepted is reported again
    Given both findings were accepted in ".depwatch-baseline.json"
    And <change>
    When the operator runs "depwatch check package.json"
    Then only "<reported>" is listed

    Examples:
      | change                                                             | reported |
      | "lodash" has drifted to 11 libyears behind                         | lodash   |
      | "lodash" has fallen into the replace quadrant                      | lodash   |
      | a new dependency "left-pad" in the replace quadrant has been added | left-pad |

  @id:policy-gates.baselines.011 @rule:baselines.accept.gates-judge-only-unaccepted @inferred @source:src/cli.ts#checkCommand @questionable
  Scenario: CI thresholds are judged only on findings that were not accepted
    Given both findings were accepted in ".depwatch-baseline.json"
    When the operator runs "depwatch check package.json --ci --max-replace 0"
    Then no gate failure is reported
    And the exit code is 0

  @id:policy-gates.baselines.012 @rule:baselines.accept.missing-or-unreadable-file @verified @source:src/cli.ts#applyBaseline @test:src/cli-baseline.test.ts#errors on a named baseline that is not there @test:src/cli-baseline.test.ts#reports everything when the default file is simply absent @test:src/cli-baseline.test.ts#ignores a baseline it cannot understand rather than accepting nothing silently
  Scenario Outline: A named accepted-findings file must exist, while an absent default or unknown format accepts nothing
    Given <state>
    When the operator runs "depwatch check package.json <option>"
    Then <outcome>

    Examples:
      | state                                                     | option                 | outcome                                                                                                                      |
      | "nope.json" does not exist                                | --accepted nope.json   | the check stops with "depwatch: no such baseline: nope.json" and exit code 2                                                 |
      | there is no ".depwatch-baseline.json"                     | (none)                 | both findings are reported                                                                                                   |
      | "broken.json" is not in a format this version understands | --accepted broken.json | stderr warns "depwatch: broken.json is not a baseline this version understands — ignoring it" and both findings are reported |

  @id:policy-gates.baselines.013 @rule:baselines.accept.manifest-keyed-relative-to-file @verified @source:src/cli.ts#labelFor @test:src/cli-baseline.test.ts#is relative to the baseline, so CI and the editor agree @test:src/cli-baseline.test.ts#always uses forward slashes
  Scenario: Accepted findings match a manifest however its path was given
    Given ".depwatch-baseline.json" at the repository root accepted the findings of "src/app/package.json"
    When the operator runs "depwatch check /repo/src/app/package.json --accepted /repo/.depwatch-baseline.json"
    Then the manifest is matched under "src/app/package.json", with forward slashes
    And its accepted findings are hidden
