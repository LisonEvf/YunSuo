# Monorepo Restructure Design

## Goal

Restructure the repository into a standard monorepo that makes the active product, reusable packages, external SDKs, and archived assets easy to distinguish.

The active product is the General Agent Console:

- FastAPI agent runtime
- React/Vite console
- AIRUI rendering packages
- Local agent skills

Historical market SDKs and previous frontend experiments remain available, but they should no longer sit beside the active app at the repository root.

## Target Layout

```text
apps/
  api/                 # FastAPI backend, agent runtime, tests, static console build
  console/             # React/Vite console app

packages/
  airui/               # AIRUI submodule with core and renderer-react packages
  agent-skills/        # Local skills loaded by the backend agent

external/
  openkpl/             # Historical/external SDK submodule
  opentdx/             # Historical/external SDK submodule

archive/
  frontend-vue/        # Previous Vue implementation
  templates/           # Static historical HTML templates

data/                  # Runtime SQLite data
docs/                  # Project docs, designs, plans, reports
```

## Path Mapping

| Current path | New path | Reason |
| --- | --- | --- |
| `backend/` | `apps/api/` | Active backend app belongs under `apps`. |
| `frontend/` | `apps/console/` | Active frontend app belongs under `apps`. |
| `AIRUI/` | `packages/airui/` | AIRUI is a reusable package workspace. |
| `skills/` | `packages/agent-skills/` | Skills are a local package-like capability set loaded by the agent. |
| `openkpl/` | `external/openkpl/` | Historical/external SDK, not active runtime code. |
| `opentdx/` | `external/opentdx/` | Historical/external SDK, not active runtime code. |
| `frontend-vue-backup/` | `archive/frontend-vue/` | Previous implementation retained for reference. |
| `template/` | `archive/templates/` | Historical static HTML retained for reference. |

## Runtime And Build Changes

Root `package.json` should continue to be the orchestration entry point:

- `dev`: run API and console together
- `dev:backend`: start Uvicorn from `apps/api`
- `dev:frontend`: start Vite from `apps/console`

Root workspaces should point at:

- `apps/console`
- `packages/airui/packages/core`
- `packages/airui/packages/renderer-react`

The console Vite build output should move from `../backend/static/airui` to `../api/static/airui`, because `apps/console` and `apps/api` are siblings.

The backend static mount can stay implementation-equivalent because it resolves `static/airui` relative to the backend app directory.

Docker should build from the new paths:

- frontend stage workdir: `/app/apps/console`
- backend requirements: `/app/apps/api/requirements.txt`
- backend source: `/app/apps/api`
- console static artifact: `/app/apps/api/static/airui`
- Uvicorn app dir: `/app/apps/api`

`external/openkpl` and `external/opentdx` should not be copied into the backend image unless a future feature reintroduces active imports. This keeps the image aligned with the current General Agent Console runtime.

## Submodules

The submodule gitlinks should be moved without flattening their contents:

- `AIRUI` -> `packages/airui`
- `openkpl` -> `external/openkpl`
- `opentdx` -> `external/opentdx`

`.gitmodules` must be updated to the new paths. Existing remote URLs should be preserved where meaningful. During migration, the `AIRUI` submodule URL should be normalized to the actual remote reported by the submodule, `https://github.com/LisonEvf/AIRUI`, instead of the previous local/self-referential value.

## Documentation Changes

Update README to explain the monorepo layout and new commands.

Keep existing product design docs under `docs/`. Archived or external code should be documented as retained reference code, not as active runtime code.

## Verification

After migration:

1. Run backend tests from `apps/api`:

   ```bash
   python -m pytest tests -q
   ```

2. Build the console from `apps/console`:

   ```bash
   bun run build
   ```

3. Confirm generated static files land in `apps/api/static/airui`.

4. Check `git status` for expected moves and no accidental edits to ignored runtime logs.

## Expected Benefits

- Active app modules have higher locality under `apps/`.
- Reusable AIRUI and skill modules have clearer leverage under `packages/`.
- External SDKs stop looking like app modules.
- Archived UI/template assets remain available without polluting the main interface of the repository.
- Future agents can infer the repo shape from standard monorepo conventions instead of reading historical context first.
