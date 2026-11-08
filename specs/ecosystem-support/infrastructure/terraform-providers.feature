@domain:ecosystem-support @area:infrastructure @from:ecosystems/terraform
Feature: Measuring Terraform and OpenTofu provider drift
  Lets infrastructure teams see how far behind the providers their Terraform or OpenTofu configuration uses are, from the lock file or from the .tf sources.

  Background:
    Given the public Terraform registry lists published versions for the providers in the project

  @id:ecosystem-support.infrastructure.023 @rule:terraform.providers.lock-file-pins-installed-version @verified @source:src/ecosystems/terraform.ts#parseLockHcl @test:src/ecosystems/phase4.test.ts#reads .terraform.lock.hcl providers and skips private registries
  Scenario: The lock file's pinned provider version is the installed version
    Given a .terraform.lock.hcl pinning provider "registry.terraform.io/hashicorp/aws" at version "5.31.0" with constraints "~> 5.0"
    When the operator checks the .terraform.lock.hcl file
    Then the manifest is identified as Terraform
    And provider "hashicorp/aws" is reported as installed at "5.31.0"
    And the version is marked as resolved, not a range floor

  @id:ecosystem-support.infrastructure.024 @rule:terraform.providers.tf-range-floor @verified @source:src/ecosystems/terraform.ts#parseTf @test:src/ecosystems/phase4.test.ts#reads required_providers ranges from a .tf file
  Scenario Outline: A provider declared in a .tf file is measured from the floor of its version constraint
    Given a <file> whose required_providers declares source "hashicorp/aws" with version "<constraint>"
    When the operator checks the <file> file
    Then provider "hashicorp/aws" is reported as installed at "<floor>"
    And the version is marked as a range floor, not resolved

    Examples:
      | file         | constraint    | floor  |
      | main.tf      | ~> 5.31       | 5.31   |
      | versions.tf  | >= 4.0, < 6.0 | 4.0    |
      | providers.tf | 5.31.0        | 5.31.0 |

  @id:ecosystem-support.infrastructure.025 @rule:terraform.providers.private-registries-skipped @verified @source:src/ecosystems/terraform.ts#providerId @test:src/ecosystems/phase4.test.ts#reads .terraform.lock.hcl providers and skips private registries
  Scenario Outline: Providers from private registries are left out instead of guessed at
    Given a <file> that references provider "<address>"
    When the operator checks the <file> file
    Then no dependency is reported for "<address>"
    And providers from registry.terraform.io or registry.opentofu.org in the same file are still reported

    Examples:
      | file                | address                       |
      | .terraform.lock.hcl | app.terraform.io/acme/private |
      | main.tf             | tfe.example.com/acme/network  |

  @id:ecosystem-support.infrastructure.026 @rule:terraform.providers.major-only-constraint-dropped @inferred @source:src/ecosystems/terraform.ts#parseTf @questionable
  Scenario: A provider whose constraint names only a major version is not reported
    Given a main.tf whose required_providers declares source "hashicorp/random" with version "~> 3"
    When the operator checks the main.tf file
    Then no dependency is reported for "hashicorp/random"
    And no warning names the dropped provider

  @id:ecosystem-support.infrastructure.027 @rule:terraform.providers.counted-once @inferred @source:src/ecosystems/terraform.ts#parseTf
  Scenario Outline: A provider listed more than once in a file is counted once
    Given a <file> that references provider "hashicorp/aws" twice, first at "<first>" then at "<second>"
    When the operator checks the <file> file
    Then provider "hashicorp/aws" is reported once, at "<reported>"

    Examples:
      | file                | first   | second  | reported |
      | .terraform.lock.hcl | 5.31.0  | 5.40.0  | 5.31.0   |
      | main.tf             | ~> 5.31 | ~> 5.40 | 5.31     |

  @id:ecosystem-support.infrastructure.028 @rule:terraform.providers.modules-not-measured @inferred @source:src/ecosystems/terraform.ts#parseTf
  Scenario: Terraform modules are not measured, only providers
    Given a main.tf with a module "vpc" block sourcing "terraform-aws-modules/vpc/aws" at version "5.1.0"
    When the operator checks the main.tf file
    Then no dependency is reported for the vpc module

  @id:ecosystem-support.infrastructure.029 @rule:terraform.providers.opentofu-looked-up-on-terraform-registry @inferred @source:src/ecosystems/terraform.ts#terraform @questionable
  Scenario: OpenTofu providers are looked up on the Terraform registry
    Given a .terraform.lock.hcl pinning provider "registry.opentofu.org/opentofu/example" at version "1.2.0"
    When the operator checks the .terraform.lock.hcl file
    Then provider "opentofu/example" is reported
    And its published versions and dates come from registry.terraform.io, not registry.opentofu.org
