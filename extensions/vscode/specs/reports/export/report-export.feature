@domain:reports @area:export @from:src/html
Feature: Exporting the report as a standalone page
  Lets a developer share the report outside the editor as a self-contained page that opens in any browser.

  Background:
    Given the workspace has been scanned

  @id:vscode.reports.export.004 @rule:reports.export.standalone-without-scripts @verified @source:extensions/vscode/src/html.ts#page @test:extensions/vscode/src/report-view.test.ts#only scripts the page when rendered into a webview
  Scenario: An exported report is a script-free page that opens in a browser
    When the developer exports the report as HTML
    Then the page contains the same stats, charts and tables as the report in the editor
    And the page contains no script and no content security policy
    And clicking a row does nothing

  @id:vscode.reports.export.005 @rule:reports.export.depwatch-palette @verified @source:extensions/vscode/src/html.ts#page @test:extensions/vscode/src/report-view.test.ts#themes itself from VS Code inside a webview and from the docs palette outside
  Scenario Outline: The report follows the editor theme inside the editor and the depwatch look when exported
    When the developer views the report <where>
    Then its colours and fonts come from <palette>

    Examples:
      | where                            | palette                                                                                                   |
      | in the editor                    | the active VS Code theme                                                                                  |
      | as an exported page in a browser | the depwatch project page palette, switching to light colours when the reader's system prefers light mode |
