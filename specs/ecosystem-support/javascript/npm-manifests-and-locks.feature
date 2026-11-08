@domain:ecosystem-support @area:javascript @from:libyear/engine
Feature: Reading npm manifests and lock files
  Lets JavaScript teams score drift from package.json or any npm, Yarn or pnpm lock file, telling declared ranges apart from installed versions.

  @id:ecosystem-support.javascript.011 @rule:javascript.package-json.range-floor-is-unresolved @verified @source:src/lib/libyear/engine.ts#parsePackageJson @test:src/lib/engine.test.ts#reads package.json ranges as unresolved floors
  Scenario Outline: A package.json range is read as its floor version and marked as not resolved
    Given package.json declares "react" as <range> in <section>
    When the operator checks the manifest
    Then "react" is listed at <version>
    And "react" is marked as not resolved

    Examples:
      | range   | section              | version |
      | ^18.3.1 | dependencies         | 18.3.1  |
      | ~2.1.2  | devDependencies      | 2.1.2   |
      | >=1.4   | optionalDependencies | 1.4     |

  @id:ecosystem-support.javascript.012 @rule:javascript.package-json.non-registry-specs-skipped @verified @source:src/lib/libyear/engine.ts#rangeFloor @test:src/lib/engine.test.ts#reads package.json ranges as unresolved floors @questionable
  Scenario Outline: Dependencies that do not point to a registry version are left out of the report
    Given package.json declares "local-lib" as <spec>
    When the operator checks the manifest
    Then "local-lib" does not appear in the report

    Examples:
      | spec                                       |
      | file:../local-lib                          |
      | workspace:*                                |
      | git+https://example.com/acme/local-lib.git |
      | acme/local-lib#v1.2.3                      |
      | latest                                     |

  @id:ecosystem-support.javascript.013 @rule:javascript.package-json.peer-dependencies-not-counted @inferred @source:src/lib/libyear/engine.ts#parsePackageJson
  Scenario: Peer dependencies do not count toward the project's drift
    Given package.json declares "react" only under peerDependencies
    When the operator checks the manifest
    Then "react" does not appear in the report

  @id:ecosystem-support.javascript.014 @rule:javascript.lockfiles.installed-version-is-resolved @verified @source:src/lib/libyear/engine.ts#parseManifest @test:src/lib/engine.test.ts#reads package-lock v3 paths and v1 trees alike @test:src/lib/engine.test.ts#reads yarn v1 and berry entries, scopes included @test:src/lib/engine.test.ts#reads both pnpm key spellings and drops peer suffixes
  Scenario Outline: Lock files report the installed version of each package and mark it resolved
    Given a <lock> records "react" installed at 18.3.1
    When the operator checks the lock file
    Then "react" is listed at 18.3.1
    And "react" is marked as resolved

    Examples:
      | lock                 |
      | package-lock.json v3 |
      | package-lock.json v1 |
      | yarn.lock v1         |
      | yarn.lock berry      |
      | pnpm-lock.yaml v6    |
      | pnpm-lock.yaml v9    |

  @id:ecosystem-support.javascript.015 @rule:javascript.lockfiles.one-entry-per-package @inferred @source:src/lib/libyear/engine.ts#parsePackageLock @questionable
  Scenario: A package installed at several versions is reported once, at the first version the lock lists
    Given a package-lock.json lists "debug" at 2.6.9 under "node_modules/body-parser/node_modules/debug"
    And the same lock lists "debug" at 4.3.4 under "node_modules/debug"
    When the operator checks the lock file
    Then "debug" appears once in the report, at 2.6.9

  @id:ecosystem-support.javascript.016 @rule:javascript.detection.content-over-filename @verified @source:src/lib/libyear/engine.ts#detectKind @test:src/lib/engine.test.ts#tells a lock file from the manifest beside it
  Scenario Outline: A lock file is read as a lock file whatever it is named
    Given a file named "package.json" contains <content>
    When the operator checks the file
    Then its dependencies are reported at the installed versions, marked as resolved

    Examples:
      | content                                        |
      | a package-lock document with a lockfileVersion |
      | a yarn lockfile                                |
      | a pnpm lockfile                                |
