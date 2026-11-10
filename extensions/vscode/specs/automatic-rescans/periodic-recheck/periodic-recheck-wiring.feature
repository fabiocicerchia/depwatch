@domain:automatic-rescans @area:periodic-recheck @from:src/extension
Feature: Periodic re-check for new releases
  Developers who leave a window open all day still learn about new upstream releases, because depwatch periodically rescans every manifest even when nothing local changed.

  @id:vscode.automatic-rescans.periodic-recheck.001 @rule:automatic-rescans.periodic.forced-full-recheck @inferred @source:extensions/vscode/src/extension.ts#activate
  Scenario: The periodic re-check rescans every manifest even when no file changed
    Given depwatch is enabled and has scanned the workspace
    And no manifest or lock file has changed since
    When the re-check interval elapses while the window has focus
    Then every manifest is re-analysed even though its last scan still matches it
    And registry answers still within their cache lifetime are reused rather than fetched again
    And no progress notification is shown
