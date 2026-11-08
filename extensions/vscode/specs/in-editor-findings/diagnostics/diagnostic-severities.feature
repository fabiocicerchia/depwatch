@domain:in-editor-findings @area:diagnostics @from:src/config
Feature: Choosing how loudly each finding is underlined
  Lets a developer decide, per quadrant, whether a dependency finding shows as an error, warning, info, hint or not at all, so the Problems panel carries only what they care about.

  Background:
    Given a workspace with a scanned package.json

  @id:vscode.in-editor-findings.diagnostics.009 @rule:findings.diagnostics.severity-per-quadrant @inferred @source:extensions/vscode/src/config.ts#severityFor
  Scenario Outline: Each quadrant is underlined at the severity its setting names
    Given the dependency "left-pad" falls in the <quadrant> quadrant
    And the registry answered for "left-pad"
    And the depwatch.diagnostics.<quadrant> setting is "<setting>"
    When the developer opens package.json
    Then "left-pad" is shown in the Problems panel as <shown>

    Examples:
      | quadrant | setting | shown                  |
      | replace  | warning | a warning              |
      | upgrade  | info    | an information message |
      | watch    | info    | an information message |
      | healthy  | off     | nothing (no underline) |
      | replace  | error   | an error               |
      | upgrade  | hint    | a hint                 |
      | watch    | off     | nothing (no underline) |

  @id:vscode.in-editor-findings.diagnostics.010 @rule:findings.diagnostics.degraded-uses-degraded-severity @inferred @source:extensions/vscode/src/config.ts#severityFor
  Scenario Outline: A dependency the registry would not answer for uses the degraded severity, whatever its quadrant
    Given the dependency "left-pad" falls in the replace quadrant
    And the registry would not answer for "left-pad"
    And the depwatch.diagnostics.replace setting is "warning"
    And the depwatch.diagnostics.degraded setting is "<degraded>"
    When the developer opens package.json
    Then "left-pad" is shown in the Problems panel as <shown>

    Examples:
      | degraded | shown                  |
      | off      | nothing (no underline) |
      | hint     | a hint                 |
      | error    | an error               |
