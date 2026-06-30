# Contributing to tenantry-site

Thanks for your interest in contributing! If you've spotted a problem or have a feature request,
please open an issue.

## Local workflow

```bash
pnpm install
pnpm dev          # runs sync:docs, then next dev
pnpm test         # lint + Prettier + tsc + Vitest — must pass before you push
```

See the [README](README.md) for environment setup (copy `.env.example` to `.env.local`) and the
docs pipeline.

## Pull requests

1. Create a topic branch.
2. Make your change with tests where applicable.
3. Ensure `pnpm test` passes locally.
4. Open a PR; CODEOWNERS are auto-requested for review.

## Security

Please **do not** report security vulnerabilities through public issues. See [SECURITY.md](SECURITY.md).
