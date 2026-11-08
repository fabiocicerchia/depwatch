@domain:dependency-discovery @area:manifest-detection @from:src/manifest
Feature: Recognising which ecosystem an input file belongs to
  Lets a developer point depwatch at any manifest, lock file or SBOM and have it scored by the right ecosystem, or be told plainly when it cannot be.

  @id:dependency-discovery.manifest-detection.009 @rule:discovery.manifests.ecosystem-from-file-name @verified @source:src/manifest.ts#detectEcosystem @test:src/manifest.test.ts#maps conventional manifest names
  Scenario Outline: The ecosystem is recognised from the manifest's conventional file name
    Given a project file named "<file>"
    When the developer checks the file without naming an ecosystem
    Then the file is scored as a "<ecosystem>" manifest

    Examples:
      | file                     | ecosystem |
      | package.json             | npm       |
      | a/b/requirements-dev.txt | pep440    |
      | Cargo.toml               | cargo     |
      | composer.json            | composer  |
      | Gemfile.lock             | rubygems  |
      | pom.xml                  | maven     |
      | C:\proj\package.json     | npm       |

  @id:dependency-discovery.manifest-detection.010 @rule:discovery.manifests.unrecognised-input-refused @verified @source:src/manifest.ts#parse @test:src/manifest.test.ts#refuses to guess at an unknown manifest
  Scenario: A file depwatch cannot recognise is refused rather than guessed at
    Given a project file named "deps.edn"
    And no ecosystem has been named for it
    When the developer checks the file
    Then the check is refused with "unrecognised input: deps.edn (expected a manifest, a lock file, or a CycloneDX/SPDX SBOM)"
    And no dependencies are reported

  @id:dependency-discovery.manifest-detection.011 @rule:discovery.manifests.unsupported-ecosystem-refused @verified @source:src/manifest.ts#assertEcosystem @test:src/manifest.test.ts#rejects a typo instead of silently reporting no dependencies
  Scenario Outline: Naming an unsupported ecosystem is refused instead of reporting a clean manifest
    Given the developer names the ecosystem "<value>" for their input
    When the developer runs the check
    Then the check is refused with a message starting "unsupported ecosystem \"<value>\""
    And the message lists every supported ecosystem after "want one of:"
    And no empty, clean-looking report is produced

    Examples:
      | value  |
      | npmm   |
      | mavenn |
      |        |

  @id:dependency-discovery.manifest-detection.012 @rule:discovery.manifests.named-ecosystem-overrides-file-name @inferred @source:src/manifest.ts#parse
  Scenario: A named ecosystem is used even when the file name says otherwise
    Given a requirements file saved under the name "deps.txt"
    And the developer names the ecosystem "pep440"
    When the developer checks the file
    Then the file is scored as a "pep440" manifest
    And the file name is not used to decide the ecosystem

  @id:dependency-discovery.manifest-detection.013 @rule:discovery.manifests.sbom-recognised-by-content @inferred @source:src/manifest.ts#parse
  Scenario Outline: An SBOM is recognised by its content, whatever the file is called
    Given a CycloneDX or SPDX JSON document saved as "<file>"
    When the developer checks the file
    Then it is read as an SBOM, with each component scored in its own ecosystem
    And the result shows the SBOM format and how many of its components can be scored
    And without a request for the full tree, only the direct dependencies the SBOM declares are scored

    Examples:
      | file         |
      | bom.json     |
      | package.json |
