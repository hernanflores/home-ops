# HomeOps plugins

Plugins are optional and disabled by default. A plugin must provide a
schema-valid manifest and must be explicitly listed in the private
`config/plugins.yml` activation file before any future runtime can use it.

Manifests declare capabilities and least-privilege permissions. Network hosts
and credential names are declarations only; credential values belong in private
ignored configuration or an external credential store and never in a manifest,
fixture, report, or source URL.

This milestone defines and validates the contract. It does not install, load,
or execute third-party plugin code.
