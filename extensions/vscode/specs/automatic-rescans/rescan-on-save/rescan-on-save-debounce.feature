@domain:automatic-rescans @area:rescan-on-save @from:src/schedule
Feature: Rescanning a manifest after it is saved
  Developers editing manifests get fresh findings after they save, without a scan per keystroke or per repeated save, so the editor stays quiet and responsive.

  Background:
    Given Given a workspace with the manifest "package.json"
    And And rescanning on save is enabled

  @id:vscode.automatic-rescans.rescan-on-save.004 @rule:automatic-rescans.rescan-on-save.burst-of-saves-scans-once @verified @source:extensions/vscode/src/schedule.ts#Debouncer @test:extensions/vscode/src/schedule.test.ts#runs once for a burst of saves @test:extensions/vscode/src/schedule.test.ts#runs synchronously when the delay is zero
  Scenario Outline: A burst of saves to one manifest is rescanned once, after the debounce delay
    Given Given the scan debounce setting is <debounce> milliseconds
    When When the developer saves "package.json" <saves> times in quick succession
    Then Then no rescan of "package.json" starts before <debounce> milliseconds have passed since the last save
    And And "package.json" is rescanned <rescans>

    Examples:
      | debounce | saves | rescans                   |
      | 1500     | 5     | once                      |
      | 0        | 1     | immediately, with no wait |

  @id:vscode.automatic-rescans.rescan-on-save.005 @rule:automatic-rescans.rescan-on-save.manifests-debounced-independently @verified @source:extensions/vscode/src/schedule.ts#Debouncer @test:extensions/vscode/src/schedule.test.ts#keeps different files apart
  Scenario: Saving one manifest does not delay the rescan of another
    Given And the workspace also has the manifest "api/package.json"
    When When the developer saves "package.json" and then "api/package.json" within the debounce delay
    Then Then "package.json" is rescanned once
    And And "api/package.json" is rescanned once
