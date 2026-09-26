# SSO demo

`docker-compose.sso.yml` mounts `demo/sso` on `/over` in its LemonLDAP-NG
container. LemonLDAP reads each file there as the configuration key of its
name, with the file's content as value, in place of its own. It reads every
file of that directory, so keep any other file, such as this README, out of it.

- `issuerDBOpenIDConnectActivation` turns the OIDC provider on.
- `oidcRPMetaDataOptions` registers OCM as the relying party `ocm`.
- `oidcRPMetaDataExportedVars` sets the claims OCM gets: `email`, `name` and
  `preferred_username`.
- `oidcServicePrivateKeySig` and `oidcServicePublicKeySig` are the key pair
  that signs the tokens.

## Using another domain

The relying party is set for the defaults of `docker-compose.sso.yml`, with
`SSO_DOMAIN` and `OIDC_CLIENT_SECRET` unset: its URIs are on `ocm.localhost`
and its client secret is `change-me`. OCM sends `OIDC_CLIENT_SECRET`, and
builds the URIs from `OIDC_BASE_URL`, `http://ocm.${SSO_DOMAIN}`. LemonLDAP
compares each one with the registered URI, character for character: a
redirect URI that differs makes the sign-in fail, and a post-logout redirect
URI that differs makes the sign-out fail.

For another domain, change these options in `oidcRPMetaDataOptions`, here for
`SSO_DOMAIN=example.com`:

| Option                                        | Demo value                                | With `SSO_DOMAIN=example.com`               |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| `oidcRPMetaDataOptionsRedirectUris`           | `http://ocm.localhost/auth/callback`      | `http://ocm.example.com/auth/callback`      |
| `oidcRPMetaDataOptionsPostLogoutRedirectUris` | `http://ocm.localhost`                    | `http://ocm.example.com`                    |
| `oidcRPMetaDataOptionsLogoutUrl`              | `http://ocm.localhost/logout/backchannel` | `http://ocm.example.com/logout/backchannel` |
| `oidcRPMetaDataOptionsClientSecret`           | `change-me`                               | The value of `OIDC_CLIENT_SECRET`           |

`oidcRPMetaDataOptionsLogoutUrl` is the back-channel logout: LemonLDAP calls
it when a user signs out of the portal. Generate the secret with, for
instance, `openssl rand -hex 32`. LemonLDAP reads these files as it starts:
restart it after changing them.

```bash
docker compose -f docker-compose.sso.yml restart lemonldap
```

## Before any real use

- The key pair that signs the tokens is public, in this repository: replace
  both files with a key pair of your own.
- LemonLDAP keeps its default authentication, which accepts the demo accounts
  `dwho`, `rtyler` and `msmith`, with their login as password.
