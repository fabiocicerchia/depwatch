@domain:automatic-rescans @area:periodic-recheck @from:src/schedule
Feature: Periodically re-checking for new releases
  Developers learn about releases published elsewhere without rescanning by hand, while a backgrounded or sleeping editor does no scanning work.

  Background:
    Given Given a workspace with scanned manifests

  @id:vscode.automatic-rescans.periodic-recheck.002 @rule:automatic-rescans.periodic-recheck.runs-while-focused @verified @source:extensions/vscode/src/schedule.ts#Heartbeat @test:extensions/vscode/src/schedule.test.ts#fires on its interval while the window has focus
  Scenario: The workspace is re-checked every refresh interval while the window has focus
    Given Given the refresh interval is 360 minutes
    And And the editor window has focus
    When When 18 hours pass
    Then Then the workspace has been re-checked 3 times
    And And each re-check runs without a progress notification

  @id:vscode.automatic-rescans.periodic-recheck.003 @rule:automatic-rescans.periodic-recheck.missed-checks-collapse-to-one-on-focus @verified @source:extensions/vscode/src/schedule.ts#Heartbeat @test:extensions/vscode/src/schedule.test.ts#defers a tick that arrives unfocused, and runs it once on return
  Scenario: Re-checks missed while the window is in the background run once when focus returns
    Given Given the refresh interval is 360 minutes
    And And the editor window is in the background
    When When several refresh intervals pass and the developer then returns to the window
    Then Then no re-check runs while the window is in the background
    And And exactly one re-check runs when the window regains focus
    And And regaining focus again later starts no further re-check

  @id:vscode.automatic-rescans.periodic-recheck.004 @rule:automatic-rescans.periodic-recheck.zero-interval-disables @verified @source:extensions/vscode/src/schedule.ts#Heartbeat @test:extensions/vscode/src/schedule.test.ts#does not start at all when the interval is zero
  Scenario: A refresh interval of zero turns the periodic re-check off
    Given Given the refresh interval is 0 minutes
    And And the editor window has focus
    When When an hour passes
    Then Then no periodic re-check runs

  @id:vscode.automatic-rescans.periodic-recheck.005 @rule:automatic-rescans.periodic-recheck.interval-change-applies-live @verified @source:extensions/vscode/src/schedule.ts#Heartbeat @test:extensions/vscode/src/schedule.test.ts#restarts on a new interval
  Scenario: Changing the refresh interval takes effect without reloading the editor
    Given Given the refresh interval is 360 minutes
    And And the editor window has focus
    When When the developer changes the refresh interval to 720 minutes
    Then Then the next re-check runs 720 minutes after the change
    And And no re-check runs at the old 360-minute mark
