// Type definitions for @zakkster/lite-auth
// Project: https://www.npmjs.com/package/@zakkster/lite-auth
// Definitions by: Zahary Shinikchiev

/**
 * A read-only reactive value. Call it to read (tracked inside a computation),
 * `.peek()` to read without tracking, `.subscribe()` to observe changes. This
 * is the lite-signal ReadonlySignal shape, restated here so the type surface is
 * self-contained.
 */
export interface ReadonlySignal<T> {
    (): T;
    peek(): T;
    subscribe(run: (value: T) => void): () => void;
}

export type AuthErrorCode =
    | "invalid_credentials"
    | "network"
    | "refresh_failed"
    | "no_refresh_token"
    | "expired"
    | "storage"
    | "aborted"
    | "misconfigured";

/**
 * Typed error thrown by the awaited actions (`signIn`, `refresh`) and surfaced
 * reactively on `error` for ambient failures.
 */
export class AuthError extends Error {
    name: "AuthError";
    code: AuthErrorCode;
    cause?: unknown;
    constructor(code: AuthErrorCode, message: string, opts?: { cause?: unknown });
}

export type AuthStatus = "idle" | "authenticating" | "refreshing";

/**
 * The unit of authenticated state. `user` is opaque to lite-auth and surfaced
 * as-is through the `session` projection.
 */
export interface SessionRecord<User = unknown> {
    user: User;
    accessToken: string;
    refreshToken?: string;
    /** Epoch milliseconds. When present, drives expiry checks and refresh scheduling. */
    expiresAt?: number;
}

/**
 * Pluggable authentication backend. Only `signIn` is required; provide
 * `refresh` to enable token renewal and `signOut` for server-side revocation.
 */
export interface AuthAdapter<User = unknown, Credentials = unknown> {
    signIn(credentials: Credentials, signal: AbortSignal): Promise<SessionRecord<User>>;
    refresh?(record: SessionRecord<User>, signal: AbortSignal): Promise<SessionRecord<User>>;
    signOut?(record: SessionRecord<User>): Promise<void> | void;
}

export interface RefreshConfig {
    enabled: boolean;
    /** Seconds before `expiresAt` at which to refresh. Default 60. */
    threshold?: number;
}

/** Anything Web-Storage-shaped. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export type StorageOption = "localStorage" | "sessionStorage" | "memory" | StorageLike;

/**
 * Minimal registry shape (a subset of the object returned by lite-signal's
 * `createRegistry`). lite-auth only ever uses `signal`, `computed`, and
 * `batch`, so any compatible registry works. The optional `dispose` is the
 * registry-bound node disposer; when present, lite-auth uses it on teardown
 * to return signal and computed nodes to the right pool.
 */
export interface SignalRegistry {
    signal: <T>(initial: T) => ReadonlySignal<T> & {
        set(value: T): void;
        update(fn: (value: T) => T): void;
    };
    computed: <T>(fn: () => T) => ReadonlySignal<T>;
    batch: <T>(fn: () => T) => T;
    dispose?: (node: unknown) => void;
}

export interface AuthConfig<User = unknown, Credentials = unknown> {
    /** The backend that exchanges credentials for a session record. */
    adapter: AuthAdapter<User, Credentials>;
    /**
     * Where to persist the session. Default `"localStorage"`; throws an
     * AuthError("misconfigured") if Web Storage is unavailable. Use `"memory"`
     * for SSR, tests, or session-only flows.
     */
    storage?: StorageOption;
    /** Storage key and default cross-tab channel key. Default `"lite-auth.session.v1"`. */
    storageKey?: string;
    /** BroadcastChannel name for cross-tab sync. Defaults to `storageKey`. */
    channelName?: string;
    /** Enable cross-tab propagation. Requires `@zakkster/lite-channel` to be installed. Default `false`. */
    crossTab?: boolean;
    /** Opt-in background token refresh. */
    refresh?: RefreshConfig;
    /** Forwarded to lite-channel's `createTabSync`. `persist` is always forced off (lite-auth owns disk). */
    channelOptions?: Record<string, unknown>;
    /**
     * Advanced: run lite-auth's own signals inside a custom lite-signal
     * registry for isolation. Note that lite-persist's write-back uses the
     * global signal graph, so a custom registry pairs best with
     * `storage: "memory"`.
     */
    registry?: SignalRegistry;
    /** Fired when an unauthenticated session becomes authenticated (not on restore). */
    onSignIn?: (user: User) => void;
    /** Fired when an authenticated session becomes unauthenticated (local or cross-tab). */
    onSignOut?: () => void;
    /** Fired when a session expires and cannot be refreshed. */
    onSessionExpire?: () => void;
    /** Fired after a successful token refresh. */
    onTokenRefresh?: (record: SessionRecord<User>) => void;
    /** Ambient (non-thrown) failures: background refresh, storage, cross-tab. */
    onError?: (error: AuthError) => void;
}

