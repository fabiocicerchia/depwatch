@domain:dependency-discovery @area:file-format-parsing @from:ecosystems/yaml
Feature: Reading YAML manifests and lock files
  Lets Dart/Flutter, Helm, CocoaPods and Conda users get the dependencies their YAML files declare, so the drift they see matches the versions actually written in the file.

  Background:
    Given depwatch reads YAML block mappings, block sequences and plain scalars only

  @id:dependency-discovery.file-format-parsing.008 @rule:discovery.yaml.comments-ignored-quoted-hash-kept @inferred @source:src/ecosystems/yaml.ts#commentStart
  Scenario: Comments in a YAML manifest do not change the dependencies found
    Given a pubspec.yaml whose dependencies section contains:
    And   # pinned for the 2026 release
    And   http: ^1.2.0  # keep in sync with the server
    And   intl: "^0.19.0"
    When the operator runs depwatch check on the pubspec.yaml
    Then the report lists http at 1.2.0 and intl at 0.19.0
    And no dependency is created from the comment lines

  @id:dependency-discovery.file-format-parsing.009 @rule:discovery.yaml.unquoted-numeric-version-coerced @inferred @source:src/ecosystems/yaml.ts#scalar @questionable
  Scenario Outline: An unquoted two-part version in a YAML manifest is read as a number
    Given a <file> that declares <dependency> with the unquoted version <written>
    When the operator runs depwatch check on the <file>
    Then the report shows <dependency> at version <reported>

    Examples:
      | file         | dependency | written | reported |
      | pubspec.yaml | http       | 1.10    | 1.1      |
      | pubspec.yaml | intl       | 0.20    | 0.2      |
      | Chart.lock   | redis      | 17.10   | 17.1     |

  @id:dependency-discovery.file-format-parsing.010 @rule:discovery.yaml.pubspec-lock-unquoted-version-dropped @inferred @source:src/ecosystems/pub.ts#parsePubspecLock @questionable
  Scenario: A pubspec.lock package whose version is not quoted is left out of the report
    Given a pubspec.lock with a package path whose version is written as 1.9 without quotes
    And a package http whose version is written as "1.2.1"
    When the operator runs depwatch check on the pubspec.lock
    Then the report lists http at 1.2.1
    And the report does not list path at all, not even as unknown

  @id:dependency-discovery.file-format-parsing.011 @rule:discovery.yaml.flow-collections-not-read @inferred @source:src/ecosystems/yaml.ts#parseYaml @questionable
  Scenario: Dependencies written in inline flow style are not discovered
    Given a Chart.yaml that declares its dependencies inline as dependencies: [{name: redis, version: 17.3.0, repository: https://charts.example.com}]
    When the operator runs depwatch check on the Chart.yaml
    Then the run fails with "no dependencies found in Chart.yaml"
    And nothing says the inline dependencies section could not be read
