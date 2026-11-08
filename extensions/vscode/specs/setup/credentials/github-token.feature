@domain:setup @area:credentials @from:src/commands
Feature: Storing the GitHub token
  Lets a developer give deep scans GitHub access without putting the token in settings.

  @id:vscode.setup.credentials.001 @rule:setup.credentials.token-in-keychain @inferred @source:extensions/vscode/src/commands.ts#token
  Scenario: A token entered by the developer is stored in the OS keychain and used by deep scans
    Given no GitHub token is stored
    When the developer sets the GitHub token to "ghp_exampleExampleExample"
    Then the input is masked and stays open when focus moves away
    And the token is stored in the OS keychain, not in settings
    And a message reads "depwatch: GitHub token stored. Deep scans will use it."

  @id:vscode.setup.credentials.002 @rule:setup.credentials.empty-token-clears @inferred @source:extensions/vscode/src/commands.ts#token
  Scenario Outline: Submitting an empty token clears it; dismissing the prompt changes nothing
    Given a GitHub token is stored
    When the developer <action> the GitHub token prompt
    Then <result>

    Examples:
      | action                    | result                                                              |
      | submits an empty value in | the token is removed and "depwatch: GitHub token cleared." is shown |
      | dismisses                 | the stored token is kept and no message is shown                    |
