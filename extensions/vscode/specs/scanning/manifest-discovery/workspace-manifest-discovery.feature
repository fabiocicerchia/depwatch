@domain:scanning @area:manifest-discovery @from:src/engine
Feature: Finding the manifests to scan in a workspace
  Lets a developer scan a whole workspace or monorepo and get the manifests they most likely mean, without the editor drowning in thousands of files.

  Background:
    Given a workspace is open in the editor

  @id:vscode.scanning.manifest-discovery.001 @rule:scanning.discovery.shallowest-first-capped @inferred @source:extensions/vscode/src/engine.ts#findManifests
  Scenario Outline: Workspace manifests are scanned shallowest first, up to the manifest limit, skipping excluded folders
    Given the workspace contains the manifests <manifests>
    And the folder "node_modules" is excluded
    And the manifest limit is <limit>
    When the developer scans the whole workspace
    Then the manifests scanned are <scanned>, in that order

    Examples:
      | manifests                                                                                    | limit | scanned                                                    |
      | package.json, apps/web/package.json, apps/api/package.json, node_modules/lodash/package.json | 10    | package.json, apps/api/package.json, apps/web/package.json |
      | package.json, apps/web/package.json, apps/api/package.json                                   | 2     | package.json, apps/api/package.json                        |

  @id:vscode.scanning.manifest-discovery.002 @rule:scanning.discovery.limit-reached-skips-later-patterns @inferred @source:extensions/vscode/src/engine.ts#findManifests @questionable
  Scenario: Once the manifest limit is reached, manifests matching later file patterns are not considered
    Given the manifest patterns are "**/package.json" then "**/Cargo.toml"
    And the workspace has 3 nested package.json files and a Cargo.toml at its root
    And the manifest limit is 3
    When the developer scans the whole workspace
    Then the 3 nested package.json manifests are scanned
    And the root Cargo.toml is not scanned
