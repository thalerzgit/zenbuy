# ZenBuy iOS (native)

Native SwiftUI iPhone app for ZenBuy — not a WebView wrapper. Shares the same Cloudflare Worker API as [zenbuy.info](https://zenbuy.info).

## Open in Xcode

```bash
open swift/ZenBuy.xcodeproj
```

1. Select the **ZenBuy** scheme (iPhone) or **ZenBuyTV** (Apple TV simulator / device).
2. Set your **Team** under Signing & Capabilities (or uncomment `DEVELOPMENT_TEAM` in `Config/Debug.xcconfig`).
3. Press **Run** (⌘R).

Apple TV uses the same Worker APIs and bundle id `info.zenbuy.app` (add the tvOS platform in App Store Connect). See [docs/TVOS_TESTFLIGHT.md](../docs/TVOS_TESTFLIGHT.md).

## Project layout

```
swift/
  Config/                 # xcconfig — bundle id, API base URL, version
  ZenBuy.xcodeproj/
  ZenBuy/
    Core/API/             # URLSession client + SSE stream reader
    Core/Models/          # Codable types matching Worker JSON
    Core/Theme/           # Sage green design tokens
    Features/Search/      # Enter Tickers + Find Tickers
    Features/Report/      # Mode screen + native streaming report
    Resources/            # Assets, Privacy manifest
  ZenBuyTV/               # tvOS target — Focus Engine / 10-foot browse + report
  ZenBuyTests/
  ZenBuyUITests/
```

## API endpoints (production)

| Route | Used for |
|-------|----------|
| `GET /api/search?q=` | Symbol autocomplete |
| `GET /api/prefetch?symbol=` | Warm fundamentals cache |
| `GET /api/config` | Public client config |
| `POST /api/research` | SSE research stream |

Default base URL: `https://zenbuy.info` (`Config/Shared.xcconfig`). Native iOS sends `X-ZenBuy-Client: ios`; Apple TV sends `tvos`.

To point at a local Worker during API work, uncomment `ZENBUY_API_BASE_URL` in `Config/Debug.xcconfig`.

## App Store Connect checklist

| Item | Value / action |
|------|----------------|
| Bundle ID | `info.zenbuy.app` — **create the Bundle ID in Apple Developer / App Store Connect** (Identifiers → App IDs). Do **not** create via ASC API. |
| ASC app | **create the app in App Store Connect UI** — name ZenBuy, bundle `info.zenbuy.app`, SKU `zenbuy-ios-001` |
| Category | Finance |
| App icon | 1024×1024 PNG in `Assets.xcassets/AppIcon` |
| Privacy | Policy URL: `https://zenbuy.info/privacy` (Worker HTML). `PrivacyInfo.xcprivacy` included; update if you add analytics |
| Export compliance | Standard HTTPS only — `ITSAppUsesNonExemptEncryption = NO` |

Admin ASC API key cannot `CREATE` apps; CI only **checks** that the app exists, then archives/uploads and invites `thalerz@me.com`.

### Archive & upload

Pushes that touch iPhone Swift paths run `.github/workflows/ios-testflight.yml` on `macos-26` (Xcode 26.6). Apple TV paths run `.github/workflows/tvos-testflight.yml` (internal TestFlight only — see `docs/TVOS_TESTFLIGHT.md`).

iOS jobs:

1. **Validate rails** — ASC + Dist secrets, Xcode 26.6, ExportOptions (manual Dist) / scheme / team / bundle id.
2. **Archive and upload** — import Dist p12 + App Store profile, archive with `CODE_SIGN_STYLE=Manual` (no `-allowProvisioningUpdates`), export+upload; invite `thalerz@me.com` **only after a successful upload**.
3. **App Store review** — after the Dist build is `VALID`, `tools/asc-ios.mjs submit-review` retracts any in-flight iOS review, attaches the latest VALID build, sets What’s New, and submits. Ubuntu/ASC API only — never Dev certs, never `-allowProvisioningUpdates`.

Automatic signing on ephemeral runners mints iOS Development certs and fails when the Apple account is at the 3-cert cap. CI uses **manual Distribution signing** only.

Repo Actions secrets required (stamp from Mini — never invent/commit keys or certs):

| Secret | Role |
|--------|------|
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY` | ASC API (ensure-app, invite, IPA upload, submit-review) |
| `ASC_DIST_P12_BASE64` | Apple Distribution .p12 (legacy 3DES — AES-PBES2 fails `security import`) |
| `ASC_DIST_P12_PASSWORD` | Password for that p12 |
| `ASC_PROFILE_APP_BASE64` | App Store profile **CI info.zenbuy.app AppStore** (no widget) |
| `ASC_PROFILE_TVOS_BASE64` | tvOS App Store profile **CI info.zenbuy.app tvOS AppStore** |

Optional var: `IOS_BUILD_NUMBER_OFFSET` (default `100`). Build number = `GITHUB_RUN_NUMBER + offset`.

After the ASC app exists: **Actions → TestFlight → Run workflow** (`workflow_dispatch`).

Manual local archive:

1. **Product → Archive** (Release configuration).
2. **Distribute App → App Store Connect**.

Native iOS requests send `X-ZenBuy-Client: ios`; the Worker skips Turnstile for that header (web clients still require it). Report limits apply to all clients: they also send `X-ZenBuy-Device`, a random Keychain UUID (`ZenBuyDeviceIdentity`) so the free weekly allowance is counted per device instead of per IP. An unlocked purchase is counted per Apple subject and the device header is ignored.

## Tests

```bash
cd swift
xcodebuild test \
  -project ZenBuy.xcodeproj \
  -scheme ZenBuy \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Versioning

- Marketing version: `1.6` (`Config/Shared.xcconfig`)
- Build number: CI stamps `CURRENT_PROJECT_VERSION` as `GITHUB_RUN_NUMBER + offset` (default offset `100`). Do not bump it for each upload.
