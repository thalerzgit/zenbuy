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
| Bundle ID | `info.zenbuy.app` — register in [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) |
| SKU | e.g. `zenbuy-ios-001` |
| Category | Finance |
| App icon | Add 1024×1024 PNG to `Assets.xcassets/AppIcon` |
| Privacy | `PrivacyInfo.xcprivacy` included; update if you add analytics |
| Export compliance | Standard HTTPS only — no custom encryption beyond Apple OS |

### Archive & upload

Pushes that touch `swift/**` run `.github/workflows/ios-testflight.yml` on `macos-26` (Xcode 26.6): archive, upload to App Store Connect, invite the internal tester. It does **not** submit for App Store review.

Repo Actions secrets required: `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY` (same key as sibling apps). Optional var: `IOS_BUILD_NUMBER_OFFSET` (default `100`). Build number = `GITHUB_RUN_NUMBER + offset`.

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

- Marketing version: `0.1.0` (`Config/Shared.xcconfig`)
- Build number: `CURRENT_PROJECT_VERSION` in the same file — bump before each TestFlight upload.
