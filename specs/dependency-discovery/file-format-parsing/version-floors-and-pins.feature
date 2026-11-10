@domain:dependency-discovery @area:file-format-parsing @from:ecosystems/parse-util
Feature: Reading stated versions from manifests and lock files
  Lets a developer trust which version each dependency is measured from: a lock file's exact pin, or a manifest range's floor reported as an upper-bound estimate.

  Background:
    Given the developer runs a depwatch check on a project's dependency files

  @id:dependency-discovery.file-format-parsing.001 @rule:dependency-discovery.ranges.floor-taken-as-installed @verified @source:src/ecosystems/parse-util.ts#baseVersion @test:src/manifest.test.ts#reads Cargo dependency tables in all three spellings @test:src/ecosystems/python.test.ts#reads a poetry [tool.poetry.dependencies] table
  Scenario Outline: A version range is measured from its floor and reported as an estimate
    Given the manifest states <dependency> as "<range>"
    When the developer checks the manifest
    Then <dependency> is measured from version <floor>
    And the dependency counts towards the "upper bound" note that its version came from a range, not a lock file

    Examples:
      | dependency      | range    | floor  |
      | tokio           | ^1.38    | 1.38   |
      | requests        | ^2.31.0  | 2.31.0 |
      | django          | >=4.2,<5 | 4.2    |
      | monolog/monolog | ~3.5.0   | 3.5.0  |

  @id:dependency-discovery.file-format-parsing.002 @rule:dependency-discovery.ranges.major-only-range-not-measured @inferred @source:src/ecosystems/parse-util.ts#baseVersion @questionable
  Scenario Outline: A range that names only a major version is left out of the report
    Given the manifest states <dependency> as "<range>"
    When the developer checks the manifest
    Then <dependency> does not appear in the report

    Examples:
      | dependency | range |
      | serde      | 1     |
      | requests   | ^2    |
      | anyhow     | *     |

  @id:dependency-discovery.file-format-parsing.003 @rule:dependency-discovery.python.exact-pin-is-resolved @verified @source:src/ecosystems/parse-util.ts#parsePep508 @test:src/ecosystems/python.test.ts#reads a PEP 621 [project] dependencies array (uv/pip)
  Scenario Outline: A Python requirement pinned with == counts as exact; any other operator is an estimate
    Given the Python project declares the requirement "<requirement>"
    When the developer checks the project
    Then <name> is measured from version <version>
    And <name> is <counted_as>

    Examples:
      | requirement                                   | name     | version | counted_as       |
      | httpx==0.27.0                                 | httpx    | 0.27.0  | an exact version |
      | requests>=2.31.0                              | requests | 2.31.0  | a range estimate |
      | requests[security]>=2.0; python_version<'3.9' | requests | 2.0     | a range estimate |
      | attrs~=23.1                                   | attrs    | 23.1    | a range estimate |

  @id:dependency-discovery.file-format-parsing.004 @rule:dependency-discovery.python.unversioned-requirement-omitted @verified @source:src/ecosystems/parse-util.ts#parsePep508 @test:src/ecosystems/python.test.ts#reads a PEP 621 [project] dependencies array (uv/pip)
  Scenario Outline: A Python requirement with no version is left out of the report
    Given the Python project declares the requirement "<requirement>"
    When the developer checks the project
    Then no dependency from "<requirement>" appears in the report

    Examples:
      | requirement    |
      | rich           |
      | # pinned below |
      | -r base.txt    |

  @id:dependency-discovery.file-format-parsing.005 @rule:dependency-discovery.python.upper-bound-read-as-floor @inferred @source:src/ecosystems/parse-util.ts#parsePep508 @questionable
  Scenario Outline: A Python requirement with only an upper bound or exclusion is measured from that bound
    Given the Python project declares the requirement "<requirement>"
    When the developer checks the project
    Then <name> is measured from version <version>
    And <name> is a range estimate

    Examples:
      | requirement   | name    | version |
      | urllib3<2     | urllib3 | 2       |
      | numpy<=1.26   | numpy   | 1.26    |
      | django!=4.0.1 | django  | 4.0.1   |

  @id:dependency-discovery.file-format-parsing.006 @rule:dependency-discovery.python-locks.exact-versions @verified @source:src/ecosystems/parse-util.ts#parsePackageArrayLock @test:src/ecosystems/python.test.ts#reads exact versions from poetry.lock / uv.lock
  Scenario Outline: Poetry and uv lock files supply exact versions for every locked package
    Given the project has a <lock_file> locking certifi at 2024.2.2 and charset-normalizer at 3.3.2
    When the developer checks the lock file
    Then certifi is measured from exact version 2024.2.2
    And charset-normalizer is measured from exact version 3.3.2
    And neither counts towards the "upper bound" note

    Examples:
      | lock_file   |
      | poetry.lock |
      | uv.lock     |

  @id:dependency-discovery.file-format-parsing.007 @rule:dependency-discovery.python-locks.first-locked-version-wins @inferred @source:src/ecosystems/parse-util.ts#parsePackageArrayLock @questionable
  Scenario: A package locked at more than one version is reported once, at the first version listed
    Given the uv.lock locks numpy at 1.24.4 and, in a later block, at 1.26.4
    When the developer checks the lock file
    Then numpy appears once in the report
    And numpy is measured from version 1.24.4
