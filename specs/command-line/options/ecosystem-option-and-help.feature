@domain:command-line @area:options @from:ecosystems/registry
Feature: Choosing and listing supported ecosystems on the command line
  Lets an operator see which ecosystems and files depwatch recognises, and force an ecosystem for stdin or misnamed files without a typo passing as a clean result.

  @id:command-line.options.001 @rule:cli.options.help-lists-ecosystem-coverage @inferred @source:src/ecosystems/registry.ts#coverageLines @questionable
  Scenario: Help lists every ecosystem with the files it recognises
    When the operator asks depwatch for its usage
    Then the --eco line lists npm|pep440|cargo|composer|rubygems|pub|hex|nuget|cocoapods|conda|helm|go|maven|terraform|githubactions|docker
    And "Ecosystems (files recognised)" has one line per ecosystem, such as "npm: package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock, bun.lockb"
    And pattern-matched inputs are shown by shape, such as "PyPI: pyproject.toml, requirements*.txt, poetry.lock, uv.lock"
    And the Go modules line shows "Go modules: go.mod" and does not mention go.sum, even though go.sum is recognised

  @id:command-line.options.002 @rule:cli.options.eco-must-be-supported @verified @source:src/ecosystems/registry.ts#isEcoId @test:src/ecosystems/registry.test.ts#validates ecosystem ids
  Scenario Outline: A forced ecosystem that depwatch does not support is refused
    When the operator checks a manifest with --eco <name>
    Then <outcome>

    Examples:
      | name  | outcome                                                                                 |
      | maven | depwatch reads the manifest as a Maven Central file                                     |
      | npmm  | depwatch refuses with unsupported ecosystem "npmm" (want one of: npm, pep440, cargo, …) |
      | brew  | depwatch refuses with unsupported ecosystem "brew" (want one of: npm, pep440, cargo, …) |

  @id:command-line.options.003 @rule:cli.options.eco-rejects-object-property-names @inferred @source:src/ecosystems/registry.ts#isEcoId @questionable
  Scenario: A forced ecosystem named like a built-in object property gets past validation
    When the operator checks package.json with --eco constructor
    Then depwatch does not refuse it as an unsupported ecosystem
    And the run fails with an internal error instead of a dependency report
