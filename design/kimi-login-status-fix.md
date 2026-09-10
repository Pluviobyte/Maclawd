# Kimi desktop / independent CLI status isolation

Checked on 2026-09-10 against MoonshotAI/kimi-code main `d3dc5945548d3353a5e6cfc457a3a8cf84d7da71` (latest release `@moonshot-ai/kimi-code@0.42.0`), especially utils/paths.ts and utils/region.ts. Confirmed KIMI_CODE_HOME and persisted CLI OAuth references are independent of the Desktop profile. Also rechecked OpenUsage main `70dea9a8fa21ed205aa9ad625b416a1e7792d5a1` / v0.7.11 and CodexBar v0.58.0 release/issue metadata; this change does not alter their quota field semantics or implement token rotation.

The desktop quota succeeded, but automatically probing a separate CLI credential produced EAUTH. Treating a surviving config directory as an installed application and using the shared "refresh your official app login" message misidentified which login needed attention.

Independent CLI quota collection is now opt-in (`kimiCodeQuotaTracking`, default false). Desktop membership remains independently enabled by the main quota switch. Executable detection replaces directory-only detection. CLI authentication errors identify the standalone CLI and explicitly state they do not invalidate Desktop login; EAUTH is not claimed to prove expiration.

The provider layer adds an enabled status flag and provider-specific sanitized error text. Disabling during an in-flight request discards both late success and late failure. It never sends credentials to another region or modifies login files.

Stage 1 tests reproduce the old default-on EAUTH warning, then verify opt-in, CLI-specific wording, late-error suppression and executable detection. The existing 15 desktop/CLI transport and auth tests also pass. Shared provider/auth/transport modules are included as dependencies of the previously local Kimi adapter; unrelated application changes remain outside this commit.
