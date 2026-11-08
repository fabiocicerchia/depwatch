@domain:automatic-rescans @area:lockfile-changes @from:src/extension
Feature: Rescanning after a lock file changes
  Developers who run npm install or cargo update see the new resolved versions without touching the manifest, because the manifests beside the changed lock file are rescanned.

  Background:
    Given depwatch is enabled with rescan on save on

  @id:vscode.automatic-rescans.lockfile-changes.001 @rule:automatic-rescans.lockfile.rescan-sibling-manifests @verified @source:extensions/vscode/src/extension.ts#staleFor @test:extensions/vscode/src/extension.test.ts#watches the manifests it scans and the locks that change them @questionable
  Scenario: A changed lock file rescans the scanned manifests in the same folder
    Given depwatch has scanned /repo/package.json and /repo/web/package.json
    When a package manager rewrites /repo/package-lock.json
    Then /repo/package.json is rescanned after the debounce period
    And /repo/web/package.json is not rescanned
