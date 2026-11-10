@domain:baseline @area:baseline-sync @from:src/extension
Feature: Following the baseline file
  Teams sharing a committed baseline see accepted findings hidden or shown again as soon as the file changes, whether by an edit or a git pull.

  Background:
    Given depwatch has scanned /repo/package.json

  @id:vscode.baseline.baseline-sync.001 @rule:baseline.sync.refilter-on-baseline-change @verified @source:extensions/vscode/src/extension.ts#watchBaseline @test:extensions/vscode/src/extension.test.ts#watches the manifests it scans and the locks that change them @questionable
  Scenario Outline: Changing the baseline file re-filters the shown findings without a rescan
    Given the baseline file .depwatch-baseline.json is in the workspace
    When the baseline file is <change> by an edit or a git pull
    Then the findings shown for /repo/package.json are re-filtered against the new baseline
    And manifests whose last scan is still within the refresh interval are not rescanned against the registries

    Examples:
      | change  |
      | changed |
      | created |
      | deleted |
