@domain:automatic-rescans @area:rescan-on-save @from:src/schedule
Feature: Rescanning a manifest after it is saved
  Developers editing manifests get fresh findings after they save, without a scan per keystroke or per repeated save, so the editor stays quiet and responsive.

  Background:
    Given a workspace with the manifest "package.json"
    And rescanning on save is enabled

  @id:vscode.automatic-rescans.rescan-on-save.004 @rule:automatic-rescans.rescan-on-save.burst-of-saves-scans-once @verified @source:extensions/vscode/src/schedule.ts#Debouncer @test:extensions/vscode/src/schedule.test.ts#runs once for a burst of saves @test:extensions/vscode/src/schedule.test.ts#runs synchronously when the delay is zero
  Scenario Outline: A burst of saves to one manifest is rescanned once, after the debounce delay
    Given the scan debounce setting is <debounce> milliseconds
    When the developer saves "package.json" <saves> times in quick succession
    Then no rescan of "package.json" starts before <debounce> milliseconds have passed since the last save
    And "package.json" is rescanned <rescans>

    Examples:
      | debounce | saves | rescans                   |
      | 1500     | 5     | once                      |
      | 0        | 1     | immediately, with no wait |

  @id:vscode.automatic-rescans.rescan-on-save.005 @rule:automatic-rescans.rescan-on-save.manifests-debounced-independently @verified @source:extensions/vscode/src/schedule.ts#Debouncer @test:extensions/vscode/src/schedule.test.ts#keeps different files apart
  Scenario: Saving one manifest does not delay the rescan of another
    Given the workspace also has the manifest "api/package.json"
    When the developer saves "package.json" and then "api/package.json" within the debounce delay
    Then "package.json" is rescanned once
    And "api/package.json" is rescanned once
