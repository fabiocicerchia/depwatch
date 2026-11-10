@domain:editor-integration @area:editor-results @from:extensions/nvim
Feature: Reviewing findings in lists and reports
  Gives a developer the project's findings as a jumpable list, a grouped report and a drift history, so they can decide what to fix first.

  Background:
    Given the plugin has scanned the project's manifests

  @id:editor-integration.editor-results.001 @rule:editor.results.quickfix-lists-findings-worst-first @verified @source:extensions/nvim/lua/depwatch/quickfix.lua#list @test:extensions/nvim/tests/init_spec.lua#points at the line each dependency is written on @test:extensions/nvim/tests/init_spec.lua#leaves healthy dependencies out unless asked for everything @test:extensions/nvim/tests/init_spec.lua#marks a degraded dependency as a note, not an error
  Scenario Outline: The findings list holds every dependency off the Healthy quadrant, worst first, at its declaring line
    Given package.json declares left-pad (Replace) on line 4, request (Upgrade), lodash (Healthy) and debug, for which the registry gave no data
    When the developer runs <command>
    Then a quickfix list titled "<title>" opens with <rows>
    And the first row is left-pad at line 4, marked as an error
    And request is marked as a warning and debug as a note

    Examples:
      | command        | title                      | rows                                |
      | :DepwatchList  | depwatch                   | left-pad, request and debug         |
      | :DepwatchList! | depwatch: every dependency | left-pad, request, lodash and debug |

  @id:editor-integration.editor-results.002 @rule:editor.results.quickfix-empty-says-nothing-to-address @verified @source:extensions/nvim/lua/depwatch/quickfix.lua#list @test:extensions/nvim/tests/init_spec.lua#says nothing to address rather than opening an empty list
  Scenario: An empty findings list is a message, not an empty window
    Given every scanned dependency is Healthy
    When the developer runs :DepwatchList
    Then the developer sees "depwatch: nothing to address."
    And no quickfix window opens

  @id:editor-integration.editor-results.003 @rule:editor.results.unwritten-dependency-points-at-file @verified @source:extensions/nvim/lua/depwatch/quickfix.lua#items @test:extensions/nvim/tests/init_spec.lua#keeps a dependency written down nowhere, pointing at the file
  Scenario: A finding not declared in the manifest still appears in the list, pointing at the file
    Given the scan of package.json reports transitive-only, which package.json does not declare
    When the developer runs :DepwatchList
    Then the list has one row for transitive-only
    And it points at package.json, line 1, column 1

  @id:editor-integration.editor-results.004 @rule:editor.results.trend-shows-drift-over-history @verified @source:extensions/nvim/lua/depwatch/commands.lua#trend @test:extensions/nvim/tests/init_spec.lua#renders one row per commit and the drift between the ends @test:extensions/nvim/tests/init_spec.lua#signs a fall as a fall @test:extensions/nvim/tests/init_spec.lua#leaves the delta off when there is only one commit to compare
  Scenario Outline: The trend shows drift at each sampled commit and the change between the ends
    Given package.json is open
    And its history has <points>
    When the developer runs :DepwatchTrend
    Then a window titled " depwatch trend " opens headed "# package.json"
    And each commit is a row like "2025-01-02  aaaaaaa      1.00 libyears     3 deps  0 replace"
    And the last line is <last_line>

    Examples:
      | points                           | last_line                               |
      | 1.00 libyears then 4.50 libyears | "+3.50 libyears over 2 sampled commits" |
      | 4.50 libyears then 1.00 libyears | "-3.50 libyears over 2 sampled commits" |
      | only one sampled commit          | that commit's row, with no change line  |
