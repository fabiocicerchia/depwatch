@domain:dependency-discovery @area:sbom-input @from:src/input
Feature: Being told what an SBOM contributed
  Tells operators feeding an SBOM how many components could be scored and what was left out, so a small report is not taken for full coverage.

  @id:dependency-discovery.sbom-input.002 @rule:input.sbom.coverage-note @inferred @source:src/input.ts#loadManifest
  Scenario: An SBOM run reports how many components were scorable and what was skipped
    Given a CycloneDX SBOM with 120 scorable components, 12 of them direct dependencies of the project
    And it also lists unscorable components: 5 of type generic and 2 of type apk
    When the operator checks the SBOM
    Then the operator sees "depwatch: cyclonedx SBOM: 12 scorable components; direct only, of 120 (--transitive for all); skipped 5 generic, 2 apk — no public registry this tool can query" on stderr

  @id:dependency-discovery.sbom-input.003 @rule:input.sbom.nothing-queryable-refused @inferred @source:src/input.ts#loadManifest
  Scenario: An SBOM with no component from a supported registry is refused with a reason
    Given an SPDX SBOM "bom.spdx.json" whose components all come from registries depwatch cannot query
    When the operator checks the SBOM
    Then the run fails with "bom.spdx.json: the SBOM parsed, but none of its components come from a registry this tool can query"
