import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Supabase clients come only from the factories in src/utils/supabase, whose names say which side of RLS a query
// is on: createUserClient (the signed-in user's session; RLS applies) or createServiceRoleClient (bypasses RLS),
// and client.ts in the browser (the user's session).
const useFactory =
  'Use a factory from src/utils/supabase: createUserClient, createServiceRoleClient, or client.ts in the browser.';
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

// Next 16 removes `next lint`; we run the ESLint CLI directly against the native flat configs.
const eslintConfig = [
  { ignores: ['.next/**', '.source/**', 'content/**', 'node_modules/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react 7.37 detects the React version through an API ESLint 10 removed; naming it skips that.
    settings: { react: { version: '19.3' } },
  },
  {
    // react-hooks v6 (bundled with eslint-config-next 16) adds stricter rules that flag pre-existing
    // starter-kit patterns. Keep them visible as warnings rather than rewriting working code during
    // the framework upgrade.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  {
    files: ['src/utils/**/*.{ts,tsx}'],
    ignores: ['src/utils/supabase/**'],
    rules: { 'no-restricted-imports': ['error', { paths: supabaseClients }] },
  },
  {
    // Only the server modules under src/utils use the service-role client, and they decide what a request may
    // change: pages, routes, components, hooks and the proxy never use it themselves.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utils/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: supabaseClients,
          patterns: [
            {
              group: ['@/utils/supabase/service-role-client', '**/supabase/service-role-client'],
              message: 'The service-role client bypasses RLS: call a server module under src/utils that uses it.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
