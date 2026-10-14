declare module "passport-google-oidc" {
  type OAuthProfile = {
    id?: string;
    displayName?: string;
    emails?: Array<{ value: string }>;
    _json?: Record<string, unknown>;
  };

  type VerifyCallback = (error: Error | null, user?: unknown | false, info?: unknown) => void;
  type StateContext = { nonce?: string } | false;
  type StateStore = {
    store(
      request: unknown,
      context: { nonce?: string },
      appState: string | undefined,
      meta: unknown,
      done: (error: Error | null, state?: string) => void
    ): void;
    verify(
      request: { headers: Record<string, string | undefined> },
      state: string,
      done: (error: Error | null, context?: StateContext, appState?: string) => void
    ): void;
  };

  type GoogleStrategyOptions = {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    userInfoURL: string;
    scope: string[];
    skipUserProfile: boolean;
    store: StateStore;
  };

  class GoogleStrategy {
    constructor(
      options: GoogleStrategyOptions,
      verify: (issuer: string, profile: OAuthProfile, done: VerifyCallback) => void
    );
    authorizationParams(options: Record<string, unknown>): Record<string, string>;
    authenticate(request: unknown, options?: Record<string, unknown>): void;
  }

  export = GoogleStrategy;
}
