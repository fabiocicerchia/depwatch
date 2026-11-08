@domain:ecosystem-support @area:javascript @from:ecosystems/npm
Feature: Reading npm and Bun projects
  Lets JavaScript teams measure drift from package.json or any npm, Yarn, pnpm or Bun lock file, and get maintainer signals from the npm registry.

  Background:
    Given the project uses the npm ecosystem

  @id:ecosystem-support.javascript.006 @rule:npm.lockfiles.content-decides-format @inferred @source:src/ecosystems/npm.ts#npm
  Scenario Outline: A file is read by what it contains, not what it is called
    Given a file named "<file_name>" whose contents are a <actual_format>
    When the operator checks the file
    Then the dependencies are read as a <actual_format>
    And their versions are <version_kind>

    Examples:
      | file_name         | actual_format                                     | version_kind             |
      | package.json      | package-lock.json lock (it has a lockfileVersion) | exact, resolved versions |
      | deps.txt          | Yarn lock ("# yarn lockfile v1" header)           | exact, resolved versions |
      | package-lock.json | pnpm lock ("lockfileVersion:" YAML)               | exact, resolved versions |
      | package-lock.json | package.json manifest with dependencies           | declared version ranges  |

  @id:ecosystem-support.javascript.007 @rule:npm.lockfiles.filename-fallback @inferred @source:src/ecosystems/npm.ts#npm @questionable
  Scenario Outline: Unrecognisable content falls back to the file's name, then to package.json
    Given a file named "<file_name>" whose contents match no known npm format
    When the operator checks the file
    Then the file is read as a <read_as>

    Examples:
      | file_name         | read_as                |
      | package-lock.json | package-lock.json lock |
      | yarn.lock         | Yarn lock              |
      | pnpm-lock.yaml    | pnpm lock              |
      | package.json      | package.json manifest  |
      | deps.json         | package.json manifest  |

  @id:ecosystem-support.javascript.008 @rule:npm.bun.text-lock-exact-versions @verified @source:src/ecosystems/bun.ts#parseBunLock @test:src/ecosystems/python.test.ts#reads bun.lock JSONC (comments, trailing commas)
  Scenario: A Bun text lock file reports each package's exact installed version
    Given a bun.lock that has comments and trailing commas
    And it lists react@18.3.1 and @remix-run/router@1.15.0
    When the operator checks the bun.lock
    Then react is reported at 18.3.1 as an installed version
    And @remix-run/router is reported at 1.15.0 as an installed version
    And the result is in the npm ecosystem

  @id:ecosystem-support.javascript.009 @rule:npm.bun.binary-lock-refused @verified @source:src/ecosystems/bun.ts#bunBinaryError @test:src/ecosystems/python.test.ts#gives an actionable error for the binary bun.lockb
  Scenario: A binary Bun lock file is refused with instructions for producing a readable one
    Given a project whose only lock file is the binary bun.lockb
    When the operator checks the bun.lockb
    Then the check fails with "bun.lockb is a binary lockfile depwatch cannot read"
    And the message tells the operator to run `bun install --save-text-lockfile` or to point depwatch at package.json

  @id:ecosystem-support.javascript.010 @rule:npm.metadata.maintainers-funding-repository @inferred @source:src/ecosystems/npm.ts#npm
  Scenario: Deep checks take an npm package's maintainers, funding and repository from the registry
    Given the npm package "left-pad" lists 2 maintainers on the registry
    And its latest release declares a funding link and a GitHub repository
    When the operator runs a deep check
    Then left-pad's maintainer count is 2
    And left-pad is marked as funded
    And left-pad's repository is the GitHub repository it declares
