@domain:registry-cache @area:cache-reset @from:src/commands
Feature: Clearing the registry cache
  Lets a developer throw away cached registry answers when they suspect stale data.

  @id:vscode.registry-cache.cache-reset.001 @rule:registry-cache.reset.clear-on-demand @inferred @source:extensions/vscode/src/commands.ts#scanning
  Scenario: Clearing the cache drops current findings and the next scan refetches
    Given findings from an earlier scan are shown
    When the developer clears the registry cache
    Then the shown findings are cleared
    And an information message reads "depwatch: registry cache cleared. The next scan will refetch."
