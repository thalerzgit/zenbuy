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
| Marketing version | `1.6` from `swift/Config/Shared.xcconfig` |
| Build number | `GITHUB_RUN_NUMBER + TVOS_BUILD_NUMBER_OFFSET` (default **5000** so it does not collide with iOS Dist builds on the same app) |

Client header: `X-ZenBuy-Client: tvos` (Worker skips Turnstile, same as iOS). Report allowances apply: the free weekly device quota until a purchase is redeemed, then the unlocked daily one — see [Spent allowance](#spent-allowance--the-unlock-panel).

## Remote-first flow (no Continue, no Back)

Nothing on Apple TV asks for a second click to confirm a choice, and nothing offers a Back button.

- **Single-choice steps auto-advance on select.** Clicking a card *is* the commit: mode picker (Find / Analyze), investment goal, profit window, and separate-vs-comparative all call their setter and `continueWizard()` in the same action. Every wizard option is valid on its own, so there is nothing for a Continue button to gate.
- **Multi-select is confirmed by its primary action.** Ticker picks stay multi-select and advance only on **Generate report** — or immediately when a single suggestion is added and the selection is complete. Auto-advancing a running total would make the fourth pick impossible.
- **The selection is the top of the Analyze screen, above the search field's results.** `Selected n of 4` and **Generate report** are drawn before the suggestion list, not after it. A search for `IBM` returns more rows than a 1080p page holds (`IBM.TO`, `IBM.NE`, `IBM.DE`, `IBM.DU`, `IBM.MU`, `IBM.MX`…), so chips placed under that list are off screen at the one moment they matter: the click that adds a ticker. The same layout hid the *reason* clicks stopped landing — a full selection carried over from a Find run. Suggestion rows are toggles (click again to remove, matching discover rows) and a click that cannot add says why instead of doing nothing.
- **Redoing a choice goes forward, not back.** "Change setup" on the unlocked screen reopens the wizard from step 1; **Restart** on a finished report clears the flow and returns to the mode picker. The Siri Remote's Menu button still pops a pushed screen — that is the system affordance, and the app draws no button for it.
- **Removing a Continue button removes a focus anchor.** A wizard step's only focusable views are its own cards, so `TVBrowseView` parks focus on the next step's lead card (`wizardLeadFocus` + `.onChange` + `.defaultFocus`) whenever `wizardStep` changes. Skipping that leaves the remote dead on the new step.

## Finished-report controls

A completed report (`didFinishSuccessfully && !isStreaming`) draws the same bar at the **top and bottom** of the output: **Restart** plus an **Email PDF** share control (`square.and.arrow.up`).

Email PDF opens an inline card next to the bar that was clicked — inline rather than an alert because focusing a tvOS text field is what raises the system keyboard. The address is remembered in `@AppStorage` so a second send is one click. Closing the card hands focus back to the share button it came from.

tvOS has no share sheet, so the PDF is rendered **server-side**: the app posts `{ reportId, email }` to `POST /api/report/email` and the Worker renders the colour PDF from the report already in KV (`src/worker/report-pdf.ts`) and mails it through Resend. The report id is computed on device with the shared `ReportCacheKey.make`, which is the same key the Worker caches under. Requires the `RESEND_API_KEY` Worker secret and the `REPORT_EMAIL_FROM` var; without them the endpoint answers 503 and the TV shows "Emailing reports isn't switched on yet".

## Spent allowance — the unlock panel

A refused report is HTTP 429 from `openQuotaGate`. `ZenBuyAPIClient` raises it as `ZenBuyAPIError.quota(code:message:)` rather than a plain `.http`, and `ReportViewModel` records it as `quotaBlock` — the one failure with a next step instead of a retry. `TVReportView` answers `.freeWeekly` with `TVUnlockView` and `.unlockedDaily` with a single **Try the report again** (buying cannot lift a cap that already applies to buyers). Either way the screen keeps at least one focusable control: the refusal used to be the only thing on it, which on Apple TV reads as a dead remote rather than as a limit.

`TVUnlockView` leads with **Sign in with Apple** when the Dist profile compiled `ZENBUY_SIWA` — that is the complimentary / already-linked-on-iPhone path, and it is the default focus. **Monthly**, **Buy once**, and **Restore purchase** sit below for people who have (or want) a StoreKit entitlement on the Apple ID signed into this Apple TV. Unlocking calls `ReportViewModel.retryBlockedRequest()`, so the viewer lands on the report they asked for rather than back on the home screen.

Restore that finds no IAP and no paid-app `AppTransaction` does **not** unlock. Complimentary `APPLE_ID_WHITELIST` access is an Apple ID fact, not a StoreKit fact — the empty-restore copy now points at Sign in with Apple (or buy / switch Apple ID in Settings → Users & Accounts). The dead-end line that only said “no purchase, try a different Apple ID” is gone.

**Purchase alone unlocks the TV — `POST /api/unlock-app`.** After a successful buy or restore the TV posts StoreKit 2 signed transactions (`AppTransaction` plus any Pro IAP) with no identity token, and the Worker mints a session keyed on the purchase: `txn:<originalTransactionId>`. Verification is the same `verifyAppleJws` / `entitlementFromTransaction` the web unlock runs — one billing path, a second door onto it. Because the subject is not an Apple `sub`, that token cannot unlock the website.

**Sign in with Apple unlocks complimentary or already-linked access — `POST /api/unlock-web`.** Same Worker door the iPhone globe uses. The TV control is a normal 10-foot button (not Apple's `SignInWithAppleButton`, which can fail to draw or take focus).

**Complimentary `APPLE_ID_WHITELIST` access still needs Sign in with Apple,** which needs the `com.apple.developer.applesignin` entitlement on the tvOS distribution profile. Archiving with the entitlement against a profile that lacks the capability fails the archive, so the profile decides rather than a variable: the **Resolve Sign in with Apple entitlement** step reads `Entitlements:com.apple.developer.applesignin` out of the profile it just installed and switches on both the entitlement and the `ZENBUY_SIWA` compilation condition that draws the button. The build is green either way and an inert button never ships.

`CI info.zenbuy.app tvOS AppStore` **already carries the capability** — build 5008 logged `Sign in with Apple ON` and archived with it, so complimentary sign-in is live on TV. If the profile is ever regenerated without it, the step reports `Sign in with Apple OFF`, the button disappears, and Buy / Restore still unlock through `POST /api/unlock-app`; re-adding it needs only a refreshed `ASC_PROFILE_TVOS_BASE64` secret and no code change. `vars.TVOS_SIGN_IN_WITH_APPLE=0` forces it off.

## 10-foot UI rules (ZenBuyTV only)

Never use `.buttonStyle(.bordered)` / `.borderedProminent` with `.tint(green)` on tvOS: the unfocused capsule fills with the tint and draws its label in the same green, so buttons render as blank green pills. Use the target styles in `ZenBuyTV/Theme/TVTheme.swift`:

| Control | Style | Unfocused | Focused |
|---------|-------|-----------|---------|
| CTA (Generate report, Restart, Send PDF) | `.buttonStyle(.tvPrimary)` | green fill, white label | dark-green fill, white label, gold ring, lift |
| Secondary (Change setup, Email PDF) | `.buttonStyle(.tvSecondary)` | white fill, green border, dark-green label | same as focused primary |
| Chip (About this goal, picks) | `.buttonStyle(.tvChip)` | white fill, green border, dark-green label | same as focused primary |
| Wizard card | `.buttonStyle(.tvCard(selected:minHeight:))` | white (or pale green when selected) with dark text in every state | gold ring + lift |
| Read-only report card | `TVFocusableCard` | white card | gold ring |

Gold is the only focus colour on TV. A green focus ring is unreadable on the cards that already carry a green *selected* border — and every discover result arrives pre-selected, so all four looked identical at 10 feet.

Other tvOS constraints baked into the target:

- **Every row of a page needs `.tvFocusRow()`** (`frame(maxWidth: .infinity) + focusSection()`). tvOS moves focus geometrically: a swipe only lands on a focusable view sitting in the corridor directly in the direction of travel, and a move with nothing in that corridor is silently dropped — the remote stops working and the screen looks frozen. It bites whenever a trailing control (the summary bar's "Change setup", a right-hand card) sits above leading-aligned content, which is most of this app. A row-wide focus section accepts the move instead and hands focus to its nearest focusable child. Sections only catch moves that cross them, so the rows on both sides of a hop each need one.
- A control that is `.disabled` while an async call runs is not focusable. Disabling the only CTA on screen during a request leaves the focus engine nowhere to go — keep the button enabled and guard its action.
- Async results that add focusable views do not move focus. Park focus explicitly (`@FocusState` + `.onChange`, with `.defaultFocus` for first appearance) or the user is left on whatever the focus engine picked while the screen was still loading.
- **Anything that removes the focused view has to say where focus goes next.** This covers auto-advance (the clicked card disappears), unlocking the wizard, and dismissing the inline email card. Give each candidate its own `@FocusState` value and set it in the same action.
- Type comes from the `TVTheme` scale (explicit point sizes, body ≥ 29pt). Semantic styles are outsized on TV — `.title2` is 48pt and truncated card titles.
- Cards get `lineLimit` + `minimumScaleFactor` + `fixedSize(vertical:)` and a `minHeight` so a row of cards is uniform and no title truncates.
- A `ScrollView` whose content is all text does not scroll with the Siri Remote — long report sections must be focusable (`TVFocusableCard`).
- Page backgrounds use `.ignoresSafeArea()`; without it the tvOS overscan inset shows through as black gutters.
- `Link` cannot open a browser on tvOS; report citations render as plain chips.

## What the TV target compiles — and why guards are `#if os(iOS)`

`ZenBuyTV` is not "the iPhone app on a TV". Its `Sources` phase is `ZenBuyTV/` plus an explicit shared list — `ZenBuy/Core/**` (including `ZenBuyStore` and `WebUnlockService`), the two view models, `ReportHTML(View)`, `ProcessingProgress`, `ProcessingPanelView`, `ZenBuyBrandMark`, `FlowLayout`. Every screen is a `TV*` view, so the iPhone screens stay out: `DirectiveDetailView` has `TVDirectiveDetailView`, `ReportStreamView`/`ReportModeView` have `TVReportView`/`TVReportModeView`, and `UnlockWebView` has `TVUnlockView` — the iPhone one leads with linking the purchase to the website, which is not a thing the TV can do.

**`#if canImport(UIKit)` does not mean iOS.** tvOS ships UIKit, so that check is true on Apple TV and fences off nothing. Use it only for genuinely shared UIKit types (`ZenBuyTheme.UIKitPalette` is fine — `UIColor` exists on tvOS). Anything iOS-only needs `#if os(iOS)`:

| API | tvOS |
|-----|------|
| `navigationBarTitleDisplayMode` | unavailable — the TV target draws its own titles |
| `UIActivityViewController`, `NSItemProvider.suggestedName` | unavailable — no share sheet; TV mails the PDF from the Worker |
| `UIApplication.beginBackgroundTask` | unavailable |
| `WebKit` | module does not exist |

So an iPhone-only file carries its guards anyway, even though membership already keeps it off Apple TV. Target membership is one checkbox in Xcode's File inspector and an accidental tick is invisible in the iOS build — `ReportPDFExporter.swift` and `DirectiveDetailView.swift` were once ticked into `ZenBuyTV` in a local `project.pbxproj` and the Apple TV scheme failed with three "unavailable in tvOS" errors while `main` stayed green. Guarded files degrade to a no-op instead of breaking the build. If the TV scheme ever fails this way, check `git status` on `swift/ZenBuy.xcodeproj/project.pbxproj` before changing any code.

`ios-testflight.yml` matches `swift/**` minus the TV-only paths, so a guard added to a shared iOS file archives the iPhone app and submits it for App Store review. When the change is compile-time only, put `[no-appstore]` in the commit message: the build still reaches TestFlight, but `submit_review` is skipped so an in-flight review keeps its queue position.

## Hard Dist rules (same as iOS)

- Never `-allowProvisioningUpdates`
- Never mint iOS/tvOS **Development** certificates on CI
- Manual **Apple Distribution** `.p12` (OpenSSL-legacy 3DES) + a **tvOS App Store** profile

## ASC UI + secrets checklist

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
