@domain:ecosystem-support @area:python @from:ecosystems/conda
Feature: Measuring drift in conda environments
  Lets data-science and Python teams who manage packages with conda see how far their environment.yml and conda-lock.yml dependencies lag behind the conda channels they come from.

  Background:
    Given a project whose packages are managed with conda

  @id:ecosystem-support.python.001 @rule:conda.detection.recognised-file-names @verified @source:src/ecosystems/conda.ts#conda @test:src/ecosystems/phase3.test.ts#reads environment.yml specs and skips python and pip block
  Scenario Outline: conda environment and lock files are recognised by name
    Given the project has a file named <file>
    When the operator checks <file>
    Then the report's ecosystem is "conda"

    Examples:
      | file             |
      | environment.yml  |
      | environment.yaml |
      | conda-lock.yml   |

  @id:ecosystem-support.python.002 @rule:conda.environment.reads-declared-specs @verified @source:src/ecosystems/conda.ts#condaSpec @test:src/ecosystems/phase3.test.ts#reads environment.yml specs and skips python and pip block
  Scenario Outline: An environment file's exact pins and lower bounds become the installed versions
    Given the environment file lists the dependency "<entry>"
    When the operator checks the environment file
    Then the report lists "<package>" at version "<version>"
    And the dependency is marked pinned: <pinned>

    Examples:
      | entry                    | package | version | pinned |
      | numpy=1.26.4             | numpy   | 1.26.4  | yes    |
      | numpy==1.26.4            | numpy   | 1.26.4  | yes    |
      | conda-forge::pandas>=2.0 | pandas  | 2.0     | no     |
      | scipy>=1.11.0,<2         | scipy   | 1.11.0  | no     |

  @id:ecosystem-support.python.003 @rule:conda.environment.skips-unscorable-entries @verified @source:src/ecosystems/conda.ts#condaSpec @test:src/ecosystems/phase3.test.ts#reads environment.yml specs and skips python and pip block @questionable
  Scenario Outline: The Python interpreter, pip sub-lists and unversioned entries are left out of a conda environment's report
    Given the environment file lists the dependency entry <entry>
    When the operator checks the environment file
    Then the report does not list <package>

    Examples:
      | entry                                          | package  |
      | python=3.11                                    | python   |
      | a nested pip: list containing requests==2.31.0 | requests |
      | scipy (no version)                             | scipy    |
      | openssl=3 (major version only)                 | openssl  |

  @id:ecosystem-support.python.004 @rule:conda.lock.reports-every-locked-package @inferred @source:src/ecosystems/conda.ts#parseCondaLock @questionable
  Scenario: A conda lock file reports every locked package at its exact version, including transitive and pip-installed ones
    Given conda-lock.yml locks numpy 1.26.4 for linux-64 and osx-arm64
    And it also locks libblas 3.9.0, pulled in by numpy
    And it also locks requests 2.31.0 installed by pip
    When the operator checks conda-lock.yml without asking for transitive dependencies
    Then the report lists numpy at 1.26.4 once, marked pinned
    And the report lists libblas at 3.9.0 and requests at 2.31.0

  @id:ecosystem-support.python.005 @rule:conda.registry.channel-qualified-lookup @inferred @source:src/ecosystems/conda.ts#condaSpec @questionable
  Scenario: Channel-qualified packages are looked up on conda-forge, not on their named channel
    Given the environment file lists "bioconda::samtools=1.19"
    When the operator checks the environment file
    Then the report lists "samtools" without its channel
    And its latest version is taken from the conda-forge channel on anaconda.org

  @id:ecosystem-support.python.006 @rule:conda.versions.epoch-orders-first @inferred @source:src/ecosystems/conda.ts#condaOps
  Scenario: A conda version with a higher epoch counts as newer whatever its version number
    Given a conda package has published versions "9.9.9" and "1!1.0.0"
    When the operator checks a project that depends on it
    Then the package's latest version is reported as "1!1.0.0"

  @id:ecosystem-support.python.007 @rule:conda.registry.release-dates-from-uploads @inferred @source:src/ecosystems/conda.ts#conda
  Scenario Outline: conda release dates come from the upload time of each version's files, or are left unknown
    Given anaconda.org lists <listing> for a package
    When the operator checks a project that depends on it
    Then each version's release date is <release date>

    Examples:
      | listing                             | release date                                            |
      | uploaded files with upload times    | the first-listed file's upload time for that version    |
      | only version numbers, without files | unknown                                                 |
