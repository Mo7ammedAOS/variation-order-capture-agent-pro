/**
 * Vitest setup. Pins the environment so date and risk maths are reproducible
 * regardless of the machine running the suite.
 */
process.env.TZ = 'Asia/Dubai';
process.env.NODE_ENV ??= 'test';
