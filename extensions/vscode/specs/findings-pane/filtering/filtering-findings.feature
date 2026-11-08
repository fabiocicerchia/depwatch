@domain:findings-pane @area:filtering @from:src/commands
Feature: Filtering findings by quadrant
  Lets a developer focus the findings pane on the quadrants they care about.

  Background:
    Given the findings pane shows dependencies across quadrants

  @id:vscode.findings-pane.filtering.001 @rule:findings-pane.filtering.quadrant-picker-with-counts @inferred @source:extensions/vscode/src/commands.ts#pane
  Scenario Outline: The filter offers every quadrant with its dependency count, pre-ticking the active filter
    Given the current scope has 1 dependency in one quadrant and 4 in another
    And <filter_state>
    When the developer opens the findings filter
    Then a "Show findings for" multi-select lists every quadrant with "1 dep" or "4 deps" beside it
    And <ticked>

    Examples:
      | filter_state                     | ticked                       |
      | no filter is active              | every quadrant is ticked     |
      | only one quadrant is filtered in | only that quadrant is ticked |

  @id:vscode.findings-pane.filtering.002 @rule:findings-pane.filtering.empty-pick-shows-everything @inferred @source:extensions/vscode/src/commands.ts#pane
  Scenario Outline: Picking no quadrant shows every finding, and dismissing the picker keeps the current filter
    Given a filter showing one quadrant is active
    When the developer <action> the findings filter
    Then <result>

    Examples:
      | action                          | result                               |
      | confirms with nothing ticked in | every quadrant is shown              |
      | dismisses                       | only the one quadrant is still shown |
