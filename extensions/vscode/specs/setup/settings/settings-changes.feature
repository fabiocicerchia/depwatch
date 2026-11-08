@domain:setup @area:settings @from:src/extension
Feature: Applying changed settings
  Developers who change what depwatch scans or how it judges dependencies see refreshed findings at once, while cosmetic changes don't trigger a rescan.

  Background:
    Given depwatch has scanned the workspace

  @id:vscode.setup.settings.005 @rule:setup.settings.results-affecting-change-rescans @inferred @source:extensions/vscode/src/extension.ts#activate
  Scenario Outline: Changing a setting that affects results rescans the workspace, other settings do not
    When the developer changes the setting <setting>
    Then <outcome>

    Examples:
      | setting                  | outcome                                      |
      | depwatch.thresholds      | the workspace is rescanned in the background |
      | depwatch.exclude         | the workspace is rescanned in the background |
      | files.exclude            | the workspace is rescanned in the background |
      | depwatch.scan.debounceMs | the new setting is applied with no rescan    |
