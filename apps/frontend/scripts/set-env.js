// Runs BEFORE `nx build frontend` in the Vercel build command.
// Angular's browser bundle can't read process.env at runtime — there's no
// server process serving it, just static files on a CDN. So instead, this
// script writes the real API URL directly into environment.prod.ts as a
// literal string, which then gets compiled into the JS bundle like any
// other source code.

const fs = require('fs');
const path = require('path');

const apiUrl = process.env.API_URL;

if (!apiUrl) {
  console.error(
    '\n[set-env] ERROR: API_URL environment variable is not set.\n' +
    '  Set it in Vercel: Project Settings -> Environment Variables.\n'
  );
  process.exit(1);
}

const targetPath = path.join(
  __dirname,
  '..',
  'src',
  'environments',
  'environment.prod.ts'
);

const contents = `export const environment = {
  production: true,
  apiUrl: '${apiUrl}',
};
`;

fs.writeFileSync(targetPath, contents);
console.log(`[set-env] Wrote apiUrl="${apiUrl}" to environment.prod.ts`);
