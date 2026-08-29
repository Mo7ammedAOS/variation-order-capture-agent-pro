// `server-only` throws unless resolved under React's `react-server` export
// condition, which vitest does not set. The services legitimately import it —
// it is a build-time guard against a service being pulled into a client bundle,
// not a runtime behaviour — so under test it is a no-op.
export {};