export interface Auth<User = unknown, Credentials = unknown> {
    /** The current user, or `null` when unauthenticated. */
    readonly session: ReadonlySignal<User | null>;
    /** Whether a session is currently active. */
    readonly isAuthenticated: ReadonlySignal<boolean>;
    /** The current access token, or `null`. */
    readonly token: ReadonlySignal<string | null>;
    /** The current session's expiry in epoch ms, or `null`. */
    readonly expiresAt: ReadonlySignal<number | null>;
    /** Coarse activity state for spinners and guards. */
    readonly status: ReadonlySignal<AuthStatus>;
    /** The most recent error, cleared on the next successful action. */
    readonly error: ReadonlySignal<AuthError | null>;
    /** Resolves once boot hydration, optional channel attach, and any boot-time refresh have settled. */
    readonly ready: Promise<void>;
    /** Exchange credentials for a session. Rejects with an AuthError on failure. */
    signIn(credentials: Credentials): Promise<User>;
    /** Clear the session locally (optimistic) and best-effort revoke server-side. Never rejects. */
    signOut(): Promise<void>;
    /** Force a token refresh now. Rejects with an AuthError on failure. */
    refresh(): Promise<void>;
    /** Register a sign-in listener. Returns an idempotent disposer. */
    onSignIn(fn: (user: User) => void): () => void;
    /** Register a sign-out listener. Returns an idempotent disposer. */
    onSignOut(fn: () => void): () => void;
    /** Register a session-expiry listener. Returns an idempotent disposer. */
    onSessionExpire(fn: () => void): () => void;
    /** Register a token-refresh listener. Returns an idempotent disposer. */
    onTokenRefresh(fn: (record: SessionRecord<User>) => void): () => void;
    /** Tear down timers, subscriptions, and the channel. Leaves stored data intact. */
    dispose(): void;
}

/** Create a reactive authentication controller. */
export function createAuth<User = unknown, Credentials = unknown>(
    config: AuthConfig<User, Credentials>,
): Auth<User, Credentials>;

export interface FetchAdapterOptions<User = unknown> {
    signInUrl: string;
    refreshUrl?: string;
    signOutUrl?: string;
    /** Static headers, or a getter evaluated per request so rotated tokens stay fresh. */
    headers?: Record<string, string> | (() => Record<string, string>);
    /** Map a raw JSON response to a SessionRecord. Defaults to reading `{ user, accessToken, refreshToken?, expiresAt? }`. */
    parseSession?: (json: unknown) => SessionRecord<User>;
    /** Override the fetch implementation (defaults to `globalThis.fetch`). */
    fetch?: typeof fetch;
}

/**
 * A REST adapter over fetch. POSTs JSON to the configured endpoints. When a
 * response omits `expiresAt`, it is derived from the access token's JWT `exp`.
 */
export function fetchAdapter<User = unknown, Credentials = unknown>(
    opts: FetchAdapterOptions<User>,
): AuthAdapter<User, Credentials>;

/** Decode a JWT's `exp` claim and return it as epoch milliseconds, or `undefined`. */
export function decodeJwtExp(token: string): number | undefined;
