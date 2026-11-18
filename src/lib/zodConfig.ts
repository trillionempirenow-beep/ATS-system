import { config } from 'zod';

/**
 * Imported first by main.tsx, before any schema exists. The Content-Security-Policy forbids eval;
 * zod's faster validators are built with it, and zod checks for it as each schema is created,
 * which the browser reports as a violation even though zod catches the error. Without it the
 * forms validate the same way, a little slower.
 */
config({ jitless: true });
