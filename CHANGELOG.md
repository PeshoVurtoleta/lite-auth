# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-02

### Added

- `createAuth(config)`: a reactive authentication controller built around one
  private `signal<SessionRecord | undefined>` source of truth.
- Reactive projections: `session`, `isAuthenticated`, `token`, `expiresAt`,
  `status`, and `error`.
- Cross-tab logout and login over `BroadcastChannel` via the optional, lazily
  loaded `@zakkster/lite-channel` peer (`crossTab: true`).
- Durable persistence via `@zakkster/lite-persist`: synchronous boot hydration
  and debounced write-through, with `"localStorage"`, `"sessionStorage"`,
  `"memory"`, and custom Web-Storage backends.
- Opt-in, timer-based token refresh that, under `crossTab`, is performed only by
  the elected leader tab to avoid refresh-token rotation races.
- Lifecycle hooks `onSignIn`, `onSignOut`, `onSessionExpire`, `onTokenRefresh`,
  each returning an idempotent disposer, plus matching config callbacks.
- Hybrid error model: awaited actions reject with a typed `AuthError`; ambient
  failures surface on the `error` signal and the `onError` hook.
- `fetchAdapter(options)`: a REST adapter over fetch with JWT `exp` fallback for
  `expiresAt`.
- `decodeJwtExp(token)`: a pure, zero-dependency JWT `exp` decoder.
- `ready` promise that resolves after boot hydration, optional channel attach,
  and any boot-time refresh have settled.
- Full TypeScript definitions (`Auth.d.ts`).
- Test suite of 50 deterministic tests under `node --test`.

[1.0.0]: https://github.com/PeshoVurtoleta/lite-auth/releases/tag/v1.0.0
