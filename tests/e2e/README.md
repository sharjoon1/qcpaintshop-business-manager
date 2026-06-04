# E2E tests (Playwright)

Specs use `*.spec.js` so the Jest runner (which matches `*.test.js`) ignores them.

## Run
```bash
npm run test:e2e:smoke   # offline, no server needed (file:// render check)
npm run test:e2e         # all specs; flow specs self-skip without the env below
```

## Env for the full login flow
| Var | Example | Purpose |
|-----|---------|---------|
| `TEST_BASE_URL` | `http://localhost:3100` | a running app on a TEST database |
| `TEST_STAFF_USER` | `9876543210` | staff username / mobile / email |
| `TEST_STAFF_PASS` | `Passw0rd` | that staff password |

PowerShell:
```powershell
$env:TEST_BASE_URL="http://localhost:3100"; $env:TEST_STAFF_USER="..."; $env:TEST_STAFF_PASS="..."; npm run test:e2e
```

> Never point `TEST_BASE_URL` at production. See `../../E2E-PLAN.md`.
