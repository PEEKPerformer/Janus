/**
 * Typed errors raised by the data layer.
 *
 * A core principle of Janus: the data/transport layer NEVER performs UI side
 * effects (Hydra's api/* calls Alert.alert directly — we don't). Instead the
 * adapter throws one of these typed errors and the shell decides the UX.
 */

export type JanusErrorCode =
  | "NOT_AUTHENTICATED"
  | "CAPABILITY_UNSUPPORTED"
  | "RATE_LIMITED"
  | "GATED_CONTENT"
  | "NETWORK"
  | "PARSE"
  | "NOT_FOUND"
  | "FORBIDDEN";

export class JanusError extends Error {
  readonly code: JanusErrorCode;
  constructor(code: JanusErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    // Preserve prototype chain when targeting ES5-ish runtimes (Hermes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotAuthenticatedError extends JanusError {
  constructor(message = "This action requires being logged in.") {
    super("NOT_AUTHENTICATED", message);
  }
}

/** A feature the active source does not support (e.g. resolveRemoteUrl on Reddit). */
export class CapabilityError extends JanusError {
  readonly capability: string;
  constructor(capability: string) {
    super(
      "CAPABILITY_UNSUPPORTED",
      `Unsupported on this source: ${capability}`,
    );
    this.capability = capability;
  }
}

/** Reddit lacks 429/backoff handling entirely — Janus surfaces it as this. */
export class RateLimitError extends JanusError {
  readonly retryAfterSeconds?: number;
  constructor(retryAfterSeconds?: number) {
    super("RATE_LIMITED", "Rate limited by the server.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Reddit gated/quarantined subreddit requiring an explicit accept step. Carries
 * everything the shell needs to show the interstitial and opt the user in:
 * the community name, the warning text, and which opt-in endpoint applies.
 */
export class GatedContentError extends JanusError {
  readonly communityName?: string;
  readonly warning?: string;
  readonly optInKind: "quarantine" | "gated";
  constructor(
    opts: {
      communityName?: string;
      warning?: string;
      optInKind?: "quarantine" | "gated";
    } = {},
  ) {
    super(
      "GATED_CONTENT",
      opts.warning ?? "This content is gated and must be accepted first.",
    );
    this.communityName = opts.communityName;
    this.warning = opts.warning;
    this.optInKind = opts.optInKind ?? "gated";
  }
}

export class NetworkError extends JanusError {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super("NETWORK", message);
    this.status = status;
  }
}

/** Source returned a shape we couldn't map (schema drift). */
export class ParseError extends JanusError {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super("PARSE", message);
    this.detail = detail;
  }
}

export class NotFoundError extends JanusError {
  constructor(message = "Not found.") {
    super("NOT_FOUND", message);
  }
}

export class ForbiddenError extends JanusError {
  constructor(message = "Forbidden.") {
    super("FORBIDDEN", message);
  }
}
