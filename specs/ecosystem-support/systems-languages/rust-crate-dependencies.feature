@domain:ecosystem-support @area:systems-languages @from:ecosystems/cargo
Feature: Reading Rust crate dependencies
  Lets Rust teams point depwatch at a Cargo.toml or Cargo.lock so every crate they depend on is measured against crates.io.

  Background:
    Given a Rust project whose dependencies are published on crates.io

  @id:ecosystem-support.systems-languages.001 @rule:cargo.manifest.declared-floor-version @inferred @source:src/ecosystems/cargo.ts#parseCargoToml
  Scenario Outline: Every way of declaring a crate version in Cargo.toml is read as its floor version
    Given a Cargo.toml whose <table> section declares <crate> as <declaration>
    When the developer checks the Cargo.toml
    Then the report lists <crate> at version <floor>

    Examples:
      | table                             | crate     | declaration                                       | floor   |
      | [dependencies]                    | serde     | serde = "1.0"                                     | 1.0     |
      | [dependencies]                    | tokio     | tokio = { version = "1.38", features = ["full"] } | 1.38    |
      | [dependencies.regex]              | regex     | version = "^1.10.2" on its own line               | 1.10.2  |
      | [dev-dependencies]                | criterion | criterion = "~0.5.1"                              | 0.5.1   |
      | [build-dependencies]              | cc        | cc = ">=1.0.83"                                   | 1.0.83  |
      | [target.'cfg(unix)'.dependencies] | libc      | libc = "0.2.155"                                  | 0.2.155 |

  @id:ecosystem-support.systems-languages.002 @rule:cargo.manifest.unversioned-crates-omitted @inferred @source:src/ecosystems/cargo.ts#cargoVersion @questionable
  Scenario Outline: Crates declared without a two-part version are left out of the report
    Given a Cargo.toml whose [dependencies] declares <declaration>
    When the developer checks the Cargo.toml
    Then the report does not list <crate>
    And no warning names <crate>

    Examples:
      | declaration                                     | crate           |
      | anyhow = "1"                                    | anyhow          |
      | mylib = { path = "../mylib" }                   | mylib           |
      | rand = { git = "https://example.com/rand.git" } | rand            |
      | serde.workspace = true                          | serde.workspace |

  @id:ecosystem-support.systems-languages.003 @rule:cargo.lock.exact-resolved-versions @verified @source:src/ecosystems/cargo.ts#parseCargoLock @test:src/lockfile.test.ts#reads exact versions from Cargo.lock
  Scenario: Cargo.lock supplies the exact installed version of each crate
    Given a Cargo.lock locking serde at 1.0.219 and tokio at 1.44.2
    When the developer checks the Cargo.lock
    Then the report lists serde at 1.0.219 as a resolved version
    And the report lists tokio at 1.44.2 as a resolved version

  @id:ecosystem-support.systems-languages.004 @rule:cargo.lock.every-locked-package-scored @inferred @source:src/ecosystems/cargo.ts#parseCargoLock @questionable
  Scenario: Checking Cargo.lock scores every locked crate, including transitive ones and the project itself
    Given a Cargo.lock for the crate acme-cli 0.3.0 that depends directly on serde, which pulls in serde_derive
    When the developer checks the Cargo.lock without asking for transitive dependencies
    Then the report lists serde
    And the report lists serde_derive
    And the report lists acme-cli at 0.3.0

  @id:ecosystem-support.systems-languages.005 @rule:cargo.deep.repository-from-crates-io @inferred @source:src/ecosystems/cargo.ts#cargo @questionable
  Scenario: Deep checks of a crate take its repository from crates.io and report no funding
    Given serde is published on crates.io with repository https://github.com/serde-rs/serde
    When the developer runs a deep check of a Cargo manifest that depends on serde
    Then serde's repository is https://github.com/serde-rs/serde
    And serde's maintainer count is unknown
    And serde is reported as not funded
