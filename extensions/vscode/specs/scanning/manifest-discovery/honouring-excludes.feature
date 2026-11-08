@domain:scanning @area:manifest-discovery @from:src/exclude
Feature: Honouring the project's excludes
  Developers rely on the folders they have already hidden from VS Code, plus depwatch's own exclude list, being left out of scans and automatic rescans, so vendored and build copies of manifests never pollute their findings.

  Background:
    Given the workspace contains manifests at its root and in nested folders

  @id:vscode.scanning.manifest-discovery.003 @rule:scanning.excludes.editor-excludes-merged @verified @source:extensions/vscode/src/exclude.ts#combine @test:extensions/vscode/src/exclude.test.ts#folds several globs into one brace group @test:extensions/vscode/src/exclude.test.ts#drops duplicates, which the merge produces constantly
  Scenario: A workspace scan skips folders hidden by depwatch or by the editor
    Given depwatch's exclude setting lists "**/node_modules/**"
    And the editor's files.exclude hides "**/vendor"
    And editor excludes are in use
    When the developer scans the whole workspace
    Then no manifest under a node_modules folder is scanned
    And no manifest under a vendor folder is scanned
    And the root manifest is scanned

  @id:vscode.scanning.manifest-discovery.004 @rule:scanning.excludes.excluded-folders-not-rescanned @verified @source:extensions/vscode/src/exclude.ts#isExcludedPath @test:extensions/vscode/src/exclude.test.ts#matches a whole segment anywhere in the path @test:extensions/vscode/src/exclude.test.ts#leaves ordinary paths alone @test:extensions/vscode/src/exclude.test.ts#does not match a partial segment @test:extensions/vscode/src/exclude.test.ts#reads a directory in the middle of a pattern even with a dot in it @test:extensions/vscode/src/exclude.test.ts#takes the directories out of depwatch and editor globs alike
  Scenario Outline: A change inside an excluded folder does not trigger a rescan, a look-alike folder does
    Given the excludes include "<pattern>"
    And rescan on save is enabled
    When the manifest at "<path>" changes
    Then depwatch rescans it: <rescanned>

    Examples:
      | pattern            | path                                  | rescanned |
      | **/node_modules/** | /repo/node_modules/react/package.json | no        |
      | **/dist/**         | /repo/apps/api/dist/package.json      | no        |
      | **/target/**       | C:\repo\target\package.json           | no        |
      | **/my.folder/**    | /repo/my.folder/package.json          | no        |
      | **/dist/**         | /repo/my-dist-tools/package.json      | yes       |
      | **/node_modules/** | /repo/node_modules_old/package.json   | yes       |
      | **/dist/**         | /repo/apps/api/package.json           | yes       |

  @id:vscode.scanning.manifest-discovery.005 @rule:scanning.excludes.hidden-files-still-rescan @verified @source:extensions/vscode/src/exclude.ts#directoryNames @test:extensions/vscode/src/exclude.test.ts#does not treat an excluded filename as an excluded directory
  Scenario Outline: A file hidden from search still triggers rescans when it changes
    Given the editor's search.exclude hides "<pattern>"
    And rescan on save is enabled
    When "<file>" in the project root changes
    Then depwatch rescans the manifests it feeds

    Examples:
      | pattern              | file              |
      | **/package-lock.json | package-lock.json |
      | **/*.log             | npm-debug.log     |

  @id:vscode.scanning.manifest-discovery.006 @rule:scanning.excludes.literal-prefix-excludes-every-same-named-folder @verified @source:extensions/vscode/src/exclude.ts#directoryNames @test:extensions/vscode/src/exclude.test.ts#ignores segments that are themselves patterns @questionable
  Scenario: A folder named literally in an exclude pattern stops rescans for every folder with that name
    Given the editor's search.exclude hides "packages/*/node_modules/**"
    And rescan on save is enabled
    When the manifest at "/repo/packages/api/package.json" is saved
    Then depwatch does not rescan it

  @id:vscode.scanning.manifest-discovery.007 @rule:scanning.excludes.editor-excludes-apply-when-nothing-excluded @verified @source:extensions/vscode/src/exclude.ts#combine @test:extensions/vscode/src/exclude.test.ts#leaves a lone glob alone and gives nothing for none @questionable
  Scenario: With editor excludes turned off and no own excludes, the editor's excludes still apply to discovery
    Given depwatch's exclude setting is empty
    And editor excludes are turned off
    And the editor's files.exclude hides "**/vendor"
    When the developer scans the whole workspace
    Then no manifest under a vendor folder is scanned
