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
    passReqToCallback?: boolean;
    store: StateStore;
  };

  type BasicVerifyCallback = (issuer: string, profile: OAuthProfile, done: VerifyCallback) => void;
  type RequestAwareVerifyCallback = (
    request: unknown,
    issuer: string,
    profile: OAuthProfile,
    context: unknown,
    idToken: string,
    accessToken: string,
    refreshToken: string | undefined,
    params: unknown,
    done: VerifyCallback
  ) => void;

  class GoogleStrategy {
    constructor(
      options: GoogleStrategyOptions,
      verify: BasicVerifyCallback | RequestAwareVerifyCallback
    );
    authorizationParams(options: Record<string, unknown>): Record<string, string>;
    authenticate(request: unknown, options?: Record<string, unknown>): void;
  }

  export = GoogleStrategy;
}
