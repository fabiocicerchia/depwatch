@domain:automatic-rescans @area:scan-coalescing @from:src/schedule
Feature: Not scanning the same manifest twice at once
  Developers get one scan per manifest at a time, so overlapping triggers share a result instead of doubling the work and registry traffic.

  Background:
    Given Given a workspace with the manifest "package.json"

  @id:vscode.automatic-rescans.scan-coalescing.001 @rule:automatic-rescans.scan-coalescing.joins-in-flight-scan @verified @source:extensions/vscode/src/schedule.ts#Coalescer @test:extensions/vscode/src/schedule.test.ts#joins a second request to the one already running
  Scenario: A scan requested while the same manifest is already being scanned joins it
    Given Given a scan of "package.json" is in progress
    When When another scan of "package.json" is requested
    Then Then no second scan of "package.json" starts
    And And both requests receive the findings of the scan already in progress

  @id:vscode.automatic-rescans.scan-coalescing.002 @rule:automatic-rescans.scan-coalescing.next-scan-runs-after-finish-or-failure @verified @source:extensions/vscode/src/schedule.ts#Coalescer @test:extensions/vscode/src/schedule.test.ts#lets the next request start once the first finished @test:extensions/vscode/src/schedule.test.ts#releases the key when the task rejects
  Scenario Outline: A manifest can be scanned again once its previous scan has finished or failed
    Given Given the previous scan of "package.json" has <outcome>
    When When a new scan of "package.json" is requested
    Then Then a new scan of "package.json" runs
    And And its findings replace the earlier result

    Examples:
      | outcome              |
      | finished             |
      | failed with an error |
