@domain:in-editor-findings @area:hover-explanations @from:src/annotate
Feature: Explaining a dependency on hover
  Serves developers who want to know, without leaving the manifest, why a dependency sits in its quadrant and where to read more about it.

  Background:
    Given the manifest "package.json" has been scanned by depwatch

  @id:vscode.in-editor-findings.hover-explanations.001 @rule:in-editor-findings.hover.explains-dependency @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: Hovering a declared dependency explains its quadrant and links to the registry
    Given "package.json" declares "left-pad" at 1.0.0
    And the latest available version of "left-pad" is 1.3.0
    And "left-pad" is in the replace quadrant
    When the developer hovers over "left-pad" in the manifest
    Then the hover heading reads "left-pad 1.0.0 → 1.3.0"
    And the hover shows the quadrant badge and its explanation, a list of the reasons, and the current thresholds
    And the hover ends with a link "left-pad on the registry" to "https://www.npmjs.com/package/left-pad"

  @id:vscode.in-editor-findings.hover-explanations.002 @rule:in-editor-findings.hover.unscored-dependency @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario: Hovering a dependency with no registry data says it is not scored
    Given "package.json" declares "internal-utils"
    And the registry returned no data for "internal-utils" during the scan
    When the developer hovers over "internal-utils" in the manifest
    Then the hover heading reads "internal-utils — not scored"

  @id:vscode.in-editor-findings.hover-explanations.003 @rule:in-editor-findings.hover.independent-of-squiggles @inferred @source:extensions/vscode/src/annotate.ts#Annotator @questionable
  Scenario Outline: Hover explanations stay available when squiggles are turned off or a quadrant is silenced
    Given "left-pad" in "package.json" is in the <quadrant> quadrant
    And <condition>
    When the developer hovers over "left-pad" in the manifest
    Then the hover explanation for "left-pad" is shown
    And no squiggle is drawn under "left-pad"

    Examples:
      | quadrant | condition                                        |
      | replace  | the "depwatch.diagnostics.enable" setting is off |
      | healthy  | the severity setting for healthy is "off"        |

  @id:vscode.in-editor-findings.hover-explanations.004 @rule:in-editor-findings.hover.only-on-dependency @inferred @source:extensions/vscode/src/annotate.ts#Annotator
  Scenario Outline: No depwatch hover appears away from a declared dependency or in an unscanned file
    Given <file state>
    When the developer hovers over <target>
    Then no depwatch hover is shown

    Examples:
      | file state                         | target                                  |
      | "package.json" has been scanned    | the "scripts" section of "package.json" |
      | "README.md" has never been scanned | the word "express" in "README.md"       |
