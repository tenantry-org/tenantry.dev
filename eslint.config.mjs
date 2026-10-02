import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Supabase clients come only from the factories, whose names say which side of RLS a query is on:
// createUserClient (the signed-in user's session; RLS applies) or createServiceRoleClient (bypasses RLS) in
// src/server/db, and createClient (src/lib/supabase/client.ts) in the browser.
const useFactory =
  'Use a factory: createUserClient or createServiceRoleClient (src/server/db), or createClient (src/lib/supabase/client.ts) in the browser.';
const supabaseClients = [
  {
    name: '@supabase/supabase-js',
    importNames: ['createClient'],
    message: useFactory,
  },
  {
    name: '@supabase/ssr',
    importNames: ['createServerClient', 'createBrowserClient'],
    message: useFactory,
  },
];
const serverClientFactories = [
  'src/server/db/user-client.ts',
  'src/server/db/service-role-client.ts',
  'src/server/db/update-session.ts',
];
const browserClientFactory = 'src/lib/supabase/client.ts';

// The service-role client bypasses RLS, so only the modules in src/server/db, which query the database, use it.
const serviceRoleClient = {
  group: ['@/server/db/service-role-client', '**/service-role-client'],
  message: 'The service-role client bypasses RLS: only the modules in src/server/db use it.',
};

// The server code is in layers, and imports point only down this list: billing (the rules and services) → jobs
// (the customer jobs' worker and leases) → integrations (Paddle, GitHub, email, licence signing) and db (the
// Supabase clients and the modules that query the database) → config. src/lib holds isomorphic helpers and imports
// no server code. The patterns match both the alias and relative paths (`@/server/billing/…`, `../billing/…`).
const below = (layer, ...higher) => ({
  regex: `^(@/server/|(\\.\\./)+(server/)?)(${higher.join('|')})(/|$)`,
  message: `src/server/${layer} must not import ${higher.join(', ')}: imports point down the layers (eslint.config.mjs).`,
});
const isomorphic = {
  regex: '^(@/server|(\\.\\./)+server)(/|$)',
  message: 'src/lib is isomorphic: it imports no server code.',
};
const dbLayer = below('db', 'billing', 'jobs', 'integrations');

function importRules(files, patterns, { ignores = [], clients = true } = {}) {
  return {
    files,
    ignores,
    rules: {
      'no-restricted-imports': ['error', { paths: clients ? supabaseClients : [], patterns }],
    },
  };
}

// Only the modules in src/server/db query the database, each mapping rows to its own types.
const queryElsewhere = 'Only the modules in src/server/db query Supabase: add a function to one of them.';

// Next 16 removes `next lint`; we run the ESLint CLI directly against the native flat configs.
const eslintConfig = [
  { ignores: ['.next/**', '.source/**', 'content/**', 'node_modules/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react 7.37 detects the React version through an API ESLint 10 removed; naming it skips that.
    settings: { react: { version: '19.3' } },
  },
  importRules(['src/**/*.{ts,tsx}'], [serviceRoleClient], { ignores: ['src/server/**', 'src/lib/**'] }),
  importRules(['src/lib/**/*.{ts,tsx}'], [isomorphic], { ignores: [browserClientFactory] }),
  importRules([browserClientFactory], [isomorphic], { clients: false }),
  importRules(['src/server/billing/**/*.{ts,tsx}'], [serviceRoleClient]),
  importRules(['src/server/jobs/**/*.{ts,tsx}'], [serviceRoleClient, below('jobs', 'billing')]),
  importRules(
    ['src/server/integrations/**/*.{ts,tsx}'],
    [serviceRoleClient, below('integrations', 'billing', 'jobs', 'db')],
  ),
  importRules(
    ['src/server/config/**/*.{ts,tsx}'],
    [serviceRoleClient, below('config', 'billing', 'jobs', 'integrations', 'db')],
  ),
  importRules(['src/server/db/**/*.{ts,tsx}'], [dbLayer], { ignores: serverClientFactories }),
  importRules(serverClientFactories, [dbLayer], { clients: false }),
  {
    // A table query is `.from('<table>')` (not Array.from or Buffer.from); a function call is `.rpc(…)`.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/db/**', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.type='Literal']:not([callee.object.name=/^(Array|Buffer)$/])",
          message: queryElsewhere,
        },
        { selector: "CallExpression[callee.property.name='rpc']", message: queryElsewhere },
      ],
    },
  },
  {
    // The configuration is read and checked in one place each: serverConfig() for the server, publicConfig() for what
    // is compiled into the build. instrumentation.ts reads only Next's own runtime and build-phase variables.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/server/config/server-config.ts',
      'src/lib/public-config.ts',
      'src/instrumentation.ts',
      'src/**/*.test.{ts,tsx}',
      'src/test/**',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through serverConfig() (src/server/config) or publicConfig() (src/lib).',
        },
      ],
    },
  },
];

export default eslintConfig;
