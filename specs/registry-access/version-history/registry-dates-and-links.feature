@domain:registry-access @area:version-history @from:ecosystems/meta
Feature: Reading release dates and repository links from registries
  Lets operators trust that every release date and repository link depwatch reports comes straight from the registry, and that a date it cannot read shows as unknown instead of a guess.

  Background:
    Given the operator checks a manifest whose ecosystem registry reports release dates in its own format

  @id:registry-access.version-history.001 @rule:registry.dates.unreadable-date-is-unknown @inferred @source:src/ecosystems/meta.ts#toIso @questionable
  Scenario Outline: A release date the registry gives in an unreadable form is reported as unknown, never guessed
    Given the registry lists version <version> of the package with the release date <raw date>
    When the operator checks the manifest
    Then the report gives the release date of <version> as <reported date>

    Examples:
      | version | raw date                      | reported date            |
      | 2.4.0   | 2023-11-14T22:13:20Z          | 2023-11-14T22:13:20.000Z |
      | 2.4.0   | Tue, 14 Nov 2023 22:13:20 GMT | 2023-11-14T22:13:20.000Z |
      | 2.4.0   | not a date                    | unknown                  |
      | 2.4.0   | (none)                        | unknown                  |

  @id:registry-access.version-history.002 @rule:registry.metadata.repository-link-either-shape @inferred @source:src/ecosystems/meta.ts#repoUrlOf
  Scenario Outline: A package's repository link is found whether the registry gives it as plain text or as an object with a url
    Given the operator asks for deep metadata
    And the registry describes the package's repository as <repository field>
    When the operator checks the manifest
    Then the report gives the package's repository as <repository>

    Examples:
      | repository field                                    | repository                             |
      | "https://github.com/acme/widget"                    | https://github.com/acme/widget         |
      | { "url": "git+https://github.com/acme/widget.git" } | git+https://github.com/acme/widget.git |
      | { "type": "git" }                                   | none                                   |
      | (absent)                                            | none                                   |
