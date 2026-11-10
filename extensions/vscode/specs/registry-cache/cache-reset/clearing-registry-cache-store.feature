@domain:registry-cache @area:cache-reset @from:src/store
Feature: Clearing the registry cache
  Lets a developer throw away cached registry answers so the next scan shows what the registries say now, not what they said earlier.

  Background:
    Given the developer has a workspace with a scanned manifest
    And registry answers from that scan are cached on this machine

  @id:vscode.registry-cache.cache-reset.002 @rule:registry-cache.reset.next-scan-refetches @verified @source:extensions/vscode/src/store.ts#FileCacheStore @test:extensions/vscode/src/cache.test.ts#clears everything on request @questionable
  Scenario: After the registry cache is cleared, the next scan fetches fresh registry data
    Given the cached answers are still within their freshness window
    And a package has published a new release since they were cached
    When the developer clears the registry cache
    Then the next scan, in this window or a new one, asks the registries again
    And it reports the package's new release
