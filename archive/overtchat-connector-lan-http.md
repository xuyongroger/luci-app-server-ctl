# feat(connector): opt-in cleartext HTTP for private-network connector URLs (and stop returning HTTP 500)

## Environment

- Server: `ghcr.io/yoloyash/overtchat-app:0.30.0`, Docker Compose on a NAS (not a managed install)
- Browser origin: `http://192.168.0.5:4718` (plain HTTP, LAN)
- Connector host: a separate Ubuntu workstation with `opencode` installed (not the NAS)
- Connector release: `connector-v0.17.0`, `HOST_CONNECTOR_PROTOCOL_VERSION = 6`

## Problem

A Compose deployment that is opened over a plain-HTTP LAN address cannot attach a **remote** Host
Connector at all, and the failure is silent on the UI.

`normalizeHostConnectorServerUrl()` (packages/agent-bridge/src/index.ts:332) rejects any cleartext
URL whose hostname is not loopback:

```ts
if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
  throw new Error("Non-local OvertChat URLs must use HTTPS.");
}
```

`POST /api/host-connectors` builds the install command inside the handler
(apps/web/app/api/host-connectors/route.ts:29 → :34), so with
`HOST_CONNECTOR_URL=http://192.168.0.5:4718` the request throws and the client just sees:

```
POST http://192.168.0.5:4718/api/host-connectors 500 (Internal Server Error)
```

Reproduce:

1. Compose install, `HOST_CONNECTOR_URL=http://<LAN_IP>:4718`, open the app over HTTP.
2. Sign in as admin, `POST /api/host-connectors` (DevTools console or curl with the session cookie).
3. 500; no `pairCode` is returned, so no install command can be produced at all.

The same check is applied on the connector side (`apps/connector/src/config.ts` →
`normalizeServerUrl()`), so `--server http://<LAN_IP>:4718` is refused even with a valid pair code.

Note the managed path never hits this because it always points the connector at
`http://127.0.0.1:<appPort>` (apps/cli/src/connector.ts:339), i.e. loopback. So the restriction in
practice only blocks exactly the topology the docs advertise: "Coding agents do not need to run on
this server. Install the Host Connector on the computer with your agents and projects."

## Why this is worth changing

1. **It contradicts the project's own direction on LAN HTTP.** The web client was explicitly made to
   work on plain-HTTP LAN origins in #271, #287, #292 and again in v0.30.0 (#494,
   `crypto.randomUUID` on plain-HTTP LAN origins). The connector is now the only component that
   refuses a deployment shape the app itself supports.
2. **It is not a security boundary.** Today an attacker positioned to MITM cleartext on the LAN can
   already read and tamper with the browser's plain-HTTP session against the same server. Refusing
   cleartext for the connector does not protect that attacker model; it only makes the common
   homelab topology (NAS runs Docker + a separate dev box runs the agents) unusable unless the
   operator stands up a trusted certificate.
3. **The current behaviour fails closed in the worst place: a 500.** Whatever the policy ends up
   being, "we could not build the install command" should be an actionable message, not a crash.
4. Requiring a cert that Node trusts is more painful than it sounds: self-signed roots are not read
   from the OS trust store by Node, so operators must add `NODE_EXTRA_CA_CERTS` to the connector's
   user service. That is a legitimate choice, but today it is undocumented, and undocumented as the
   *only* option.

## Proposal (defaults unchanged)

1. **Fix the 500.** Catch the URL validation error in `POST /api/host-connectors` and return `400`
   with a stable code and human message (e.g. `insecure_connector_url` / "The connector URL must use
   HTTPS unless cleartext HTTP is explicitly enabled"). Surface it as an inline notice in
   **Settings → Connections** instead of a toast with "Server Error".
2. **Give unmanaged installs a pairing entry point.** Today the page only renders "OvertChat host —
   Not installed on this server. Run: overtchat setup" and offers no way to generate a pair code,
   which `apps/web/e2e/connections.spec.ts:75` states explicitly ("Managed setup is the only
   user-facing installation path") while `docs/deploy.md` (Minimal Compose) tells operators to "open
   Settings → Connections and run the displayed command". Either the docs or the UI needs to move.
3. **Add an explicit opt-in for private networks.** For example `HOST_CONNECTOR_ALLOW_INSECURE_HTTP=true`
   on the app, mirrored by a `serverUrlIsInsecure` flag recorded in the connector's own config, and
   accept cleartext HTTP only when the hostname is loopback **or** a private/link-local literal
   (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `fd00::/8`, `fc00::/7`, or an `.local` mDNS
   name). Public hostnames keep failing closed by default, so a typo cannot quietly downgrade a WAN
   deployment to cleartext.
4. **Document the matrix** in `docs/deploy.md`: loopback → HTTP is fine; private network → HTTP only
   with the opt-in; anything else → HTTPS required, with a worked LAN recipe (mkcert root imported
   into the connector host plus `NODE_EXTRA_CA_CERTS`, and Tailscale Serve as the low-effort
   alternative).

Test sketch: unit tests for `normalizeHostConnectorServerUrl()` with private/link-local/public
hostnames under each flag state; a route test asserting `400` + code instead of a throw; a connector
config test asserting the transport mode is persisted and revalidated on read.

## If you would rather not relax the check at all

The underlying "quick remote test" need already has a zero-certificate answer that passes the current
validation, because the connector sees a loopback URL:

```sh
ssh -N -L 14718:127.0.0.1:4718 user@server   # then: --server http://127.0.0.1:14718
```

A short "Temporary remote test over SSH" subsection in `docs/deploy.md` would have saved me most of
this evening, and it is a docs-only change. Happy to send that as a PR either way.
