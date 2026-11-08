@domain:setup @area:settings @from:src/config
Feature: Settings that decide what gets scanned
  Lets a developer control which folders depwatch scans and whether CI budgets apply, honouring what they already told the editor to ignore and refreshing results when those choices change.

  Background:
    Given a workspace with package.json files at the root and under "legacy/"

  @id:vscode.setup.settings.001 @rule:settings.excludes.honour-editor-excludes @inferred @source:extensions/vscode/src/config.ts#readConfig
  Scenario Outline: Folders hidden by the editor are skipped unless the developer opts out
    Given the editor's <section> setting maps "**/legacy/**" to <value>
    And the depwatch.useEditorExcludes setting is <useEditor>
    When the developer scans the whole workspace
    Then legacy/package.json is <outcome>

    Examples:
      | section        | value                        | useEditor | outcome     |
      | files.exclude  | true                         | on        | not scanned |
      | search.exclude | true                         | on        | not scanned |
      | files.exclude  | { "when": "$(basename).ts" } | on        | not scanned |
      | files.exclude  | false                        | on        | scanned     |
      | files.exclude  | true                         | off       | scanned     |

  @id:vscode.setup.settings.002 @rule:settings.excludes.single-glob-accepted @inferred @source:extensions/vscode/src/config.ts#readConfig
  Scenario: An exclude written as a single glob instead of a list is still honoured
    Given the depwatch.exclude setting is the single text "**/legacy/**" rather than a list
    When the developer scans the whole workspace
    Then legacy/package.json is not scanned
    And package.json at the root is scanned

  @id:vscode.setup.settings.003 @rule:settings.changes.rescan-when-results-affected @inferred @source:extensions/vscode/src/config.ts#affectsResults @questionable
  Scenario Outline: Changing a setting that alters results rescans quietly, other settings do not
    Given the workspace has already been scanned
    When the developer changes the <setting> setting
    Then the workspace is <rescan>

    Examples:
      | setting                           | rescan                                    |
      | depwatch.deep                     | rescanned without a progress notification |
      | depwatch.transitive               | rescanned without a progress notification |
      | depwatch.useLockFile              | rescanned without a progress notification |
      | depwatch.thresholds.staleLibyears | rescanned without a progress notification |
      | depwatch.manifests                | rescanned without a progress notification |
      | depwatch.exclude                  | rescanned without a progress notification |
      | depwatch.useEditorExcludes        | rescanned without a progress notification |
      | depwatch.maxManifests             | rescanned without a progress notification |
      | files.exclude                     | rescanned without a progress notification |
      | search.exclude                    | rescanned without a progress notification |
      | depwatch.statusBar                | not rescanned                             |
      | depwatch.diagnostics.replace      | not rescanned                             |
      | depwatch.enable                   | not rescanned                             |

  @id:vscode.setup.settings.004 @rule:settings.gates.configured-when-either-budget-set @inferred @source:extensions/vscode/src/config.ts#readConfig
  Scenario Outline: CI gates count as configured as soon as either budget is set
    Given the depwatch.gates.maxLibyears setting is <maxLibyears>
    And the depwatch.gates.maxReplace setting is <maxReplace>
    When the developer checks the CI gates
    Then <outcome>

    Examples:
      | maxLibyears | maxReplace | outcome                                                                   |
      | null        | null       | the developer is told no gates are configured and offered "Open settings" |
      | 10          | null       | the findings are checked against the 10-libyear budget                    |
      | null        | 0          | the findings are checked against a budget of 0 replace dependencies       |
      | 0           | null       | the findings are checked against a 0-libyear budget                       |
