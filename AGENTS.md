# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

DPA Creator/Fan Portal — a single-page Angular 21 app with two portals (Artist and Fan). All data is mock/in-memory via Angular signals; no backend, database, or external services are required to run or test the app.

### Dev commands

| Action | Command |
|--------|---------|
| Install deps | `npm install --legacy-peer-deps` |
| Dev server | `npm run dev` (serves on port 3000) |
| Production build | `npm run build` |

### Non-obvious caveats

- **`--legacy-peer-deps` required**: Angular 21 requires TypeScript >=5.9 but `package.json` pins `~5.8.2`. Use `npm install --legacy-peer-deps` to avoid `ERESOLVE` peer-dependency conflicts.
- **No lockfile originally committed**: `package-lock.json` was generated and committed during initial setup. If it's missing, `npm install --legacy-peer-deps` will regenerate it.
- **No lint or test scripts**: The repo has no ESLint config or test framework configured. `package.json` only defines `dev`, `build`, and `preview` scripts.
- **No `.env` needed**: The README mentions `GEMINI_API_KEY` in `.env.local`, but no code references it. The app runs fully without any environment variables.
- **Simulator mode**: The app references a WebSocket bridge (`ws://localhost:8787`) and a REST API (`http://localhost:8080/api/v1`) in its config, but gracefully falls back to simulator/mock mode when these are unavailable.
