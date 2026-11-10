@domain:documentation-site @area:site-theme @from:stylesheets/extra
Feature: Branding the documentation site
  Gives readers of the depwatch docs and splash page one consistent, private, self-contained look so the project reads as a single product.

  Background:
    Given the depwatch documentation site is published with its theme stylesheet

  @id:docs.documentation-site.site-theme.001 @rule:docs.theme.no-third-party-requests @inferred @source:docs/stylesheets/extra.css#:root
  Scenario: Docs pages render in system fonts without fetching anything from third parties
    Given web fonts are switched off in the site configuration
    When a reader opens any documentation page
    Then body text is shown in the operating system's sans-serif font
    And code is shown in the operating system's monospace font
    And the page requests no font, stylesheet or analytics script from a CDN or other third-party host

  @id:docs.documentation-site.site-theme.003 @rule:docs.theme.links-legible-per-scheme @inferred @source:docs/stylesheets/extra.css#[data-md-color-scheme="slate"] @questionable
  Scenario Outline: Links use the accent that stays readable on the current light or dark background
    Given the reader's colour scheme is <scheme>
    When a reader views a documentation page
    Then links are drawn in <link colour>
    And the page background is <background>

    Examples:
      | scheme | link colour | background                |
      | light  | #4ec9a4     | the theme's default white |
      | dark   | #5aa9e6     | #0b0f1a                   |
