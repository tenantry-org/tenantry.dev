import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Next 16 removes `next lint`; we run the ESLint CLI directly against the native flat configs.
const eslintConfig = [
  { ignores: ['.next/**', '.source/**', 'content/docs/**', '_upgrade/**', 'node_modules/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // react-hooks v6 (bundled with eslint-config-next 16) adds stricter rules that flag pre-existing
    // starter-kit patterns. Keep them visible as warnings rather than rewriting working code during
    // the framework upgrade.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
];

export default eslintConfig;
