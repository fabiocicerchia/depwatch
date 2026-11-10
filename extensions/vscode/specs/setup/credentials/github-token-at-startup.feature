@domain:setup @area:credentials @from:src/extension
Feature: Using the stored GitHub token
  Developers who saved a GitHub token once get maintainer and repository signals in deep scans without putting the token in settings, while a token already in their environment always wins.

  @id:vscode.setup.credentials.003 @rule:setup.credentials.environment-token-takes-precedence @verified @source:extensions/vscode/src/extension.ts#activate @test:extensions/vscode/src/extension.test.ts#takes a stored token out of the keychain and into the environment @test:extensions/vscode/src/extension.test.ts#never overwrites a token the environment already carries
  Scenario Outline: A stored GitHub token is used unless the environment already provides one
    Given the developer has stored the GitHub token "ghp_stored" in the OS keychain
    And the environment variable GITHUB_TOKEN is <environment>
    When depwatch starts
    Then depwatch uses the GitHub token <used>

    Examples:
      | environment  | used         |
      | unset        | ghp_stored   |
      | ghp_from_env | ghp_from_env |
