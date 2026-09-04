# Apple web unlock — setup checklist

One ZenBuy App Store purchase unlocks zenbuy.info as well. This file lists the
console work and secrets that make that work. Nothing here is in the repo, and
until it is done the site behaves exactly as it does today: the unlock guide
still opens, but `/auth/apple` redirects straight back with `?signin=failed`.

The whole design rests on one fact: **Apple gives the same `sub` (subject
identifier) to the iOS app and to the website only when the Services ID is
configured under `info.zenbuy.app` as its primary App ID.** If that link is
missing, purchases will verify and sign-in will succeed, but the two halves
will never recognize each other.

---

## 1. Apple Developer portal

All under [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources).

### 1.1 Enable Sign in with Apple on the App ID

1. **Identifiers → `info.zenbuy.app`**
2. Tick **Sign in with Apple**, then **Edit** and choose **Enable as a primary App ID**.
3. Save.

### 1.2 Create the Services ID

1. **Identifiers → + → Services IDs**
2. Description `ZenBuy Web`, identifier **`info.zenbuy.web`**.
   This exact string is `APPLE_SERVICES_ID` in `wrangler.jsonc` — change one and change the other.
3. Save, reopen it, tick **Sign in with Apple**, then **Configure**:
   - **Primary App ID:** `info.zenbuy.app` (this is the step that makes `sub` match)
   - **Domains and Subdomains:** `zenbuy.info`
   - **Return URLs:** `https://zenbuy.info/auth/apple/callback`

Apple verifies the domain before it will save this — see step 2 first, because
the Worker has to be serving the association file at that moment.

### 1.3 Create the Sign in with Apple key

1. **Keys → +**, name it `ZenBuy Sign in with Apple`.
2. Tick **Sign in with Apple**, **Configure** → primary App ID `info.zenbuy.app`.
3. **Download the `.p8`.** Apple allows this exactly once.
4. Note the **Key ID** (10 characters).

This is a *different* key from the App Store Connect API key in
`~/code/Private Keys/` — that one is for uploading builds, this one signs
OAuth client secrets. Do not reuse either for the other.

### 1.4 Regenerate the CI provisioning profile

Adding a capability changes the entitlements, and TestFlight archives are
signed manually against a fixed profile, so the archive fails until the
profile knows about it.

1. **Profiles → `CI info.zenbuy.app AppStore` → Edit → Save** (re-generating picks up Sign in with Apple).
2. Download it, then `base64` it and replace the GitHub secret **`ASC_PROFILE_APP_BASE64`**.
3. Only then set the GitHub **repository variable `IOS_SIGN_IN_WITH_APPLE`** to `1`.

Until that variable is `1`, the TestFlight workflow archives without the
entitlement and stays green — the app builds and ships, and only the Sign in
with Apple button is inert.

---

## 2. Cloudflare Worker

### Secrets — `wrangler secret put <NAME>` or Workers → zenbuy → Settings → Variables

| Name | Value |
|------|-------|
| `APPLE_KEY_ID` | Key ID from step 1.3 |
| `APPLE_PRIVATE_KEY` | Full contents of the `.p8`, including the `-----BEGIN PRIVATE KEY-----` lines |
| `APPLE_DOMAIN_ASSOCIATION` | Contents of the `apple-developer-domain-association.txt` Apple offers during step 1.2 |

The Worker serves that last one at
`https://zenbuy.info/.well-known/apple-developer-domain-association.txt`, which
is what Apple fetches to verify the domain. Set it **before** saving the
Services ID configuration.

### Vars — already committed in `wrangler.jsonc`, listed here so they are reviewable

| Name | Value | Notes |
|------|-------|-------|
| `APPLE_SERVICES_ID` | `info.zenbuy.web` | Must equal the Services ID |
| `APPLE_TEAM_ID` | `XQP4QUVJYY` | |
| `APPLE_BUNDLE_ID` | `info.zenbuy.app` | Audience for the app's identity token |
| `APPLE_PRO_PRODUCT_IDS` | `info.zenbuy.app.lifetime,info.zenbuy.app.pro.monthly` | Either one unlocks |
| `APPLE_ALLOW_SANDBOX` | `1` | TestFlight buys through the sandbox. Set to `0` on App Store release day |
| `APP_STORE_URL` | *(empty)* | Set to `https://apps.apple.com/app/id6807960678` on release day; empty hides the "get the app" row in the guide |
| `RATE_LIMIT_PRO_DAILY` | `100` | Daily reports per unlocked Apple ID |

---

## 3. App Store Connect

No review submission is part of this work. What does need to be true for a
TestFlight tester to buy:

- App `6807960678` has both in-app purchases — `info.zenbuy.app.lifetime`
  ($349.99) and `info.zenbuy.app.pro.monthly` ($19.99) — in at least
  **Ready to Submit**. Products in *Missing Metadata* do not load in sandbox.
- The **Paid Applications agreement** is active, with banking and tax complete.
  StoreKit returns an empty product list if it is not.
- A **Sandbox tester** exists (Users and Access → Sandbox), signed in on the
  device under Settings → Developer → Sandbox Apple Account.

---

## 4. Verifying it end to end

```bash
# Before setup: signed out, and sign-in bounces.
curl -s https://zenbuy.info/api/me                       # {"signedIn":false,"unlocked":false}
curl -sI https://zenbuy.info/auth/apple | grep -i location

# After step 2: Apple can verify the domain.
curl -s https://zenbuy.info/.well-known/apple-developer-domain-association.txt

# After step 1: /auth/apple redirects to Apple with the Services ID.
curl -sI https://zenbuy.info/auth/apple | grep -i location
#   → https://appleid.apple.com/auth/authorize?...client_id=info.zenbuy.web...
```

Then, on a device: buy in the app → globe → Sign in with Apple → the screen
says *Purchase linked*. On zenbuy.info: **Own it? Unlock this site** → Sign in
with Apple → the page reloads with `?unlocked=1` and the header shows
**Unlocked**.

If the website says you are signed in but not unlocked, the app step has not
been completed with that same Apple ID. The banner's **Unlink** is the way out.
