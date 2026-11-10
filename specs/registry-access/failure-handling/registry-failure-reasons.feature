@domain:registry-access @area:failure-handling @from:ecosystems/http
Feature: Explaining why a dependency could not be looked up
  Gives developers and CI operators a readable reason for every dependency a registry would not answer for, so a missing package can be told apart from a registry outage.

  Background:
    Given a manifest that declares a dependency on a package hosted by one of the registries depwatch queries

  @id:registry-access.failure-handling.001 @rule:registry.failures.reason-names-not-found-or-status @inferred @source:src/ecosystems/http.ts#getJson
  Scenario Outline: A dependency the registry will not answer for is reported with the reason the registry gave
    Given the registry answers the lookup for "ghost" with HTTP status <status>
    When the developer checks the manifest
    Then the dependency "ghost" is reported as unknown with the reason "<reason>"
    And the other dependencies in the manifest are still scored

    Examples:
      | status | reason                |
      | 404    | not found in registry |
      | 500    | registry HTTP 500     |
      | 503    | registry HTTP 503     |
      | 429    | registry HTTP 429     |
