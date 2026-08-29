# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.1](https://github.com/fabiocicerchia/depwatch/compare/v1.6.0...v1.6.1) (2026-08-29)


### Bug Fixes

* unblock quality and clear the Scorecard pinned-dependencies finding ([#46](https://github.com/fabiocicerchia/depwatch/issues/46)) ([ab58b13](https://github.com/fabiocicerchia/depwatch/commit/ab58b13acd2849a3e705033ce26dd04995ca9339))

## [1.6.0](https://github.com/fabiocicerchia/depwatch/compare/v1.5.0...v1.6.0) (2026-08-25)


### Features

* **docs:** build the docs site in Actions and drop Read the Docs ([#44](https://github.com/fabiocicerchia/depwatch/issues/44)) ([aec7e57](https://github.com/fabiocicerchia/depwatch/commit/aec7e575edf741f266fc0a89383f28cd620990e0))
* **nvim:** depwatch.nvim, a Neovim port of the editor integration ([#34](https://github.com/fabiocicerchia/depwatch/issues/34)) ([b9af2c5](https://github.com/fabiocicerchia/depwatch/commit/b9af2c551808f3d4714b7b929eec806ef5d08813))


### Bug Fixes

* **ci:** compute the next release PR after the draft is published ([#42](https://github.com/fabiocicerchia/depwatch/issues/42)) ([aa98520](https://github.com/fabiocicerchia/depwatch/commit/aa98520d1ff45811413d3c8246732c7bd29a3b3d))


### Performance Improvements

* make a scan cheaper in the editor, and cache the dates it was refetching ([#45](https://github.com/fabiocicerchia/depwatch/issues/45)) ([61f0d24](https://github.com/fabiocicerchia/depwatch/commit/61f0d24b6de788ea34c07f9e363ef13b3bfc4237))

## [1.5.0](https://github.com/fabiocicerchia/depwatch/compare/v1.4.0...v1.5.0) (2026-08-24)


### Features

* add a GitHub Action and a drift ratchet gate ([#32](https://github.com/fabiocicerchia/depwatch/issues/32)) ([3bb6ee7](https://github.com/fabiocicerchia/depwatch/commit/3bb6ee7c1b088c1ce557baf2a7f75ed6339ed5f6))
* **cli:** honour a baseline in check, and share it with the editor ([#33](https://github.com/fabiocicerchia/depwatch/issues/33)) ([91422d8](https://github.com/fabiocicerchia/depwatch/commit/91422d8da9d8874bf8cae68df50251e02c032090))
* **vscode:** drift × viability in the editor ([d676ce3](https://github.com/fabiocicerchia/depwatch/commit/d676ce3f43e35318b988367c615793484ae71ca6))


### Bug Fixes

* **ci:** create the Open VSX namespace before publishing into it ([#28](https://github.com/fabiocicerchia/depwatch/issues/28)) ([cf0a67a](https://github.com/fabiocicerchia/depwatch/commit/cf0a67a38a1561b2b4aae212c62daa2d08e65222))
* **ci:** stop security workflows failing on private repos ([#6](https://github.com/fabiocicerchia/depwatch/issues/6)) ([b4cb3ba](https://github.com/fabiocicerchia/depwatch/commit/b4cb3badbefd1d48d1c9db44871c3bef5b893d22))
* exempt tsconfig.json from check-json ([a4ffc59](https://github.com/fabiocicerchia/depwatch/commit/a4ffc5964a246a452afacc228b499bcb95ef9474))
* **pre-commit:** stop check-yaml failing on Helm templates and multi-doc manifests ([11129e5](https://github.com/fabiocicerchia/depwatch/commit/11129e59c30647f55266dc8e7f57fd24020b9ffd))
* security and code-quality findings ([#15](https://github.com/fabiocicerchia/depwatch/issues/15)) ([1ecb13b](https://github.com/fabiocicerchia/depwatch/commit/1ecb13bcf4df50a021e5488618687dc73f3b0a30))
* **vscode:** find every supported ecosystem, and polish the Marketplace listing ([#37](https://github.com/fabiocicerchia/depwatch/issues/37)) ([03753ad](https://github.com/fabiocicerchia/depwatch/commit/03753ad6e957ff574cbb689c605233aad1bf7342))

## [1.4.0](https://github.com/fabiocicerchia/depwatch/compare/v1.3.0...v1.4.0) (2026-08-24)


### Features

* add a GitHub Action and a drift ratchet gate ([#32](https://github.com/fabiocicerchia/depwatch/issues/32)) ([3bb6ee7](https://github.com/fabiocicerchia/depwatch/commit/3bb6ee7c1b088c1ce557baf2a7f75ed6339ed5f6))
* **cli:** honour a baseline in check, and share it with the editor ([#33](https://github.com/fabiocicerchia/depwatch/issues/33)) ([91422d8](https://github.com/fabiocicerchia/depwatch/commit/91422d8da9d8874bf8cae68df50251e02c032090))
* **vscode:** drift × viability in the editor ([d676ce3](https://github.com/fabiocicerchia/depwatch/commit/d676ce3f43e35318b988367c615793484ae71ca6))


### Bug Fixes

* **ci:** create the Open VSX namespace before publishing into it ([#28](https://github.com/fabiocicerchia/depwatch/issues/28)) ([cf0a67a](https://github.com/fabiocicerchia/depwatch/commit/cf0a67a38a1561b2b4aae212c62daa2d08e65222))
* **ci:** stop security workflows failing on private repos ([#6](https://github.com/fabiocicerchia/depwatch/issues/6)) ([b4cb3ba](https://github.com/fabiocicerchia/depwatch/commit/b4cb3badbefd1d48d1c9db44871c3bef5b893d22))
* exempt tsconfig.json from check-json ([a4ffc59](https://github.com/fabiocicerchia/depwatch/commit/a4ffc5964a246a452afacc228b499bcb95ef9474))
* **pre-commit:** stop check-yaml failing on Helm templates and multi-doc manifests ([11129e5](https://github.com/fabiocicerchia/depwatch/commit/11129e59c30647f55266dc8e7f57fd24020b9ffd))
* security and code-quality findings ([#15](https://github.com/fabiocicerchia/depwatch/issues/15)) ([1ecb13b](https://github.com/fabiocicerchia/depwatch/commit/1ecb13bcf4df50a021e5488618687dc73f3b0a30))
* **vscode:** find every supported ecosystem, and polish the Marketplace listing ([#37](https://github.com/fabiocicerchia/depwatch/issues/37)) ([03753ad](https://github.com/fabiocicerchia/depwatch/commit/03753ad6e957ff574cbb689c605233aad1bf7342))

## [1.3.0](https://github.com/fabiocicerchia/depwatch/compare/v1.2.0...v1.3.0) (2026-08-24)


### Features

* add a GitHub Action and a drift ratchet gate ([#32](https://github.com/fabiocicerchia/depwatch/issues/32)) ([3bb6ee7](https://github.com/fabiocicerchia/depwatch/commit/3bb6ee7c1b088c1ce557baf2a7f75ed6339ed5f6))
* **cli:** honour a baseline in check, and share it with the editor ([#33](https://github.com/fabiocicerchia/depwatch/issues/33)) ([91422d8](https://github.com/fabiocicerchia/depwatch/commit/91422d8da9d8874bf8cae68df50251e02c032090))


### Bug Fixes

* **vscode:** find every supported ecosystem, and polish the Marketplace listing ([#37](https://github.com/fabiocicerchia/depwatch/issues/37)) ([03753ad](https://github.com/fabiocicerchia/depwatch/commit/03753ad6e957ff574cbb689c605233aad1bf7342))

## [1.2.0](https://github.com/fabiocicerchia/depwatch/compare/v1.1.0...v1.2.0) (2026-08-18)


### Features

* **vscode:** drift × viability in the editor ([d676ce3](https://github.com/fabiocicerchia/depwatch/commit/d676ce3f43e35318b988367c615793484ae71ca6))


### Bug Fixes

* **ci:** create the Open VSX namespace before publishing into it ([#28](https://github.com/fabiocicerchia/depwatch/issues/28)) ([cf0a67a](https://github.com/fabiocicerchia/depwatch/commit/cf0a67a38a1561b2b4aae212c62daa2d08e65222))
* **ci:** stop security workflows failing on private repos ([#6](https://github.com/fabiocicerchia/depwatch/issues/6)) ([b4cb3ba](https://github.com/fabiocicerchia/depwatch/commit/b4cb3badbefd1d48d1c9db44871c3bef5b893d22))
* exempt tsconfig.json from check-json ([a4ffc59](https://github.com/fabiocicerchia/depwatch/commit/a4ffc5964a246a452afacc228b499bcb95ef9474))
* **pre-commit:** stop check-yaml failing on Helm templates and multi-doc manifests ([11129e5](https://github.com/fabiocicerchia/depwatch/commit/11129e59c30647f55266dc8e7f57fd24020b9ffd))
* security and code-quality findings ([#15](https://github.com/fabiocicerchia/depwatch/issues/15)) ([1ecb13b](https://github.com/fabiocicerchia/depwatch/commit/1ecb13bcf4df50a021e5488618687dc73f3b0a30))

## [1.1.0](https://github.com/fabiocicerchia/depwatch/compare/v1.0.1...v1.1.0) (2026-08-18)


### Features

* **vscode:** drift × viability in the editor ([d676ce3](https://github.com/fabiocicerchia/depwatch/commit/d676ce3f43e35318b988367c615793484ae71ca6))

## [1.0.1](https://github.com/fabiocicerchia/depwatch/compare/v1.0.0...v1.0.1) (2026-08-13)


### Bug Fixes

* security and code-quality findings ([#15](https://github.com/fabiocicerchia/depwatch/issues/15)) ([1ecb13b](https://github.com/fabiocicerchia/depwatch/commit/1ecb13bcf4df50a021e5488618687dc73f3b0a30))

## 1.0.0 (2026-08-06)


### Bug Fixes

* **ci:** stop security workflows failing on private repos ([#6](https://github.com/fabiocicerchia/depwatch/issues/6)) ([b4cb3ba](https://github.com/fabiocicerchia/depwatch/commit/b4cb3badbefd1d48d1c9db44871c3bef5b893d22))
* exempt tsconfig.json from check-json ([a4ffc59](https://github.com/fabiocicerchia/depwatch/commit/a4ffc5964a246a452afacc228b499bcb95ef9474))
* **pre-commit:** stop check-yaml failing on Helm templates and multi-doc manifests ([11129e5](https://github.com/fabiocicerchia/depwatch/commit/11129e59c30647f55266dc8e7f57fd24020b9ffd))

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

## [0.1.0] - 2026-08-01

### Added
- Initial release.

[Unreleased]: https://github.com/fabiocicerchia/depwatch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fabiocicerchia/depwatch/releases/tag/v0.1.0
