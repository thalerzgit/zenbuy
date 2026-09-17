# ZenBuy Apple TV — Dist TestFlight

Native **tvOS** target `ZenBuyTV` in `swift/ZenBuy.xcodeproj`. Same Worker APIs as iPhone (`https://zenbuy.info`). Same bundle ID **`info.zenbuy.app`** — add the **Apple TV** platform to the existing ASC app (do not invent a second listing unless the App ID cannot take tvOS).

Internal TestFlight only. CI never submits App Store review for tvOS.

This session / cloud agents cannot run Xcode. Archives happen on GitHub `macos-26` runners.

## What shipped in the repo

| Piece | Location |
|-------|----------|
| TV target + 10-foot UI | `swift/ZenBuyTV/` |
| Scheme | `ZenBuyTV` (archive Release) |
| Brand assets | `ZenBuyTV/Resources/Assets.xcassets/AppIcon.brandassets` — layered `App Icon` / `App Icon - App Store` plus Top Shelf Image Wide (`2320×720` / `4640×1440`). `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`. |
| Info.plist keys | `swift/ZenBuyTV/Info.plist` merged via `TVOS.xcconfig` (`CFBundleIcons.CFBundlePrimaryIcon`, `TVTopShelfImage.TVTopShelfPrimaryImageWide`) |
| ExportOptions | `swift/ExportOptions-tvos.plist` (manual Dist, upload) |
| Dist workflow | `.github/workflows/tvos-testflight.yml` |
| ASC helper | `tools/asc-tvos.mjs` (`ensure-app`, `invite-tester`, `status`, `wait-valid`) |
| Marketing version | `1.5` from `swift/Config/Shared.xcconfig` |
| Build number | `GITHUB_RUN_NUMBER + TVOS_BUILD_NUMBER_OFFSET` (default **5000** so it does not collide with iOS Dist builds on the same app) |

Client header: `X-ZenBuy-Client: tvos` (Worker skips Turnstile, same as iOS). No StoreKit / web unlock / PDF share on TV — living-room research uses the free weekly device quota.

## Hard Dist rules (same as iOS)

- Never `-allowProvisioningUpdates`
- Never mint iOS/tvOS **Development** certificates on CI
- Manual **Apple Distribution** `.p12` (OpenSSL-legacy 3DES) + a **tvOS App Store** profile

## Justin checklist (ASC UI + secrets)

Admin ASC API **cannot CREATE apps**. If the Apple TV platform is missing, do this in the browser, then re-run **Actions → TestFlight tvOS**.

### A. Add Apple TV to the existing ZenBuy app (recommended)

1. [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **ZenBuy** (`info.zenbuy.app`).
2. Next to **Platforms**, click **+** → **Apple TV**.
3. Create the first tvOS version **1.4** (match `MARKETING_VERSION`).
4. [Developer portal](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → **`info.zenbuy.app`** → enable **tvOS** / Apple TV if the App ID is iOS-only.

### B. Only if the existing App ID cannot take tvOS

1. Identifiers → **+** → App IDs → **tvOS** → Bundle ID `info.zenbuy.tv`.
2. App Store Connect → **My Apps** → **New App** → Apple TV → name ZenBuy, bundle `info.zenbuy.tv`, SKU `zenbuy-tvos-001`.
3. Stop and tell the coding session — the repo target currently uses `info.zenbuy.app` and must be retargeted before upload.

### C. tvOS App Store provisioning profile

1. Profiles → **+** → **tvOS** → **App Store**.
2. App ID **`info.zenbuy.app`**.
3. Name it exactly: **`CI info.zenbuy.app tvOS AppStore`**.
4. Download the `.mobileprovision`.

### D. GitHub Actions secret

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|--------|
| `ASC_PROFILE_TVOS_BASE64` | `base64` of the tvOS App Store `.mobileprovision` |

Reuse existing Dist secrets (already used by iOS TestFlight):

- `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY`
- `ASC_DIST_P12_BASE64` / `ASC_DIST_P12_PASSWORD`

Optional variable: `TVOS_BUILD_NUMBER_OFFSET` (default `5000`).

Do **not** paste the profile or p12 into chat. Stamp the secret in the GitHub UI.

### E. Re-run

**Actions → TestFlight tvOS → Run workflow**.

CI will:

1. Fail clearly if the Apple TV platform or `ASC_PROFILE_TVOS_BASE64` is missing (no fake upload).
2. Archive `ZenBuyTV` for `generic/platform=tvOS` with manual Dist.
3. Upload and invite **`thalerz@me.com`** (groups listed client-side — no `filter[name]` on betaGroups).
4. Wait until the Dist build is **VALID**.

Install from TestFlight on Apple TV (same Apple ID as the internal tester).
