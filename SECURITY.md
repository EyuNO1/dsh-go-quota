# Security Policy

## Reporting

Please report vulnerabilities privately via GitHub Security Advisories
(Security tab → Advisories). Do not open a public issue containing a key,
`accounts.json`, a screenshot with personal data, or a token.

## What this plugin does with secrets

- Keys are stored in the DSH credential store as `OPENCODE_GO_API_KEY`; the
  account list is stored at
  `$DSH_HOME/plugin-data/dsh-go-quota/accounts.json` with mode 0600.
- Only masked keys (first 4 + last 4) are sent to the Web UI.
- Keys are used only for the OpenCode Go usage endpoint and the DSH credential
  store; there is no telemetry and no upload to any other host.
- Browser preferences (position, layout, star marks, collapsed state) are
  non-secret cookies/localStorage values.

## Scope

The latest `main` branch. Include the DSH version, the plugin version, and
reproduction steps. Use a revoked/dummy key in reports; never a live key.
