@domain:dependency-discovery @area:sbom-input @from:ecosystems/registry
Feature: Assigning SBOM components to ecosystems by package URL type
  Lets a team feed one CycloneDX or SPDX document covering several ecosystems and have each component scored against its own registry.

  @id:dependency-discovery.sbom-input.001 @rule:sbom.components.ecosystem-from-purl-type @verified @source:src/ecosystems/registry.ts#byPurlType @test:src/ecosystems/registry.test.ts#maps PURL types @test:src/ecosystems/registry.test.ts#has no PURL type claimed by two ecosystems
  Scenario Outline: Each SBOM component is scored in the ecosystem its package URL type names, and unknown types are counted as skipped
    Given an SBOM listing a component with package URL pkg:<type>/example-lib@1.2.0
    When the developer checks the SBOM
    Then <outcome>

    Examples:
      | type   | outcome                                                                   |
      | pypi   | the component is scored as a PyPI package                                 |
      | gem    | the component is scored as a RubyGems package                             |
      | golang | the component is scored as a Go module                                    |
      | oci    | the component is scored as a Docker image                                 |
      | github | the component is scored as a GitHub Action                                |
      | deb    | the component is not scored and is counted as one skipped "deb" component |
