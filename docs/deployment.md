# Deployment Guide

This guide covers Docker deployment options for OVH Cost Manager (OCM), including SSO integration with LemonLDAP-NG.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Upgrading to 2.4.1](#upgrading-to-241)
- [Simple Deployment (without SSO)](#simple-deployment-without-sso)
- [SSO Deployment (with LemonLDAP-NG)](#sso-deployment-with-lemonldap-ng)
  - [How OCM Signs Users In](#how-ocm-signs-users-in)
- [Header-Based Authentication (without OIDC)](#header-based-authentication-without-oidc)
- [LemonLDAP-NG Configuration](#lemonldap-ng-configuration)
  - [SAML Authentication](#saml-authentication)
  - [OIDC Authentication](#oidc-authentication)
- [Production Checklist](#production-checklist)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Docker >= 20.10
- Docker Compose >= 2.0
- OVH API credentials (see main [README](../README.md#configuration))
- For SSO: two host names that resolve to the Docker host, `ocm.<domain>` and `auth.<domain>`, where `<domain>` is the `SSO_DOMAIN` of the [SSO deployment](#sso-deployment-with-lemonldap-ng), and users for LemonLDAP-NG to authenticate, for example from a directory or an external SAML or OIDC identity provider

---

## Upgrading to 2.4.1

2.4.1 hardens authentication and reads the settings strictly. Before upgrading, check these points: those on sessions, sign-in, the provider and back-channel logout only concern a deployment that signs in with OIDC, the others every deployment.

- **Everyone signs in again once**: the session cookie is now signed with `SESSION_SECRET`, and named `__Host-ocm.sid` when it is `Secure`, over HTTPS: the sessions of 2.4.0 are refused. From then on, changing `SESSION_SECRET` signs everyone out, and a secret shorter than 32 characters logs a warning at startup.
- **Sign-in needs cookies**: `/auth/login` sets an `ocm.login.<state>` cookie (`__Host-ocm.login.<state>` over HTTPS) that the callback needs. A sign-in must start on the host of `OIDC_BASE_URL`, where the provider sends the browser back, and finish within 10 minutes.
- **An https issuer needs all its endpoints on https**: plain HTTP to the provider is allowed only when `OIDC_ISSUER` is an `http://` URL, as in the demo stack, and then logs a warning in production.
- **The settings accept only `true` or `false`**: in any case in the environment, as JSON booleans, without quotes, in `config.json`. `COOKIE_SECURE` and `auth.session.secure` also accept `auto`, their default. This holds for `OIDC_ENABLED`, `AUTH_REQUIRED`, `COOKIE_SECURE`, `auth.enabled`, `auth.session.secure` and `auth.backChannelLogout`, for `TRUST_PROXY` and `RATE_LIMIT_ENABLED`, or `rateLimit.trustProxy` and `rateLimit.enabled` in `config.json`, which drive the CORS, `ALLOWED_HOSTS` and rate limiting checks, and for `IMPORT_ENABLED`: any other value stops the server at startup, naming the setting, and the file for `config.json`. `TRUST_PROXY=TRUE`, read as `false` before, now trusts the proxy, and `IMPORT_ENABLED=FALSE`, read as `true`, now turns the imports off.
- **The numbers and the sections of the settings are checked too**: the rate limits, `RATE_LIMIT_API_MAX`, `RATE_LIMIT_API_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX` and `RATE_LIMIT_AUTH_WINDOW_MS` or `max` and `windowMs` under `rateLimit.api` and `rateLimit.auth` in `config.json`, and `auth.session.maxAge` take positive integers, digits in the environment and JSON numbers, without quotes, in `config.json`. `auth`, `auth.provider`, `auth.session`, `rateLimit`, `rateLimit.api` and `rateLimit.auth` must be objects, and `allowedOrigins` an array of strings or a comma-separated string, as `ALLOWED_ORIGINS`. Anything else stops the server at startup, naming the setting: a limit of `"abc"` limited nothing, `"auth": true` left authentication off, and an `allowedOrigins` string was compared by substring, so that `"https://ocm.example.com"` let `https://ocm.example` through.
- **`OIDC_ENABLED=false` now overrides `auth.enabled: true`**: a leftover `OIDC_ENABLED=false` in the environment turns OIDC off, and header mode then serves the API to anyone, unless `AUTH_REQUIRED=true`.
- **A missing OIDC setting, or a `config.json` that cannot be read as JSON, stops the server at startup**, with an error naming the setting or the file, rather than let it start without authentication.
- **While the provider is unreachable**, sign-in and the API answer 503, and the server retries its discovery with backoff, instead of falling back to header mode. `/api/health` keeps answering: the container stays healthy.
- **The log quotes the texts it did not write as JSON strings**: the provider's, such as `OIDC sign-in: session opened for "alice"`, the user of each request, `["alice"]` or `["anonymous"]` where it was `[alice]`, and the origin the CORS check blocks, so that a control character in a `sub`, an error description, an `Auth-User` or an `Origin` header cannot forge a line of the log. A tool that parses these lines may need its pattern updated.
- **Back-channel logout now works**, and ends only the sessions of the token's `sid`, or of its `sub` when it has no `sid`. The provider's logout tokens must hold `exp`; a replay is refused, told by the token's `jti`, or by the token itself when it has none, as LemonLDAP-NG's may not.

---

## Simple Deployment (without SSO)

This mode runs OCM standalone on port 3001, suitable for development or internal use.

### 1. Configuration

```bash
# Copy example configuration
cp config.example.json config.json

# Edit with your OVH credentials
nano config.json
```

### 2. Start the container

```bash
docker-compose up -d --build
```

### 3. Import billing data

The container imports on its own. At start, once the server answers, it counts the bills in its database: without any, it runs a full import; with some, it skips this first import; when it cannot count them, it runs a differential import, as a full import first clears the imported data. Then it runs a differential import every `IMPORT_INTERVAL` seconds, 24 hours by default, with the flags of `IMPORT_FLAGS`. `IMPORT_ENABLED=false` turns these imports off, and the dashboard's resync button with them.

To import by hand:

```bash
# Full import (all historical data)
docker exec ovh-cost-manager node data/import.js --full

# Or import specific period
docker exec ovh-cost-manager node data/import.js --from 2025-01-01 --to 2025-12-31

# Differential import (new data since last import)
docker exec ovh-cost-manager node data/import.js --diff
```

### 4. Access the dashboard

Open http://localhost:3001

### Environment Variables

| Variable                    | Description                          | Default           |
| --------------------------- | ------------------------------------ | ----------------- |
| `OCM_PORT`                  | Host port mapping                    | `3001`            |
| `AUTH_REQUIRED`             | Without OIDC, require an `Auth-User` header on API requests, `true` or `false`: safe only behind a proxy that sets it (see [Header-Based Authentication](#header-based-authentication-without-oidc)) | `false`           |
| `OIDC_ENABLED`              | OIDC sign-in, `true` or `false`: overrides `auth.enabled` of `config.json` (see [OIDC settings](#oidc-settings)) | (`config.json`) |
| `SESSION_SECRET`            | With OIDC, signs the session and sign-in cookies: at least 32 random characters, such as the output of `openssl rand -hex 32` | (required with OIDC) |
| `COOKIE_SECURE`             | With OIDC, the `Secure` flag of the session cookie: `true`, `false` or `auto` (see [OIDC settings](#oidc-settings)) | `auto` |
| `NODE_ENV`                  | Node environment                     | `production`      |
| `DATA_DIR`                  | Directory of the SQLite database, where the compose files mount the `ocm-data` volume | `/data` |
| `TRUST_PROXY`               | Trust X-Forwarded-For headers (required for K8s/reverse proxy), X-Forwarded-Host for the CORS check and `ALLOWED_HOSTS`, and X-Forwarded-Proto for the CORS check | `false` |
| `RATE_LIMIT_ENABLED`        | Enable rate limiting                 | `true`            |
| `RATE_LIMIT_API_MAX`        | Max API requests per IP per window   | `100`             |
| `RATE_LIMIT_API_WINDOW_MS`  | API rate limit window in ms          | `900000` (15 min) |
| `RATE_LIMIT_AUTH_MAX`       | Max auth requests per IP per window  | `20`              |
| `RATE_LIMIT_AUTH_WINDOW_MS` | Auth rate limit window in ms         | `900000` (15 min) |
| `IMPORT_ENABLED`            | Enable the periodic import and the dashboard's resync button | `true` |
| `IMPORT_INTERVAL`           | Seconds between imports              | `86400` (24h)     |
| `IMPORT_FLAGS`              | Extra flags for import script        | `--all`           |
| `ALLOWED_ORIGINS`           | Comma-separated CORS allowed origins, only for other sites (see below) | (empty) |
| `ALLOWED_HOSTS`             | Comma-separated host names, each with an optional port, that the server answers, against DNS rebinding (see below) | (empty: any host) |

**The dashboard's own origin** is always accepted, so `ALLOWED_ORIGINS` only lists the other sites that call the API. In `config.json`, `allowedOrigins` takes an array, or a comma-separated string as `ALLOWED_ORIGINS` does; each origin is compared whole, and any other value stops the server at startup. The server compares the origin's host, without case or default port, with the request's `Host`, and with `TRUST_PROXY=true` with the last `X-Forwarded-Host` too, the one the nearest proxy set or appended, as `ALLOWED_HOSTS` reads it. Limits:

- A proxy that rewrites `Host` without sending `X-Forwarded-Host` (nginx sends none by default), or that sends it without the public port, still needs the dashboard's URL in `ALLOWED_ORIGINS`, or `proxy_set_header X-Forwarded-Host $http_host;` with `TRUST_PROXY=true`. So does a chain of proxies that each append the `Host` they received to `X-Forwarded-Host`.
- The scheme is only compared when `TRUST_PROXY=true` makes it known, through `X-Forwarded-Proto`. Otherwise an `http://` page passes for an `https://` dashboard on the same host, so that the dashboard does not go blank behind a TLS-terminating proxy.

The SSO stack of `docker-compose.sso.yml` needs no `ALLOWED_ORIGINS`: its LemonLDAP-NG relay passes `Host` with its default port (`ocm.example.com:80`), a port the comparison ignores, and sends neither `X-Forwarded-Host` nor `X-Forwarded-Proto`, so hosts alone are compared, with or without `TRUST_PROXY`.

**`ALLOWED_HOSTS`** protects a deployment without authentication that browsers can reach, such as a local instance or a LAN, against DNS rebinding: a page on another domain points that domain at the server's address, and the browser then lets that page call the API with same-origin requests, which CORS cannot restrict. Deployments with OIDC authentication, or behind a proxy that routes by host name, are not exposed in practice. When it is set, or `allowedHosts` in `config.json` (an array, or a comma-separated string), the server answers only the requests whose hosts it lists, and any other with a 421 Misdirected Request. Unset, it answers any host, as before. For a dashboard at `https://ocm.example.com` and at `http://ocm.lan:3001`:

```bash
ALLOWED_HOSTS=ocm.example.com,ocm.lan:3001
```

- Hosts compare without case or default port: give the port only when it is neither 80 nor 443. At startup, the server logs the hosts it allows, and warns about each entry that is not a host name, such as a URL, which it ignores.
- `Host` is always checked. `localhost`, `127.0.0.1` and `[::1]` pass on any port, but on direct requests only, which carry none of the headers a proxy adds (`X-Forwarded-For`, `X-Forwarded-Host`, `Forwarded`, `X-Real-IP`, `X-Forwarded-Proto`, `X-Forwarded-Port`, `Via`), as the Docker healthcheck and the import cron make them.
- Behind a proxy that rewrites `Host` to its upstream, such as the container's name, list that upstream too. It then passes for every request, so the protection rests on `X-Forwarded-Host` (next point); better, have the proxy keep `Host`, as `proxy_set_header Host $host;` does with nginx.
- nginx's default configuration on the same machine, a bare `proxy_pass http://127.0.0.1:3001;`, sends `Host: 127.0.0.1:3001` and none of the headers above: its requests look direct, and they all pass. Behind a local nginx, have it keep `Host`, or have it set `X-Forwarded-Host`, with `TRUST_PROXY=true`, and list the upstream host name, `127.0.0.1:3001`.
- With `TRUST_PROXY=true`, the last `X-Forwarded-Host`, the one the nearest proxy set or appended, must be listed too, and the loopback names never pass there. The proxy must set or overwrite that header, as nginx does with `proxy_set_header X-Forwarded-Host $http_host;`: one that passes the client's on lets a page choose it. And if the server can be reached without the proxy, `TRUST_PROXY` lets any client forge it.
- Other callers need an allowed host too. Kubernetes probes send the pod's IP address: give them a `Host: localhost` header in `httpHeaders`. A back-channel logout from the identity provider to `http://ocm:3001` needs `ocm:3001` listed.
- The log names each blocked host once an hour, for up to 100 hosts an hour, then says how many blocked requests it left out.

#### OIDC settings

As elsewhere, the environment overrides `config.json`. The true/false settings take `true` or `false`, in any case in the environment, and as JSON booleans, without quotes, in `config.json`: any other value stops the server at startup, naming the setting, and the file for `config.json`. So does a `config.json` that cannot be read as JSON.

The settings, with the values of the [SSO stack](#sso-deployment-with-lemonldap-ng):

| Variable             | `config.json`                | SSO stack                                 | Description                                                                                                                         |
| -------------------- | ---------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ENABLED`       | `auth.enabled`               | `true`                                    | OIDC sign-in, `true` or `false`                                                                                                     |
| `OIDC_ISSUER`        | `auth.provider.issuer`       | `http://auth.<SSO_DOMAIN>`                | Issuer URL of the provider, which the server discovers. Required                                                                    |
| `OIDC_CLIENT_ID`     | `auth.provider.clientId`     | `ocm-dashboard`                           | Client ID. Required                                                                                                                 |
| `OIDC_CLIENT_SECRET` | `auth.provider.clientSecret` | From `.env`, or `change-me`               | Client secret. Required                                                                                                             |
| `OIDC_BASE_URL`      | `auth.baseUrl`               | `http://ocm.<SSO_DOMAIN>`                 | Public URL of the dashboard: the redirect URI is `<base URL>/auth/callback`, and the post-logout redirect URI the base URL. Required |
| `OIDC_SCOPES`        | `auth.provider.scopes`       | `openid,profile,email`                    | Comma-separated in the variable, an array in the file. Default: `openid`, `profile`, `email`                                        |
| `SESSION_SECRET`     | `auth.session.secret`        | From `.env`, or `change-me-in-production` | Signs the session and sign-in cookies. Required                                                                                     |
| `COOKIE_SECURE`      | `auth.session.secure`        | Unset                                     | `true`, `false` or `auto`. Default: `auto`                                                                                          |
|                      | `auth.session.maxAge`        | Unset                                     | Session length in ms. Default: `86400000` (24 h)                                                                                    |
|                      | `auth.session.name`          | Unset                                     | Name of the session cookie. Default: `ocm.sid`                                                                                      |
|                      | `auth.backChannelLogout`     | Unset                                     | `false` leaves the back-channel logout endpoint out. Default: `true`                                                                |

- **`OIDC_ENABLED`**: `false` turns OIDC off even when `auth.enabled` is `true` in `config.json`; unset or empty, `config.json` decides. With OIDC on, the server never falls back to header mode. A missing setting, or a malformed boolean, number or section, stops it at startup. An issuer it cannot discover, unreachable or malformed, such as `auth.localhost` without a scheme, leaves `/api` and `/auth` answering 503, except `/api/health`, while the server retries the discovery with backoff and logs each failure. `OIDC_BASE_URL` is only checked for presence: a wrong one fails at sign-in.
- **`SESSION_SECRET`** signs the session and sign-in cookies, so changing it signs every user out. The server warns at startup when it is shorter than 32 characters.
- **`COOKIE_SECURE`**: with `auto`, the default, the session cookie is `Secure` when the request comes over HTTPS, as the connection or, with `TRUST_PROXY=true`, the proxy's `X-Forwarded-Proto` says, or when `OIDC_BASE_URL` is `https`. On an HTTP stack it is not, as browsers would not store it. `COOKIE_SECURE=true` or `false`, or `"secure": true` or `false` under `auth.session` in `config.json`, forces it. A `Secure` session cookie is named `__Host-ocm.sid`, on `/`, which browsers accept from this host only: another host of the domain cannot plant a session cookie of its own. Otherwise it is `ocm.sid`, or the name `auth.session.name` sets, which the prefix then goes before.
- **Sign-in**: `/auth/login` sets a cookie for each sign-in, named after its state, `ocm.login.<state>` on `/auth`, or `__Host-ocm.login.<state>` on `/` when it is `Secure`, which browsers then accept from this host only. The callback accepts a sign-in only with its cookie, within 10 minutes: start signing in on the host of `OIDC_BASE_URL`. A browser keeps the three newest sign-ins in progress, a new one clears the older ones, and the path to go back to after sign-in, `returnTo`, is dropped for `/` beyond 1 KB, so that these cookies stay small. The dashboard sends PKCE (S256) to the provider, and reaches it over plain HTTP only when `OIDC_ISSUER` is an `http://` URL.
- **Back-channel logout**: the provider can end the dashboard's sessions when a user signs out, by posting a logout token to `/logout/backchannel`. The server checks the token's signature against the provider's `jwks_uri`, its issuer, its audience (the client id), that it was issued less than 5 minutes ago, that it holds `exp`, the back-channel logout event and a `sid` or a `sub`, and no `nonce`. It refuses a replay within that time, told by the token's issuer and `jti`, or, as the `jti` the specification requires may be missing, by the SHA-256 of its signed part, which a re-encoded signature leaves unchanged. A token with a `sid` ends the sessions of that `sid` only; one without ends every session of its `sub`. With rate limiting on, the endpoint answers 300 requests a minute per address. `"backChannelLogout": false` under `auth` in `config.json` leaves the endpoint out; the front-channel logout, `/auth/logout`, stays.

### Customization

Create a `.env` file to override defaults:

```bash
OCM_PORT=8080
```

---

## SSO Deployment (with LemonLDAP-NG)

`docker-compose.sso.yml` runs OCM behind LemonLDAP-NG, with no other proxy. LemonLDAP-NG has two roles: it is the OpenID Connect (OIDC) provider that OCM signs users in with, and its built-in reverse proxy, the relay, is the only way in to OCM. The file is standalone: it is used without `docker-compose.yml`.

Below, `<domain>` stands for `SSO_DOMAIN`, `localhost` by default.

### Architecture

```
                    ┌────────────────────────── ocm-network ───────────────────────────┐
                    │                                                                  │
┌──────────┐        │  ┌───────────────────────────────┐          ┌─────────────────┐  │
│ Browser  │───────▶│  │ lemonldap (:80)               │  relay   │ ocm (:3001)     │  │
│          │  :80   │  │                               │─────────▶│                 │  │
└──────────┘        │  │ ocm.<domain>   relay to OCM   │          │ dashboard, API, │  │
                    │  │ auth.<domain>  portal and     │◀─────────│ OIDC client     │  │
                    │  │                OIDC provider  │   OIDC   │                 │  │
                    │  └───────────────────────────────┘          └─────────────────┘  │
                    │                                                                  │
                    └──────────────────────────────────────────────────────────────────┘
```

- The `lemonldap` container publishes port 80, the only published port, and answers for two host names:
  - `ocm.<domain>`: the relay (`RELAY` in the compose file) forwards each request to OCM, at `http://ocm:3001/`;
  - `auth.<domain>`: the LemonLDAP-NG portal, where users log in, which is also the OIDC provider.
- OCM publishes no port: requests reach it through the relay only.
- OCM authenticates users itself, as an OIDC client (see [How OCM Signs Users In](#how-ocm-signs-users-in)): the relay is only a reverse proxy.
- On `ocm-network`, `auth.<domain>` and `ocm.<domain>` are aliases of the `lemonldap` container, so OCM reaches the provider at the same URL as the browser, `http://auth.<domain>`, without leaving the Docker network.

### 1. Configuration

Create `config.json` with your OVH credentials, as for the [simple deployment](#1-configuration): OCM reads it here too, but the OIDC variables of the compose file take precedence over its `auth` section. Then create a `.env` file next to the compose file:

```bash
cat > .env <<EOF
SSO_DOMAIN=example.com
OIDC_CLIENT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
EOF
```

`SSO_DOMAIN` is the base domain, `localhost` when unset: the dashboard is at `http://ocm.<domain>`, and the portal and OIDC provider at `http://auth.<domain>`. The compose file passes the two secrets to OCM, and the [OIDC settings](#oidc-settings) give their roles and the stack's defaults: the client secret must equal the relying party's (step 2), and a `SESSION_SECRET` shorter than 32 characters, as the default is, logs a warning. Left unset, the three variables give a test stack on `localhost`: set them for anything else.

### 2. Register OCM in LemonLDAP-NG

LemonLDAP-NG must know OCM as an OIDC relying party. The demo image, `yadd/lemonldap-ng-portal`, has no Manager (see its [documentation](https://github.com/guimard/llng-docker/tree/master/portal#readme)): the files of `demo/sso/`, which LemonLDAP-NG reads as configuration overrides (see [Volumes](#volumes)), register OCM instead. [demo/README.md](../demo/README.md) is the one place for these files, the demo's URIs and its accounts.

They fit a stack started without `.env`. With another `SSO_DOMAIN` or `OIDC_CLIENT_SECRET`, change the relying party as [demo/README.md](../demo/README.md#using-another-domain) shows: its client secret must equal `OIDC_CLIENT_SECRET`, and its redirect and post-logout redirect URIs must match `OIDC_BASE_URL` (see [OIDC settings](#oidc-settings)). Before any real use, replace the demo's key pair and its authentication (see [LemonLDAP-NG Configuration](#lemonldap-ng-configuration)).

### 3. Start the stack

```bash
docker-compose -f docker-compose.sso.yml up -d --build
```

Then check that OCM has discovered the provider:

```bash
docker-compose -f docker-compose.sso.yml logs ocm | grep OIDC
```

The output should include `OIDC: provider discovered, sign-in is available`; until then, OCM answers 503 (see [OIDC settings](#oidc-settings)). With the demo's defaults, it also warns that `SESSION_SECRET` is short and that the issuer is plain HTTP.

Do not add `docker-compose.yml` (`-f docker-compose.yml -f docker-compose.sso.yml`): OCM would also be published on port 3001, a way in around the relay, and the `TRUST_PROXY=true` of the SSO file would then let any client choose the address that rate limiting sees.

### 4. Import billing data

The container imports as in the [simple deployment](#3-import-billing-data), and by hand the same way:

```bash
docker exec ovh-cost-manager node data/import.js --from 2025-01-01 --to 2025-12-31
```

### 5. Access the services

| Service             | URL                    | Description                                          |
| ------------------- | ---------------------- | ---------------------------------------------------- |
| OCM Dashboard       | `http://ocm.<domain>`  | Main application, through the relay (requires login) |
| LemonLDAP-NG Portal | `http://auth.<domain>` | Login page and OIDC provider                         |

Both host names must resolve to the Docker host, from the browser: through DNS, or `/etc/hosts` for a test. Sign in at the portal with one of the demo accounts that [demo/README.md](../demo/README.md#before-any-real-use) lists.

### Services Overview

| Container          | Image                             | Purpose                                    |
| ------------------ | --------------------------------- | ------------------------------------------ |
| `ovh-cost-manager` | Custom (Dockerfile)               | Application server and OIDC client         |
| `lemonldap`        | `yadd/lemonldap-ng-portal:latest` | SSO portal, OIDC provider and relay to OCM |

### Volumes

| Volume               | Purpose                     |
| -------------------- | --------------------------- |
| `ocm-data`           | SQLite database persistence |
| `lemonldap-conf`     | LemonLDAP configuration     |
| `lemonldap-sessions` | SSO session storage         |

The compose file also mounts `./config.json` into OCM, read-only, and `./demo/sso` into LemonLDAP-NG, at `/over`, where LemonLDAP-NG reads each file as the configuration key of its name (see [demo/README.md](../demo/README.md)).

### How OCM Signs Users In

OCM authenticates users itself, as an OIDC client (`server/auth/`):

1. **Startup.** OCM checks its settings, then discovers the provider from `OIDC_ISSUER`, in the background. [OIDC settings](#oidc-settings) says which failures stop it, and which leave it answering 503 meanwhile.
2. **Sign-in.** A page request without a session is redirected to `/auth/login`, which sends the browser to the provider: authorization code flow with PKCE, bound to the browser by a sign-in cookie. An API request without a session gets a `401` with a `loginUrl`, which the dashboard follows.
3. **Callback.** The provider sends the browser back to `<OIDC_BASE_URL>/auth/callback`. OCM exchanges the code for tokens, reads the user from the provider's userinfo endpoint (`sub`, `email`, and `name` or `preferred_username`), stores a session in its SQLite database and sets the session cookie, signed with `SESSION_SECRET`. It then goes back to the page first asked for, when that is a path of the dashboard.
4. **Logout.** `/auth/logout`, the ✕ next to the user's name in the dashboard, deletes the session, then sends the browser to the provider's end-session endpoint, if it has one, with `OIDC_BASE_URL` as `post_logout_redirect_uri`.
5. **Back-channel logout.** When a user signs out of the portal, the provider can post a logout token to `/logout/backchannel`, which ends the dashboard's sessions that the token names.

`/api/health`, `/auth/*` and `/logout/backchannel` need no session, and `/auth/*` has the stricter rate limit (`RATE_LIMIT_AUTH_*`).

---

## Header-Based Authentication (without OIDC)

OCM has a second mode, for a reverse proxy that authenticates users itself and passes them on in request headers, such as a LemonLDAP-NG handler.

OCM uses it only when OIDC is off: with `OIDC_ENABLED=false`, or with `OIDC_ENABLED` unset or empty and `auth.enabled` not `true` in `config.json`. With OIDC on, OCM never uses it (see [OIDC settings](#oidc-settings)). It reads three headers:

| Header      | Used as                                       |
| ----------- | --------------------------------------------- |
| `Auth-User` | User ID. Without it, the request is anonymous |
| `Auth-Mail` | Email                                         |
| `Auth-CN`   | Display name, `Auth-User` when missing        |

- **`AUTH_REQUIRED=true`** makes OCM answer `401` to API requests without `Auth-User`, except `/api/health`. The dashboard page and its assets are served either way. Without it, `false` by default, OCM refuses nothing and serves the API to anyone: the headers only name the user, in the logs and in `/api/user`.
- **Safe only behind such a proxy:** OCM takes these headers from any request that reaches it, without checking where they come from, and `TRUST_PROXY` plays no part. The proxy must set `Auth-User` and remove any of the three headers the client sent, on every request, and OCM must be reachable only through that proxy.
- **No compose file of this repository provides such a proxy.** `docker-compose.yml` runs OCM in this mode, as OIDC is off by default, and publishes its port 3001: any client can send an `Auth-User` of its choice there, and `AUTH_REQUIRED=true` keeps out only the clients that send none.
- OCM has no login or logout of its own in this mode.

---

## LemonLDAP-NG Configuration

In the SSO stack, LemonLDAP-NG is the OIDC provider of OCM. How it authenticates users in turn is its own configuration, for which the [LemonLDAP-NG documentation](https://lemonldap-ng.org/documentation) is the reference. It can act as a Service Provider (SP) for external Identity Providers using SAML or OIDC protocols, as below. These steps use the LemonLDAP-NG Manager, which the SSO stack does not run (see [2. Register OCM in LemonLDAP-NG](#2-register-ocm-in-lemonldap-ng)).

---

### SAML Authentication

Configure LemonLDAP-NG as a SAML Service Provider to authenticate users against an external SAML Identity Provider (IdP) like ADFS, Keycloak, Okta, or Azure AD.

#### Step 1: Enable SAML Service

1. Go to **General Parameters** > **Issuer modules** > **SAML**
2. Enable **SAML Service Provider**
3. Configure the **Entity ID**: `https://auth.example.com/saml/metadata`

#### Step 2: Generate SP Metadata

1. Go to **SAML Service Provider** > **Security** > **Signature**
2. Generate or upload signing certificate and private key:

```bash
# Generate self-signed certificate (for testing)
openssl req -new -x509 -days 3650 -nodes \
  -out /tmp/saml-sp.crt \
  -keyout /tmp/saml-sp.key \
  -subj "/CN=auth.example.com"
```

3. Export SP metadata from: `https://auth.example.com/saml/metadata`

#### Step 3: Register Identity Provider

1. Go to **SAML Identity Providers** > **Add SAML IDP**
2. Import IdP metadata (URL or XML file):
   - For Azure AD: `https://login.microsoftonline.com/{tenant}/federationmetadata/2007-06/federationmetadata.xml`
   - For Keycloak: `https://keycloak.example.com/realms/{realm}/protocol/saml/descriptor`
   - For ADFS: `https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml`

3. Configure attribute mapping:

| IdP Attribute                                                        | LemonLDAP Variable | Description         |
| -------------------------------------------------------------------- | ------------------ | ------------------- |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn`          | `$_auth`           | User Principal Name |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `$mail`            | Email address       |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `$givenName`       | First name          |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `$sn`              | Last name           |
| `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`     | `$groups`          | Group memberships   |

#### Step 4: Configure Authentication Flow

1. Go to **General Parameters** > **Authentication modules** > **Authentication**
2. Select **SAML** as authentication module
3. Go to **User database** > Select **SAML** to use IdP attributes

#### Step 5: Register SP with Identity Provider

Provide the IdP administrator with:
- SP Entity ID: `https://auth.example.com/saml/metadata`
- SP Metadata URL: `https://auth.example.com/saml/metadata`
- Assertion Consumer Service (ACS) URL: `https://auth.example.com/saml/acs`
- Required attributes: email, displayName, groups (optional)

#### Example: Azure AD Configuration

1. In Azure Portal, go to **Enterprise Applications** > **New Application** > **Non-gallery application**
2. Configure Single Sign-On:
   - Sign-on URL: `https://auth.example.com`
   - Entity ID: `https://auth.example.com/saml/metadata`
   - Reply URL: `https://auth.example.com/saml/acs`
3. Configure claims:
   - `user.mail` → `emailaddress`
   - `user.displayname` → `name`
   - `user.userprincipalname` → `upn`
4. Download Federation Metadata XML and import into LemonLDAP

---

### OIDC Authentication

Configure LemonLDAP-NG as an OIDC Relying Party (RP) to authenticate users against an external OIDC Provider (OP) like Keycloak, Auth0, Okta, Google, or Azure AD.

#### Step 1: Register Application with OIDC Provider

Register LemonLDAP-NG as a client application with your OIDC Provider:

| Parameter                | Value                                     |
| ------------------------ | ----------------------------------------- |
| Application Type         | Web Application                           |
| Redirect URI             | `https://auth.example.com/oauth2callback` |
| Post-logout Redirect URI | `https://auth.example.com`                |
| Scopes                   | `openid`, `profile`, `email`              |

Note the **Client ID** and **Client Secret** provided.

#### Step 2: Enable OIDC Module

1. Go to **General Parameters** > **Issuer modules** > **OpenID Connect**
2. Enable **OpenID Connect Relying Party**

#### Step 3: Register OIDC Provider

1. Go to **OpenID Connect Providers** > **Add OpenID Provider**
2. Configure the provider:

**Provider Metadata (recommended method):**
```
Discovery URL: https://idp.example.com/.well-known/openid-configuration
```

**Or manual configuration:**

| Parameter              | Description                                     |
| ---------------------- | ----------------------------------------------- |
| Authorization endpoint | `https://idp.example.com/authorize`             |
| Token endpoint         | `https://idp.example.com/token`                 |
| Userinfo endpoint      | `https://idp.example.com/userinfo`              |
| JWKS URI               | `https://idp.example.com/.well-known/jwks.json` |

3. Configure client credentials:
   - Client ID: (from Step 1)
   - Client Secret: (from Step 1)
   - Client Authentication: `client_secret_post` or `client_secret_basic`

4. Configure attribute mapping:

| OIDC Claim           | LemonLDAP Variable | Description               |
| -------------------- | ------------------ | ------------------------- |
| `sub`                | `$_auth`           | Subject (user identifier) |
| `email`              | `$mail`            | Email address             |
| `name`               | `$cn`              | Display name              |
| `preferred_username` | `$uid`             | Username                  |
| `groups`             | `$groups`          | Group memberships         |

#### Step 4: Configure Authentication Flow

1. Go to **General Parameters** > **Authentication modules** > **Authentication**
2. Select **OpenID Connect** as authentication module
3. Go to **User database** > Select **OpenID Connect** to use IdP attributes

#### Example: Keycloak Configuration

**In Keycloak:**
1. Create a new Client:
   - Client ID: `lemonldap-ng`
   - Client Protocol: `openid-connect`
   - Access Type: `confidential`
   - Valid Redirect URIs: `https://auth.example.com/oauth2callback`
2. Copy Client Secret from **Credentials** tab
3. Note discovery URL: `https://keycloak.example.com/realms/{realm}/.well-known/openid-configuration`

**In LemonLDAP-NG:**
1. Add OpenID Provider with discovery URL
2. Enter Client ID and Secret
3. Map attributes (Keycloak uses standard OIDC claims)

#### Example: Azure AD Configuration

**In Azure Portal:**
1. Go to **App registrations** > **New registration**
   - Name: `LemonLDAP-NG`
   - Redirect URI: `https://auth.example.com/oauth2callback` (Web)
2. Note **Application (client) ID** and **Directory (tenant) ID**
3. Go to **Certificates & secrets** > **New client secret**
4. Note the secret value

**In LemonLDAP-NG:**
1. Add OpenID Provider:
   - Discovery URL: `https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration`
   - Client ID: Application (client) ID
   - Client Secret: Secret value
2. Configure attribute mapping:
   - `preferred_username` → `$uid`
   - `name` → `$cn`
   - `email` → `$mail`

#### Example: Google Configuration

**In Google Cloud Console:**
1. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth client ID**
2. Application type: **Web application**
3. Authorized redirect URIs: `https://auth.example.com/oauth2callback`
4. Note Client ID and Client Secret

**In LemonLDAP-NG:**
1. Add OpenID Provider:
   - Discovery URL: `https://accounts.google.com/.well-known/openid-configuration`
   - Client ID and Secret from Google
2. Attribute mapping uses standard Google claims

---

## Production Checklist

### Security

- [ ] Serve the stack over HTTPS (see [HTTPS](#https))
- [ ] Set `OIDC_CLIENT_SECRET`, and `SESSION_SECRET` to 32 random characters or more, and replace the demo key pair and client secret of `demo/sso/`
- [ ] Change default LemonLDAP demo users
- [ ] Configure strong session parameters
- [ ] Use secrets management for credentials
- [ ] **Configure `TRUST_PROXY=true` for reverse proxy/Kubernetes deployments**
- [ ] Adjust rate limiting based on your usage patterns (or disable for internal apps behind SSO)
- [ ] Enable rate limiting on your reverse proxy
- [ ] Configure firewall rules

### Rate Limiting for Kubernetes/Reverse Proxy

**Critical**: When deploying behind a load balancer, Ingress, or reverse proxy, the application sees all requests coming from the proxy's IP address. Without proper configuration, **all users will share the same rate limit**.

**Required configuration**:

```bash
# In docker-compose.yml or Kubernetes deployment
environment:
  - TRUST_PROXY=true
```

Or in `config.json`, as in [config.example.json](../config.example.json):

```json
{
  "rateLimit": {
    "trustProxy": true
  }
}
```

**For internal applications**: If your application is only accessible internally and protected by SSO (LemonLDAP, Keycloak, etc.), you may disable rate limiting entirely:

```bash
environment:
  - RATE_LIMIT_ENABLED=false
```

**Increasing limits**: For high-traffic internal deployments:

```bash
environment:
  - TRUST_PROXY=true
  - RATE_LIMIT_API_MAX=500          # Increase from 100 to 500
  - RATE_LIMIT_AUTH_MAX=100         # Increase from 20 to 100
```

### HTTPS

`docker-compose.sso.yml` serves plain HTTP on port 80 and has no HTTPS setup: sign-in codes, tokens and session cookies travel unencrypted, and OCM warns at startup that its issuer is plain HTTP. With `COOKIE_SECURE=auto`, the default, the session cookie is not `Secure` on this stack, as browsers would not store it over plain HTTP (see [OIDC settings](#oidc-settings)). Beyond a test, the stack needs HTTPS, which this compose file does not provide.

### High Availability

- [ ] Use external database for LemonLDAP sessions (Redis, PostgreSQL)
- [ ] Configure sticky sessions if multiple OCM instances (required for OIDC)
- [ ] For shared rate limiting across multiple instances, consider Redis store for express-rate-limit
- [ ] Set up regular backups for volumes
- [ ] Monitor container health

### Backup Strategy

```bash
# Backup OCM data
docker run --rm -v ocm-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/ocm-data-$(date +%Y%m%d).tar.gz /data

# Backup LemonLDAP config
docker run --rm -v lemonldap-conf:/data -v $(pwd):/backup alpine \
  tar czf /backup/lemonldap-conf-$(date +%Y%m%d).tar.gz /data
```

---

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
# Check logs
docker-compose logs -f ocm
docker-compose -f docker-compose.sso.yml logs -f
```

**Authentication not working:** OCM's log, `docker-compose -f docker-compose.sso.yml logs ocm`, tells which case applies.
1. `Failed to start server: ...` in the log: a setting is missing or malformed, and the message names it (see [OIDC settings](#oidc-settings)).
2. `/api` and `/auth` answer 503, with `OIDC: discovery of ... failed: ...` in the log: OCM cannot discover the provider, for instance while LemonLDAP-NG is still starting, and retries (see [OIDC settings](#oidc-settings)).
3. An error on the portal, or `Sign-in failed, please sign in again.` with `OIDC callback: sign-in refused: ...` in the log, which gives the provider's reason: the relying party does not match OCM's settings (see [2. Register OCM in LemonLDAP-NG](#2-register-ocm-in-lemonldap-ng)).
4. `Sign-in failed, please sign in again.` with `OIDC callback: no valid sign-in cookie for its state` in the log: the browser did not send its sign-in cookie back, because the sign-in took more than 10 minutes, did not start on the host of `OIDC_BASE_URL`, or got a `Secure` cookie on a plain HTTP page, as `COOKIE_SECURE=true` (or `auth.session.secure: true`) gives there. Keep `COOKIE_SECURE` at `auto` on an HTTP stack (see [OIDC settings](#oidc-settings)).

**SAML errors:**
- Verify clock synchronization between containers and IdP
- Check certificate expiration
- Validate metadata exchange between SP and IdP

**OIDC errors:**
- Verify redirect URI matches exactly
- Check client secret hasn't expired
- Validate discovery URL is accessible

### Debug Mode

Enable debug logging:

```yaml
# docker-compose.sso.yml
services:
  lemonldap:
    environment:
      - LOGLEVEL=debug
```

### Reset Configuration

```bash
# Stop all containers
docker-compose -f docker-compose.sso.yml down

# Remove volumes (WARNING: destroys data)
docker volume rm ocm-data lemonldap-conf lemonldap-sessions

# Restart fresh
docker-compose -f docker-compose.sso.yml up -d --build
```

---

## References

- [LemonLDAP-NG Documentation](https://lemonldap-ng.org/documentation)
- [LemonLDAP-NG SAML Guide](https://lemonldap-ng.org/documentation/latest/authsaml)
- [LemonLDAP-NG OIDC Guide](https://lemonldap-ng.org/documentation/latest/authopenidconnect)
- [yadd/lemonldap-ng-portal image](https://github.com/guimard/llng-docker/tree/master/portal#readme)
- [Docker Compose Reference](https://docs.docker.com/compose/)
