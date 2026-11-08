@domain:automatic-rescans @area:rescan-on-save @from:src/extension
Feature: Rescanning manifests that change on disk
  Developers see findings that match the manifest as it is on disk after they save it, without scans firing while they type and without scanning folders they excluded.

  Background:
    Given depwatch has scanned /repo/package.json

  @id:vscode.automatic-rescans.rescan-on-save.001 @rule:automatic-rescans.on-save.rescan-after-save @inferred @source:extensions/vscode/src/extension.ts#watchManifests
  Scenario: A saved manifest is rescanned after the debounce period
    Given depwatch is enabled with rescan on save on
    When the developer saves /repo/package.json
    Then /repo/package.json is rescanned once the debounce period has passed
    And its findings reflect the saved versions

  @id:vscode.automatic-rescans.rescan-on-save.002 @rule:automatic-rescans.on-save.no-rescan-when-off-or-excluded @inferred @source:extensions/vscode/src/extension.ts#activate @questionable
  Scenario Outline: Changed manifests are not rescanned when depwatch or rescan-on-save is off, or the file is in an excluded folder
    Given <condition>
    When the developer saves <path>
    Then <path> is not rescanned
    And the findings shown for it stay as they were

    Examples:
      | condition                           | path                                     |
      | depwatch is disabled                | /repo/package.json                       |
      | rescan on save is off               | /repo/package.json                       |
      | the folder node_modules is excluded | /repo/node_modules/left-pad/package.json |

  @id:vscode.automatic-rescans.rescan-on-save.003 @rule:automatic-rescans.on-save.deleted-manifest-findings-removed @inferred @source:extensions/vscode/src/extension.ts#activate
  Scenario: Deleting a manifest removes its findings
    Given /repo/package.json has findings on screen
    When the developer deletes /repo/package.json
    Then no findings for /repo/package.json are shown any more
    And its squiggles disappear
