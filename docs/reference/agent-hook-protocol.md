# Agent hook wire protocol

Reference for the local HTTP endpoint that agent hook scripts post to. It describes what the listener accepts on the wire, so an out-of-tree hook script or agent extension can be written without reading the listener source.

Source of truth (verify here before relying on this page):

- `src/main/agent-hooks/server/server-lifecycle.ts` — request handling and startup
- `src/shared/agent-hook-listener/request-body.ts` — body size and JSON limits
- `src/shared/agent-hook-listener/hook-envelope.ts` — envelope and metadata headers
- `src/shared/agent-hook-listener/source-routing.ts` — routes
- `src/shared/agent-hook-listener/endpoint-publication.ts` — endpoint file
- `src/shared/agent-hook-types.ts` — `ORCA_HOOK_PROTOCOL_VERSION`

Protocol version: `1` (`ORCA_HOOK_PROTOCOL_VERSION`).

## Transport

- HTTP server bound to `127.0.0.1` on an OS-assigned port (`listen(0, '127.0.0.1')`).
- Only `POST` is handled. Any other method gets `404`.
- Authentication: the `x-orca-agent-hook-token` request header must equal the server token, otherwise `403`. The check runs before the body is read.
- A stalled request is destroyed after `HOOK_REQUEST_SLOWLORIS_MS` (5 s). The client sees a dropped connection, not an HTTP status.
- Body limit `HOOK_REQUEST_MAX_BYTES` (1,000,000 bytes); a larger body makes the server destroy the connection (no HTTP status). JSON structure limits: 128 × 1024 structural tokens, nesting depth 64. One leading UTF-8 BOM is stripped before parsing.
- Body encoding follows `Content-Type` (`readRequestBody`): `application/json` is parsed as JSON (an empty body is `{}`), `application/x-www-form-urlencoded` is parsed as a flat map of string fields, and any other or missing type falls back to JSON.

## Order of checks and status codes

1. Method is not `POST` → `404`.
2. Token header missing or wrong → `403`.
3. The body is read.
4. Path is `/statusline/claude` → the Claude status-line handler runs, `204`.
5. Path is not a known hook route → `404`.
6. The event is merged with metadata headers, normalized and applied, then `204`.

Once the token has passed, an error that leaves the connection usable — for example malformed JSON or a body over the JSON structure limits — still ends in `204`. This is intentional: a broken hook must never block the agent. Errors that destroy the connection (slowloris timeout, body over the byte cap, a request cut short) produce no HTTP response at all; the client sees a closed connection, so hook scripts should treat a connection error like a failed post rather than expect a `204`. Because the route is resolved after the body is read, an unknown path only gets `404` if its body was read successfully.

## Routes

`HOOK_SOURCE_BY_PATHNAME` in `source-routing.ts`:

```
/hook/claude        /hook/codex        /hook/gemini       /hook/antigravity
/hook/amp           /hook/opencode     /hook/opencode2    /hook/mimo-code
/hook/cursor        /hook/pi           /hook/omp          /hook/prime-agent
/hook/droid         /hook/command-code /hook/grok         /hook/copilot
/hook/hermes        /hook/devin        /hook/kimi
```

`/statusline/claude` is separate (Claude status-line events).

## Finding the endpoint

The server writes an endpoint file, atomically (temp file + rename): `endpoint.env` on POSIX, `endpoint.cmd` on Windows. It is meant to be sourced by a shell. Keys:

```
ORCA_AGENT_HOOK_PORT=<port>
ORCA_AGENT_HOOK_TOKEN=<token>
ORCA_AGENT_HOOK_ENV=<env>
ORCA_AGENT_HOOK_VERSION=<version>
ORCA_AGENT_HOOK_TRANSPORT=<transport>   # optional
```

Values must match `^[A-Za-z0-9._:/-]+$` (`isShellSafeEndpointValue`), because the file is sourced by a shell. Windows lines are prefixed with `set `.

## Envelope

The body is an envelope with the routing metadata plus the agent's own hook payload. The metadata fields are `paneKey`, `tabId`, `launchToken`, `worktreeId`, `env`, `version` and `payload`.

Scripts that pipe the agent's raw JSON to the listener can carry the metadata as headers instead of wrapping the body (`mergeAgentHookRequestHeaders`). The listener then rebuilds the envelope with the raw body as `payload`:

`x-orca-pane-key`, `x-orca-tab-id`, `x-orca-launch-token`, `x-orca-worktree-id`, `x-orca-agent-hook-env`, `x-orca-agent-hook-version`.

`x-orca-agent-hook-meta-encoding: base64` makes the individual header values base64-encoded. A packed `x-orca-agent-hook-meta` header is honoured only together with that encoding: it is the base64 of six fields (`paneKey`, `tabId`, `launchToken`, `worktreeId`, `env`, `version`) joined by the unit separator `\x1f`. A packed header with a wrong field count or an empty `paneKey` is ignored and the individual headers are used.

If no `paneKey` can be read from the headers, the body is passed through unchanged, so a body that is already a complete envelope works as-is. `MAX_PANE_KEY_LEN` is 200.

A `version` that differs from the server's produces a single warning but the event is still processed.

## Not covered

How each agent's payload is turned into a status (see `src/main/agent-hooks/providers/*`), the spool used when the server is down, and per-agent installers. Those change more often than the wire format.
