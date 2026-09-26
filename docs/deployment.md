# Deployment Guide

This guide covers Docker deployment options for OVH Cost Manager (OCM), including SSO integration with LemonLDAP-NG.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Simple Deployment (without SSO)](#simple-deployment-without-sso)
- [SSO Deployment (with LemonLDAP-NG)](#sso-deployment-with-lemonldap-ng)
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
- For SSO: An identity provider (SAML or OIDC compatible)

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
| `AUTH_REQUIRED`             | Require authentication headers       | `false`           |
| `NODE_ENV`                  | Node environment                     | `production`      |
| `TRUST_PROXY`               | Trust X-Forwarded-For headers (required for K8s/reverse proxy), X-Forwarded-Host for the CORS check and `ALLOWED_HOSTS`, and X-Forwarded-Proto for the CORS check | `false` |
| `RATE_LIMIT_ENABLED`        | Enable rate limiting                 | `true`            |
| `RATE_LIMIT_API_MAX`        | Max API requests per IP per window   | `100`             |
| `RATE_LIMIT_API_WINDOW_MS`  | API rate limit window in ms          | `900000` (15 min) |
| `RATE_LIMIT_AUTH_MAX`       | Max auth requests per IP per window  | `20`              |
| `RATE_LIMIT_AUTH_WINDOW_MS` | Auth rate limit window in ms         | `900000` (15 min) |
| `IMPORT_ENABLED`            | Enable automatic periodic import     | `true`            |
| `IMPORT_INTERVAL`           | Seconds between imports              | `86400` (24h)     |
| `IMPORT_FLAGS`              | Extra flags for import script        | `--all`           |
| `ALLOWED_ORIGINS`           | Comma-separated CORS allowed origins, only for other sites (see below) | (empty) |
| `ALLOWED_HOSTS`             | Comma-separated host names, each with an optional port, that the server answers, against DNS rebinding (see below) | (empty: any host) |

**The dashboard's own origin** is always accepted, so `ALLOWED_ORIGINS` only lists the other sites that call the API. The server compares the origin's host, without case or default port, with the request's `Host`, and with `TRUST_PROXY=true` with the first `X-Forwarded-Host` too. Limits:

- A proxy that rewrites `Host` without sending `X-Forwarded-Host` (nginx sends none by default), or that sends it without the public port, still needs the dashboard's URL in `ALLOWED_ORIGINS`, or `proxy_set_header X-Forwarded-Host $http_host;` with `TRUST_PROXY=true`.
- The scheme is only compared when `TRUST_PROXY=true` makes it known, through `X-Forwarded-Proto`. Otherwise an `http://` page passes for an `https://` dashboard on the same host, so that the dashboard does not go blank behind a TLS-terminating proxy.

The SSO stack of `docker-compose.sso.yml` needs no `ALLOWED_ORIGINS`: its LemonLDAP-NG relay passes `Host` with its default port (`ocm.example.com:80`), a port the comparison ignores, and sends neither `X-Forwarded-Host` nor `X-Forwarded-Proto`, so hosts alone are compared, with or without `TRUST_PROXY`.

**`ALLOWED_HOSTS`** protects a deployment without authentication that browsers can reach, such as a local instance or a LAN, against DNS rebinding: a page on another domain points that domain at the server's address, and the browser then lets that page call the API with same-origin requests, which CORS cannot restrict. Deployments with OIDC authentication, or behind a proxy that routes by host name, are not exposed in practice. When it is set, or `allowedHosts` in `config.json` (an array, or a comma-separated string), the server answers only the requests whose hosts it lists, and any other with a 421 Misdirected Request. Unset, it answers any host, as before. For a dashboard at `https://ocm.example.com` and at `http://ocm.lan:3001`:

```bash
ALLOWED_HOSTS=ocm.example.com,ocm.lan:3001
```

- Hosts compare without case or default port: give the port only when it is neither 80 nor 443. At startup, the server logs the hosts it allows, and warns about each entry that is not a host name, such as a URL, which it ignores.
- `Host` is always checked. `localhost`, `127.0.0.1` and `[::1]` pass on any port, but on direct requests only, without `X-Forwarded-For`, `X-Forwarded-Host` or `Forwarded`, as the Docker healthcheck and the import cron make them.
- Behind a proxy that rewrites `Host` to its upstream, such as the container's name, or `127.0.0.1:3001` with nginx's default on the same machine, list that upstream too. It then passes for every request, so the protection rests on `X-Forwarded-Host` (next point); better, have the proxy keep `Host`, as `proxy_set_header Host $host;` does with nginx. A proxy that rewrites `Host` to a loopback address and adds no `X-Forwarded-For` makes its requests look direct, and they all pass.
- With `TRUST_PROXY=true`, the last `X-Forwarded-Host`, the one the nearest proxy set or appended, must be listed too, and the loopback names never pass there. The proxy must set or overwrite that header, as nginx does with `proxy_set_header X-Forwarded-Host $http_host;`: one that passes the client's on lets a page choose it. And if the server can be reached without the proxy, `TRUST_PROXY` lets any client forge it.
- Other callers need an allowed host too. Kubernetes probes send the pod's IP address: give them a `Host: localhost` header in `httpHeaders`. A back-channel logout from the identity provider to `http://ocm:3001` needs `ocm:3001` listed.
- The log names each blocked host once an hour, for up to 100 hosts an hour, then says how many blocked requests it left out.

### Customization

Create a `.env` file to override defaults:

```bash
OCM_PORT=8080
```

---

## SSO Deployment (with LemonLDAP-NG)

This mode integrates OCM with LemonLDAP-NG for enterprise SSO, using Traefik as reverse proxy.

### Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │                   Docker Network                │
                    │                                                 │
┌──────────┐        │  ┌──────────┐    ┌──────────────┐    ┌────────┐ │
│  Browser │───────▶│  │ Traefik  │───▶│  LemonLDAP   │───▶│  OCM   │ │
│          │        │  │  (:80)   │    │  (handler)   │    │(:3001) │ │
└──────────┘        │  └──────────┘    └──────────────┘    └────────┘ │
                    │        │                 │                      │
                    │        │          ┌──────┴──────┐               │
                    │        │          │   Portal    │               │
                    │        └─────────▶│  (auth.*)   │               │
                    │                   └─────────────┘               │
                    └─────────────────────────────────────────────────┘
```

### 1. Configuration

Create `.env` file:

```bash
# Domain configuration
SSO_DOMAIN=example.com
OCM_DOMAIN=ocm.example.com

# For local testing
# SSO_DOMAIN=localhost
# OCM_DOMAIN=ocm.localhost
```

### 2. Start the stack

```bash
docker-compose -f docker-compose.yml -f docker-compose.sso.yml up -d --build
```

### 3. Import billing data

```bash
docker exec ovh-cost-manager node data/import.js --from 2025-01-01 --to 2025-12-31
```

### 4. Access the services

| Service           | URL                        | Description                      |
| ----------------- | -------------------------- | -------------------------------- |
| OCM Dashboard     | http://ocm.example.com     | Main application (requires auth) |
| LemonLDAP Portal  | http://auth.example.com    | Login page                       |
| LemonLDAP Manager | http://manager.example.com | Configuration interface          |
| Traefik Dashboard | http://localhost:8080      | Reverse proxy status             |

### Services Overview

| Container          | Image                    | Purpose              |
| ------------------ | ------------------------ | -------------------- |
| `ovh-cost-manager` | Custom (Dockerfile)      | Application server   |
| `lemonldap`        | yadd/lemonldap-ng-portal | SSO Portal & Handler |
| `traefik`          | traefik:v2.10            | Reverse proxy        |

### Volumes

| Volume               | Purpose                     |
| -------------------- | --------------------------- |
| `ocm-data`           | SQLite database persistence |
| `lemonldap-conf`     | LemonLDAP configuration     |
| `lemonldap-sessions` | SSO session storage         |

---

## LemonLDAP-NG Configuration

LemonLDAP-NG can act as a Service Provider (SP) for external Identity Providers using SAML or OIDC protocols.

### Access the Manager

1. Open http://manager.example.com (or http://manager.localhost for local testing)
2. Default credentials: `dwho` / `dwho` (demo user)

### Configure Virtual Host for OCM

1. Go to **Virtual Hosts** > **Add virtual host**
2. Enter your OCM domain: `ocm.example.com`
3. Configure exported headers:

| Header      | Value   | Description       |
| ----------- | ------- | ----------------- |
| `Auth-User` | `$uid`  | User identifier   |
| `Auth-Mail` | `$mail` | User email        |
| `Auth-CN`   | `$cn`   | User display name |

4. Set access rules:
   - Default rule: `accept` (authenticated users)
   - Or use `$groups =~ /admin/` for group-based access

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

- [ ] Enable HTTPS with TLS certificates (Let's Encrypt via Traefik)
- [ ] Change default LemonLDAP demo users
- [ ] Configure strong session parameters
- [ ] Use secrets management for credentials
- [ ] **Configure `TRUST_PROXY=true` for reverse proxy/Kubernetes deployments**
- [ ] Adjust rate limiting based on your usage patterns (or disable for internal apps behind SSO)
- [ ] Enable rate limiting on Traefik
- [ ] Configure firewall rules

### Rate Limiting for Kubernetes/Reverse Proxy

**Critical**: When deploying behind a load balancer, Ingress, or reverse proxy, the application sees all requests coming from the proxy's IP address. Without proper configuration, **all users will share the same rate limit**.

**Required configuration**:

```bash
# In docker-compose.yml or Kubernetes deployment
environment:
  - TRUST_PROXY=true
```

Or in [config.json](../config.json):

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

### Traefik HTTPS Configuration

Add to `docker-compose.sso.yml`:

```yaml
services:
  traefik:
    command:
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "443:443"
    volumes:
      - letsencrypt:/letsencrypt
```

Update router labels:
```yaml
labels:
  - "traefik.http.routers.ocm.entrypoints=websecure"
  - "traefik.http.routers.ocm.tls.certresolver=letsencrypt"
```

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
docker-compose -f docker-compose.yml -f docker-compose.sso.yml logs -f
```

**Authentication not working:**
1. Check Traefik dashboard (http://localhost:8080) for routing
2. Verify LemonLDAP handler is accessible: `curl -I http://handler.localhost`
3. Check exported headers in browser developer tools

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

  traefik:
    command:
      - "--log.level=DEBUG"
```

### Reset Configuration

```bash
# Stop all containers
docker-compose -f docker-compose.yml -f docker-compose.sso.yml down

# Remove volumes (WARNING: destroys data)
docker volume rm ocm-data lemonldap-conf lemonldap-sessions

# Restart fresh
docker-compose -f docker-compose.yml -f docker-compose.sso.yml up -d --build
```

---

## References

- [LemonLDAP-NG Documentation](https://lemonldap-ng.org/documentation)
- [LemonLDAP-NG SAML Guide](https://lemonldap-ng.org/documentation/latest/authsaml)
- [LemonLDAP-NG OIDC Guide](https://lemonldap-ng.org/documentation/latest/authopenidconnect)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
