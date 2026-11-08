@domain:findings-pane @area:totals @from:src/totals
Feature: Reading the bottom line of the findings pane
  Gives developers the total drift they carry and how much of it is work, on the pane's last row and as a count on the pane's tab, so the pane answers "how much" as well as "what".

  Background:
    Given the developer has the depwatch findings pane open

  @id:vscode.findings-pane.totals.001 @rule:findings-pane.totals.summary-line @verified @source:extensions/vscode/src/totals.ts#summaryLabel @test:extensions/vscode/src/totals.test.ts#leads with the drift and says how much of it is work @test:extensions/vscode/src/totals.test.ts#says so plainly when there is nothing to do @test:extensions/vscode/src/totals.test.ts#counts one dependency in the singular
  Scenario Outline: The summary row leads with total drift and says how many dependencies need addressing
    Given the manifests in scope have <scope>
    When the developer reads the summary row of the findings pane
    Then the summary row reads "<label>"

    Examples:
      | scope                                                      | label                                  |
      | a replace dependency 4.5 libyears behind and a healthy one | 4.50 libyears · 1 of 2 deps to address |
      | two healthy dependencies                                   | 0.00 libyears · nothing to address     |
      | a single upgrade dependency 2 libyears behind              | 2.00 libyears · 1 of 1 dep to address  |
      | no dependencies                                            | 0.00 libyears                          |

  @id:vscode.findings-pane.totals.002 @rule:findings-pane.totals.across-all-manifests @verified @source:extensions/vscode/src/totals.ts#totalsOf @test:extensions/vscode/src/totals.test.ts#adds up drift and quadrants across every manifest in scope
  Scenario: Totals add up drift and quadrants across every manifest in scope
    Given one manifest has a replace dependency 4.5 libyears behind, an upgrade dependency 2 libyears behind and a healthy one
    And another manifest has a watch dependency and a healthy one
    When the developer reads the summary row of the findings pane
    Then the summary row reads "6.50 libyears · 3 of 5 deps to address"
    And its breakdown reads "1 replace · 1 upgrade · 1 watch · 2 healthy"

  @id:vscode.findings-pane.totals.003 @rule:findings-pane.totals.unscored-not-work @verified @source:src/gates.ts#tally @test:extensions/vscode/src/totals.test.ts#counts what is off the healthy quadrant, and leaves unknowns out of it @test:extensions/vscode/src/totals.test.ts#reports unscorable deps separately from the quadrants
  Scenario: Dependencies the registry did not answer for are neither work nor healthy, and are shown as no data
    Given a manifest has a replace, an upgrade, a watch and a healthy dependency
    And it also has a dependency the registry reported as not found
    When the developer reads the summary row of the findings pane
    Then the summary row reads "5.00 libyears · 3 of 5 deps to address"
    And its breakdown reads "1 replace · 1 upgrade · 1 watch · 1 healthy · 1 no data"

  @id:vscode.findings-pane.totals.004 @rule:findings-pane.totals.quadrant-breakdown @verified @source:extensions/vscode/src/totals.ts#summaryDetail @test:extensions/vscode/src/totals.test.ts#breaks the total down, worst quadrant first, skipping empty ones
  Scenario: The summary breakdown lists quadrants worst first and skips empty ones
    Given a manifest has two replace dependencies, one watch dependency and one healthy dependency
    When the developer reads the summary row of the findings pane
    Then its breakdown reads "2 replace · 1 watch · 1 healthy"

  @id:vscode.findings-pane.totals.005 @rule:findings-pane.totals.tab-badge-mode @verified @source:extensions/vscode/src/totals.ts#badgeValue @test:extensions/vscode/src/totals.test.ts#counts the work by default, not the whole manifest @test:extensions/vscode/src/totals.test.ts#explains itself in the tooltip
  Scenario Outline: The count on the findings pane's tab follows the badge setting
    Given the workspace has a replace, two upgrade, a watch, a healthy and a no-data dependency
    And the depwatch.badge setting is "<mode>"
    When the developer looks at the findings pane's tab
    Then the tab shows the count <count>
    And hovering the count shows "<tooltip>"

    Examples:
      | mode      | count | tooltip                                                                                         |
      | toAddress | 4     | depwatch: 4 dependencies to address of 6 across the workspace — 1 replace · 2 upgrade · 1 watch |
      | total     | 6     | depwatch: 6 dependencies watched across the workspace, 4 to address                             |

  @id:vscode.findings-pane.totals.006 @rule:findings-pane.totals.no-badge-when-zero @verified @source:extensions/vscode/src/tree.ts#decorate @test:extensions/vscode/src/totals.test.ts#is zero when there is nothing to address @test:extensions/vscode/src/totals.test.ts#counts the work by default, not the whole manifest
  Scenario Outline: The findings pane's tab carries no count when there is nothing to show
    Given <situation>
    When the developer looks at the findings pane's tab
    Then the tab shows no count

    Examples:
      | situation                                                                         |
      | the badge setting is "toAddress" and every dependency in the workspace is healthy |
      | the badge setting is "off"                                                        |
