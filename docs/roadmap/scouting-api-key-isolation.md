# Scouting API credential isolation

Scouting stores TBA and Nexus credentials in each team's event configuration. Reads and writes use the authenticated team, API responses expose only whether a credential is configured, and exports redact the credentials.

Legacy worker deployment secrets belong only to the original site team. Other teams must save their own credentials; a missing team key cannot fall back to a deployment key. Event-name lookup, schedule requests, configuration validation and integration status use this same rule. Shared public event names and schedules contain no API credentials; manual event names stay private to their team.

Three regression tests cover saved-key selection and legacy ownership, two-team configuration/privacy with global keys present, and refusal to validate an unconfigured team's event using a global key. Both PRs' full worker suites pass. No schema change is required.

This applies to Scouting. Pit's existing shared, server-managed TBA/Nexus credentials are a separate integration model.
