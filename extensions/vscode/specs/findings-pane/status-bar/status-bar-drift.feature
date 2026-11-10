@domain:findings-pane @area:status-bar @from:src/status
Feature: Total drift in the status bar
  Gives developers the project's total drift, its replace-quadrant count and any breached CI gate at a glance in the editor's status bar corner, all day.

  Background:
    Given the depwatch extension is active in a workspace

  @id:vscode.findings-pane.status-bar.001 @rule:findings.status-bar.shows-total-drift @inferred @source:extensions/vscode/src/status.ts#StatusBar
  Scenario Outline: The status bar shows total drift across every scanned manifest, plus the replace count when there is one
    Given scanned manifests whose drift adds up to <libyears> libyears
    And <replace> dependencies across them are in the replace quadrant
    When the developer looks at the status bar
    Then the status bar reads "<text>"

    Examples:
      | libyears | replace | text                |
      | 12.3456  | 0       | 12.35 ly            |
      | 4.5      | 2       | 4.50 ly · 2 replace |

  @id:vscode.findings-pane.status-bar.002 @rule:findings.status-bar.tooltip-summary-opens-report @inferred @source:extensions/vscode/src/status.ts#StatusBar
  Scenario: Hovering the drift figure explains it, and clicking it opens the full report
    Given two scanned manifests with 7.20 libyears across 40 dependencies
    And nothing is in the replace quadrant
    When the developer hovers over the drift figure in the status bar
    Then the tooltip reads "depwatch — 7.20 libyears across 40 dependencies in 2 manifest(s)"
    And the tooltip says "nothing in the replace quadrant"
    And the tooltip ends with "Click for the full report."
    And clicking the figure opens the depwatch report

  @id:vscode.findings-pane.status-bar.003 @rule:findings.status-bar.failing-gate-warns @inferred @source:extensions/vscode/src/status.ts#StatusBar
  Scenario: A breached CI gate turns the drift figure into a warning and names the gate
    Given the project sets a maximum drift of 5 libyears as a CI gate
    And a scanned manifest has 6.40 libyears of drift
    When the developer looks at the status bar
    Then the drift figure shows on the warning background colour
    And the tooltip lists "gate: total drift 6.40 libyears exceeds --max-libyears 5"

  @id:vscode.findings-pane.status-bar.004 @rule:findings.status-bar.hidden-when-off-or-empty @inferred @source:extensions/vscode/src/status.ts#StatusBar
  Scenario Outline: The drift figure is hidden when the setting is off or nothing has been scanned
    Given the "Show total drift in the status bar" setting is <setting>
    And <manifests> manifests have been scanned
    When the developer looks at the status bar
    Then no depwatch drift figure is shown

    Examples:
      | setting | manifests |
      | off     | 3         |
      | on      | 0         |

  @id:vscode.findings-pane.status-bar.005 @rule:findings.status-bar.scanning-indicator @inferred @source:extensions/vscode/src/status.ts#StatusBar @questionable
  Scenario Outline: A spinning depwatch indicator shows while a scan runs, even with the status bar figure turned off
    Given the "Show total drift in the status bar" setting is <setting>
    When the developer starts a scan
    Then the status bar shows a spinning "depwatch" indicator with the tooltip "Scanning dependencies"
    And once every running scan has finished, the status bar returns to <after>

    Examples:
      | setting | after                      |
      | on      | the total drift figure     |
      | off     | showing no depwatch figure |
