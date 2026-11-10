@domain:dependency-discovery @area:manifest-detection @from:src/manifest
Feature: Recognising which ecosystem an input file belongs to
  Lets a developer point depwatch at any manifest, lock file or SBOM and have it scored by the right ecosystem, or be told plainly when it cannot be.

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
