@domain:setup @area:activation @from:src/extension
Feature: Starting depwatch in the editor
  Developers opening a workspace get their dependencies scanned straight away unless they have switched depwatch off, and every command depwatch offers is available until the extension shuts down.

  Background:
    Given a workspace containing the manifests /repo/package.json and /repo/web/package.json

  @id:vscode.setup.activation.001 @rule:setup.activation.startup-scan-respects-enable @verified @source:extensions/vscode/src/extension.ts#activate @test:extensions/vscode/src/extension.test.ts#scans nothing on startup when the extension is switched off @test:extensions/vscode/src/extension.test.ts#goes looking for manifests on startup when it is on
  Scenario Outline: The workspace is scanned on startup only when depwatch is enabled and set to scan on startup
    Given depwatch is <enable>
    And scanning on startup is <onStartup>
    When the developer opens the workspace
    Then <outcome>

    Examples:
      | enable   | onStartup | outcome                                                      |
      | enabled  | on        | both manifests are scanned and the log reports 2 manifest(s) |
      | disabled | on        | no manifest is scanned                                       |
      | enabled  | off       | no manifest is scanned                                       |

  @id:vscode.setup.activation.002 @rule:setup.activation.commands-available-while-active @verified @source:extensions/vscode/src/extension.ts#activate @test:extensions/vscode/src/extension.test.ts#registers every command the manifest contributes @test:extensions/vscode/src/extension.test.ts#puts everything it created into subscriptions, so disposal is complete
  Scenario: Every depwatch command is available while the extension runs and gone once it shuts down
    Given depwatch has started in the workspace
    And every command depwatch lists in the command palette can be run
    When the editor shuts depwatch down
    Then none of depwatch's commands can be run any more
