@domain:in-editor-findings @area:diagnostics @from:src/annotate
Feature: Flagging dependencies in the manifest and the Problems panel
  Serves developers who want each risky dependency underlined where it is declared and listed in the Problems panel, at a severity they choose per quadrant, so drift and viability findings surface while they work.

  Background:
    Given a workspace whose manifests have been scanned by depwatch
    And squiggles are enabled in the depwatch settings

  @id:vscode.in-editor-findings.diagnostics.001 @rule:in-editor-findings.diagnostics.severity-per-quadrant @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario Outline: Each declared dependency is flagged at the severity configured for its quadrant
    Given the manifest "package.json" declares "left-pad" at version 1.0.0
    And the latest scan places "left-pad" in the <quadrant> quadrant
    And the severity setting for <quadrant> is "<setting>"
    When the scan results are published
    Then the line declaring "left-pad" shows <shown>
    And the Problems panel lists <listed> from source "depwatch"
    And any listed problem names "left-pad", its quadrant, its libyears behind, its viability and its upgrade from 1.0.0, followed by the quadrant's explanation and the current thresholds

    Examples:
      | quadrant | setting | shown                   | listed                |
      | replace  | warning | a warning squiggle      | one warning           |
      | upgrade  | info    | an information squiggle | one information entry |
      | watch    | info    | an information squiggle | one information entry |
      | healthy  | off     | no squiggle             | nothing               |
      | replace  | error   | an error squiggle       | one error             |
      | upgrade  | hint    | a hint marker           | one hint              |
      | watch    | off     | no squiggle             | nothing               |

  @id:vscode.in-editor-findings.diagnostics.002 @rule:in-editor-findings.diagnostics.unscored-dependency @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario Outline: A dependency with no registry data is flagged as not scored at the no-data severity
    Given the manifest "package.json" declares "internal-utils"
    And the registry answered "not found in registry" for "internal-utils" during the scan
    And the severity setting for no-data dependencies is "<setting>"
    When the scan results are published
    Then the Problems panel shows <listed> for "internal-utils"
    And any listed problem reads "internal-utils: no registry data (not found in registry) — not scored" with code "no-data"

    Examples:
      | setting | listed      |
      | off     | nothing     |
      | warning | one warning |
      | hint    | one hint    |
      | error   | one error   |

  @id:vscode.in-editor-findings.diagnostics.004 @rule:in-editor-findings.diagnostics.only-declared-dependencies @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: Dependencies not written in the manifest are not flagged in it
    Given the manifest "package.json" declares "express", which is in the upgrade quadrant
    And the scan also reports "debug", which "express" pulls in and "package.json" never names
    And "debug" is in the replace quadrant
    When the scan results are published
    Then no squiggle or problem for "debug" appears on "package.json"
    And "express" is flagged on the line that declares it

  @id:vscode.in-editor-findings.diagnostics.005 @rule:in-editor-findings.diagnostics.unopened-manifests-listed @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: Findings for manifests that are not open still appear in the Problems panel
    Given a workspace scan covered "services/api/package.json"
    And "services/api/package.json" is not open in the editor
    And "lodash" in it is in the upgrade quadrant
    When the scan results are published
    Then the Problems panel lists "lodash" under "services/api/package.json" at the line that declares it
    And opening "services/api/package.json" later shows the squiggle under "lodash"

  @id:vscode.in-editor-findings.diagnostics.006 @rule:in-editor-findings.diagnostics.edits-move-squiggles-not-findings @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: Unsaved edits move squiggles to follow their dependency but do not change the findings
    Given "package.json" is open with "left-pad" flagged on line 12
    And the developer inserts three lines above "left-pad" without saving
    When the developer stops typing
    Then the "left-pad" squiggle is on line 15
    And the finding for "left-pad" keeps its quadrant and message until the manifest is saved and rescanned

  @id:vscode.in-editor-findings.diagnostics.007 @rule:in-editor-findings.diagnostics.disable-clears @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: Turning squiggles off removes every depwatch finding from the editor and Problems panel
    Given several manifests show depwatch squiggles and problems
    When the developer turns off the "depwatch.diagnostics.enable" setting
    Then no depwatch squiggles remain in any manifest
    And the Problems panel lists no depwatch entries
    And turning the setting back on shows the findings again without a rescan

  @id:vscode.in-editor-findings.diagnostics.008 @rule:in-editor-findings.diagnostics.cleared-when-results-gone @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: A manifest whose results are dropped stops showing findings
    Given "package.json" shows depwatch problems
    And depwatch no longer holds scan results for "package.json"
    When the results change is published
    Then "package.json" shows no depwatch squiggles
    And the Problems panel lists no depwatch entries for "package.json"
