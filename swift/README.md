# ZenBuy iOS (native)

Native SwiftUI iPhone app for ZenBuy — not a WebView wrapper. Shares the same Cloudflare Worker API as [zenbuy.info](https://zenbuy.info).

## Open in Xcode

```bash
open swift/ZenBuy.xcodeproj
```

1. Select the **ZenBuy** scheme and an iPhone simulator (or device).
2. Set your **Team** under Signing & Capabilities (or uncomment `DEVELOPMENT_TEAM` in `Config/Debug.xcconfig`).
3. Press **Run** (⌘R).

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

Default base URL: `https://zenbuy.info` (`Config/Shared.xcconfig`).

To point at a local Worker during API work, uncomment `ZENBUY_API_BASE_URL` in `Config/Debug.xcconfig`.

## App Store Connect checklist

| Item | Value / action |
|------|----------------|
| Bundle ID | `info.zenbuy.app` — **Justin creates in Apple Developer UI** (Identifiers → App IDs). Do **not** create via ASC API. |
| ASC app | **Justin creates in App Store Connect UI** — name ZenBuy, bundle `info.zenbuy.app`, SKU `zenbuy-ios-001` |
| Category | Finance |
| App icon | 1024×1024 PNG in `Assets.xcassets/AppIcon` |
| Privacy | `PrivacyInfo.xcprivacy` included; update if you add analytics |
| Export compliance | Standard HTTPS only — `ITSAppUsesNonExemptEncryption = NO` |

Admin ASC API key cannot `CREATE` apps; CI only **checks** that the app exists, then archives/uploads and invites `thalerz@me.com`.

### Archive & upload

Pushes that touch `swift/**` run `.github/workflows/ios-testflight.yml` on `macos-26` (Xcode 26.6):

1. **Validate rails** — ASC + Dist secrets, Xcode 26.6, ExportOptions (manual Dist) / scheme / team / bundle id.
2. **Archive and upload** — import Dist p12 + App Store profile, archive with `CODE_SIGN_STYLE=Manual` (no `-allowProvisioningUpdates`), export+upload; invite `thalerz@me.com` **only after a successful upload**. Does **not** submit for App Store review.

Automatic signing on ephemeral runners mints iOS Development certs and fails when the Apple account is at the 3-cert cap. CI uses **manual Distribution signing** only.

Repo Actions secrets required (stamp from Mini — never invent/commit keys or certs):

| Secret | Role |
|--------|------|
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY` | ASC API (ensure-app, invite, IPA upload) |
| `ASC_DIST_P12_BASE64` | Apple Distribution .p12 (legacy 3DES — AES-PBES2 fails `security import`) |
| `ASC_DIST_P12_PASSWORD` | Password for that p12 |
| `ASC_PROFILE_APP_BASE64` | App Store profile **CI info.zenbuy.app AppStore** (no widget) |

Optional var: `IOS_BUILD_NUMBER_OFFSET` (default `100`). Build number = `GITHUB_RUN_NUMBER + offset`.

After Justin creates the ASC app: **Actions → TestFlight → Run workflow** (`workflow_dispatch`).

Manual local archive:

1. **Product → Archive** (Release configuration).
2. **Distribute App → App Store Connect**.

Native iOS requests send `X-ZenBuy-Client: ios`; the Worker skips Turnstile for that header (web clients still require it). Daily rate limits apply to all clients.

## Tests

```bash
cd swift
xcodebuild test \
  -project ZenBuy.xcodeproj \
  -scheme ZenBuy \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Versioning

- Marketing version: `1.0` (`Config/Shared.xcconfig`)
- Build number: `CURRENT_PROJECT_VERSION` in the same file — bump before each TestFlight upload.
