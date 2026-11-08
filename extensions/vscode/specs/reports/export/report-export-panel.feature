@domain:reports @area:export @from:src/panel
Feature: Exporting the report
  Lets developers share the report as a single HTML file that opens in any browser, outside the editor.

  @id:vscode.reports.export.006 @rule:reports.export.standalone-html-page @inferred @source:extensions/vscode/src/panel.ts#ReportPanel
  Scenario: An exported report is a standalone page with no scripts
    Given the workspace has been scanned
    When the developer exports the report as HTML
    Then the exported page shows the same stats, gate banner, quadrant charts and tables as the report tab
    And the page contains no script and no content security policy, so it opens in a plain browser
