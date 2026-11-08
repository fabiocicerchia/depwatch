@domain:registry-cache @area:version-cache @from:src/cache
Feature: Reusing registry answers between scans
  Lets developers rescan on every save and keep a usable report offline, without re-asking package registries for answers that cannot have changed.

  Background:
    Given the developer has a workspace with a package.json that depends on "react"

  @id:vscode.registry-cache.version-cache.001 @rule:registry-cache.versions.reused-while-fresh @verified @source:extensions/vscode/src/cache.ts#TtlCache @test:extensions/vscode/src/cache.test.ts#loads once and serves the rest from memory @test:extensions/vscode/src/cache.test.ts#refetches once the entry is past its TTL
  Scenario Outline: A package's releases are re-asked only once its answer has gone stale
    Given the registry answered for "react" <age> ago
    And the registry answer lifetime is 12 hours
    When the developer scans the manifest
    Then the registry is asked about "react" again: <asked_again>
    And a release published since the last answer appears in the report: <new_release_shown>

    Examples:
      | age      | asked_again | new_release_shown |
      | 1 minute | no          | no                |
      | 11 hours | no          | no                |
      | 13 hours | yes         | yes               |

  @id:vscode.registry-cache.version-cache.002 @rule:registry-cache.failures.retried-after-short-wait @verified @source:extensions/vscode/src/cache.ts#TtlCache @test:extensions/vscode/src/cache.test.ts#keeps them out of the disk cache but remembers them briefly
  Scenario Outline: A package the registry could not answer for is retried after a short wait, and in every new window
    Given the registry reported "ghost-pkg" as not found <age> ago
    And no earlier answer for "ghost-pkg" exists
    When the developer scans the manifest
    Then the registry is asked about "ghost-pkg" again: <asked_again>

    Examples:
      | age                                   | asked_again |
      | 2 minutes, same window                | no          |
      | 11 minutes, same window               | yes         |
      | 2 minutes, after reopening the window | yes         |

  @id:vscode.registry-cache.version-cache.003 @rule:registry-cache.offline.serves-last-known-answer @verified @source:extensions/vscode/src/cache.ts#TtlCache @test:extensions/vscode/src/cache.test.ts#serves a stale entry when a refetch fails @test:extensions/vscode/src/cache.test.ts#serves a stale entry when the loader throws
  Scenario Outline: When the registry cannot be reached, the last known answer is shown instead of a blank report
    Given the registry answered for "react" 13 hours ago with releases up to 18.3.1
    And the registry answer lifetime is 12 hours
    And the registry now <failure>
    When the developer scans the manifest
    Then the report shows "react" with releases up to 18.3.1
    And no error is shown for "react"

    Examples:
      | failure                                               |
      | answers with an error such as offline or rate-limited |
      | cannot be reached at all                              |

  @id:vscode.registry-cache.version-cache.004 @rule:registry-cache.offline.fails-without-prior-answer @verified @source:extensions/vscode/src/cache.ts#TtlCache @test:extensions/vscode/src/cache.test.ts#rethrows when there is nothing stale to fall back to
  Scenario: A package never answered before fails when the registry cannot be reached
    Given the registry has never answered for "left-pad"
    And the registry cannot be reached
    When the developer scans the manifest
    Then no releases are shown for "left-pad"
    And the network error is reported for "left-pad"

  @id:vscode.registry-cache.version-cache.005 @rule:registry-cache.persistence.new-window-starts-warm @verified @source:extensions/vscode/src/cache.ts#TtlCache @test:extensions/vscode/src/cache.test.ts#serves a new cache from what the last one wrote
  Scenario: A new window reuses the registry answers from the previous session
    Given a scan in an earlier window got releases for "react" 1 hour ago
    And the registry answer lifetime is 12 hours
    When the developer opens a new window and scans the manifest
    Then the report shows the releases for "react" from the earlier scan
    And the registry is not asked about "react"
