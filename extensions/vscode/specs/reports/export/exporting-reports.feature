@domain:reports @area:export @from:src/commands
Feature: Exporting the report and chart
  Lets a developer share findings outside the editor as a standalone HTML page or an SVG quadrant chart.

  Background:
    Given a workspace folder is open

  @id:vscode.reports.export.001 @rule:reports.export.html-report-saved @inferred @source:extensions/vscode/src/commands.ts#exporting
  Scenario: Exporting the report writes an HTML page where the developer chooses
    Given findings from a scan are shown
    When the developer exports the report
    Then a save dialog for HTML files suggests depwatch-report.html in the workspace folder
    And after saving, a message reads "depwatch: wrote" followed by the saved file's name, with an "Open" action that opens the page externally
    And if the dialog is dismissed, nothing is written

  @id:vscode.reports.export.002 @rule:reports.export.chart-svg-for-one-manifest @inferred @source:extensions/vscode/src/commands.ts#exporting @questionable
  Scenario: Exporting the chart writes one manifest's quadrant SVG titled with its total drift
    Given package.json has 12.34 libyears of drift
    When the developer exports the chart
    Then a save dialog for SVG files suggests depwatch-quadrant.svg
    And the saved chart is titled "package.json — drift × viability (12.34 libyears)" and uses the configured thresholds
    And no confirmation message is shown

  @id:vscode.reports.export.003 @rule:reports.export.chart-scan-failure-warns @inferred @source:extensions/vscode/src/commands.ts#exporting
  Scenario: Exporting a chart for a manifest that cannot be scanned warns and writes nothing
    Given package.json has not been scanned
    And package.json declares no dependencies, so scanning it fails
    When the developer exports the chart
    Then a warning reads "depwatch: no dependencies found in" followed by the manifest's path
    And no save dialog is shown
