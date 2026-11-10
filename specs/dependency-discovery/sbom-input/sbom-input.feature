@domain:dependency-discovery @area:sbom-input @from:src/sbom
Feature: Reading an SBOM as the dependency list
  Lets operators point depwatch at a CycloneDX or SPDX SBOM so one file covers a polyglot project, with resolved versions and an honest account of what could not be scored.

  Background:
    Given the operator has an SBOM produced by a scanner such as syft for the project "my-app"

  @id:dependency-discovery.sbom-input.004 @rule:sbom.input.recognised-by-content @verified @source:src/sbom.ts#detectSbom @test:src/sbom.test.ts#tells the two formats apart, and from everything else @test:src/sbom.test.ts#reads bom.json as an SBOM rather than a package.json
  Scenario Outline: An SBOM is recognised by its contents, whatever the file is called
    Given the file "<file>" contains a <format> JSON document
    When the operator checks "<file>"
    Then depwatch reads it as a <format> SBOM
    And the run notes "<format> SBOM: <n> scorable components"

    Examples:
      | file           | format    | n |
      | bom.json       | cyclonedx | 2 |
      | sbom.spdx.json | spdx      | 1 |

  @id:dependency-discovery.sbom-input.005 @rule:sbom.input.component-identity-from-purl @verified @source:src/sbom.ts#parsePurl @test:src/sbom.test.ts#reads type, name and version @test:src/sbom.test.ts#decodes a percent-encoded npm scope, which is how syft writes them @test:src/sbom.test.ts#accepts an unencoded scope too @test:src/sbom.test.ts#drops qualifiers and subpaths, which are not part of identity @test:src/sbom.test.ts#maps each component to its own ecosystem @test:src/sbom.test.ts#marks every SBOM version as resolved — that is what an SBOM is for @test:src/sbom.test.ts#reads purls out of externalRefs, ignoring the cpe entries @test:src/ecosystems/phase4.test.ts#parses both group:artifact and PURL group/artifact via the SBOM path
  Scenario Outline: Each component is scored in its own ecosystem at the exact version the SBOM records
    Given the SBOM lists a component with package URL "<purl>"
    When the operator checks the SBOM
    Then the dependency "<name>" is scored in the <ecosystem> ecosystem
    And its installed version is "<version>", treated as resolved rather than a range

    Examples:
      | purl                                      | name                   | ecosystem | version  |
      | pkg:npm/react@18.3.9                      | react                  | npm       | 18.3.9   |
      | pkg:npm/%40remix-run/router@1.23.3        | @remix-run/router      | npm       | 1.23.3   |
      | pkg:npm/react@18.3.9?arch=x86#src/lib     | react                  | npm       | 18.3.9   |
      | pkg:pypi/django@4.2.1                     | django                 | pep440    | 4.2.1    |
      | pkg:maven/com.google.guava/guava@30.0-jre | com.google.guava/guava | maven     | 30.0-jre |

  @id:dependency-discovery.sbom-input.007 @rule:sbom.input.components-without-purl-ignored @inferred @source:src/sbom.ts#collect @questionable
  Scenario: Components without a usable package URL are left out without being reported
    Given the SBOM lists a component "internal-tool" with no package URL
    And the SBOM lists a component with package URL "pkg:npm/react" and no version
    When the operator checks the SBOM
    Then neither component is scored
    And neither appears in the skipped count of the run note

  @id:dependency-discovery.sbom-input.008 @rule:sbom.input.direct-dependencies-by-default @verified @source:src/sbom.ts#directOnly @test:src/sbom.test.ts#reads the dependency graph to find direct dependencies @test:src/sbom.test.ts#reads DEPENDS_ON relationships as the direct set @test:src/sbom.test.ts#reads the reversed DEPENDENCY_OF spelling too @test:src/sbom.test.ts#reads bom.json as an SBOM rather than a package.json @test:src/sbom.test.ts#takes the whole tree when asked
  Scenario Outline: Only the project's direct dependencies are scored unless the whole tree is asked for
    Given the <format> SBOM lists 6 scorable components
    And its dependency graph records "react" and "django" as the project's direct dependencies
    When the operator checks the SBOM <option>
    Then <n> components are scored
    And the run notes "<note>"

    Examples:
      | format    | option            | n | note                                     |
      | CycloneDX | without options   | 2 | direct only, of 6 (--transitive for all) |
      | SPDX      | without options   | 2 | direct only, of 6 (--transitive for all) |
      | CycloneDX | with --transitive | 6 | cyclonedx SBOM: 6 scorable components    |

  @id:dependency-discovery.sbom-input.009 @rule:sbom.input.no-usable-graph-scores-everything @verified @source:src/sbom.ts#directOnly @test:src/sbom.test.ts#falls back to everything when the graph is absent or matches nothing
  Scenario Outline: Without a usable dependency graph every scorable component is scored
    Given the SBOM lists 6 scorable components
    And its dependency graph is <graph>
    When the operator checks the SBOM
    Then all 6 components are scored
    And the run note does not say "direct only"

    Examples:
      | graph                                 |
      | absent                                |
      | present but names no listed component |

  @id:dependency-discovery.sbom-input.010 @rule:sbom.input.project-not-its-own-dependency @verified @source:src/sbom.ts#parseCycloneDx @test:src/sbom.test.ts#excludes the scanned project from its own dependencies @test:src/sbom.test.ts#skips the document root and counts unsupported ecosystems
  Scenario: The scanned project never appears as one of its own dependencies
    Given the SBOM describes the project "my-app"
    And the SBOM also catalogues "my-app" as a component under a different reference
    When the operator checks the SBOM
    Then "my-app" is not among the scored dependencies

  @id:dependency-discovery.sbom-input.011 @rule:sbom.input.one-entry-per-package @inferred @source:src/sbom.ts#collect @questionable
  Scenario: A package listed more than once is scored once, at the first version listed
    Given the SBOM lists "lodash" at version "4.17.20"
    And later in the SBOM it lists "lodash" at version "4.17.21"
    When the operator checks the SBOM
    Then "lodash" is scored once
    And its installed version is "4.17.20"
