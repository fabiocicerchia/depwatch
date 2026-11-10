@domain:scanning @area:scan-progress @from:src/state
Feature: Showing each manifest's latest scan outcome
  Makes sure a developer never sees stale findings next to a failure, or a stale failure next to fresh findings, for the same manifest.

  Background:
    Given the findings pane is set to project scope

  @id:vscode.scanning.scan-progress.003 @rule:scanning.outcome.latest-outcome-replaces-previous @inferred @source:extensions/vscode/src/state.ts#Results
  Scenario Outline: A manifest shows only the outcome of its latest scan
    Given the last scan of "packages/api/package.json" <previous outcome>
    When the extension rescans "packages/api/package.json" and it <latest outcome>
    Then the findings pane shows <shown>
    And the status bar totals <totals>

    Examples:
      | previous outcome                       | latest outcome                        | shown                                                                                                    | totals                             |
      | found 12 dependencies                  | fails with "Unexpected token in JSON" | a "packages/api/package.json" row explaining "Unexpected token in JSON" and none of its earlier findings | no longer include its dependencies |
      | failed with "Unexpected token in JSON" | finds 12 dependencies                 | its findings and no failure row for it                                                                   | include its 12 dependencies        |
      | found 12 dependencies                  | reports no dependencies found         | neither findings nor a failure row for it                                                                | no longer include its dependencies |
