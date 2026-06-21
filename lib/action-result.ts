// The expected-error transport for server actions.
//
// Next.js redacts the `message` of any Error thrown from a server action in
// production builds — the client receives a generic string plus a digest. So
// "throw an Error with a friendly message and render err.message" only works
// in `next dev`. Expected user-facing failures instead travel as part of the
// action's *return value*, which Next serializes verbatim.
//
// The split:
//   - Action bodies throw `ExpectedError` for failures the user should read
//     ("You already have an exercise with that name"). `withLogging` catches
//     it, logs at warn without a stack, and returns `{ ok: false, error }`.
//   - Anything else thrown is a bug: `withLogging` logs it at error level
//     with the stack and rethrows, so it still reaches the nearest error.tsx
//     boundary (redacted in prod, which is fine — there's nothing useful to
//     tell the user about a null deref).
//
// Client call sites check `res.ok` instead of catching. See docs/api.md for
// the canonical pattern and docs/decisions.md for the ADR.

export type ActionFailure = { ok: false; error: string };
export type ActionSuccess<T> = { ok: true; data: T };
export type ActionResult<T = void> = ActionSuccess<T> | ActionFailure;

/**
 * An expected, user-facing failure thrown from a server-action body. The
 * message IS the UI copy — write it for the user, not the log stream.
 */
export class ExpectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedError';
  }
}
