#if ZENBUY_SIWA
import AuthenticationServices
#endif
import StoreKit
import SwiftUI

/// The way past the report allowance, drawn where the refusal appears.
///
/// The Worker answers a spent allowance with HTTP 429 and a sentence of prose.
/// On Apple TV that sentence used to be the whole screen — no control, so no
/// focusable view, so a remote that did nothing. This panel is the next step:
/// buy, restore, or (once the distribution profile carries the capability)
/// sign in for complimentary access. Unlocking re-runs the report that was
/// refused, so the viewer lands on the thing they asked for rather than on a
/// home screen.
///
/// The iPhone equivalent is `UnlockWebView`, which cannot be reused: it leads
/// with linking the purchase to the website — the TV has no browser to unlock —
/// and it is built from `navigationBarTitleDisplayMode` and tap-sized rows.
struct TVUnlockView: View {
    private enum UnlockFocus: Hashable {
        case product(String)
        case signIn
        case restore
        case retry
    }

    let store: ZenBuyStore
    let unlock: WebUnlockService
    /// Re-run the refused report. Called only after a session token is held.
    let onUnlocked: () -> Void
    let onRetry: () -> Void

    @FocusState private var focus: UnlockFocus?

    private var isWorking: Bool {
        unlock.isWorking || store.isRestoring || store.purchasingProductID != nil
    }

    /// Lead control: the cheapest thing to buy, else whatever else can be
    /// clicked. tvOS drops focus rather than guessing, so this is never nil by
    /// accident — Restore is always on screen.
    private var leadFocus: UnlockFocus {
        if let first = store.products.first {
            return .product(first.id)
        }
        return .restore
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Unlock unlimited research")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            Text("One ZenBuy purchase covers this Apple TV, your iPhone and zenbuy.info — 25 reports a day instead of the free three a week.")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            productRows
            signInRow
            secondaryRow

            if let message = store.errorMessage ?? unlock.errorMessage {
                Text(message)
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.bear)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("Payment is charged to your Apple ID. The monthly plan renews until cancelled in Settings → Users & Accounts → Subscriptions.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(TVTheme.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZenBuyTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous)
                .strokeBorder(ZenBuyTheme.green.opacity(0.5), lineWidth: 3)
        )
        .defaultFocus($focus, leadFocus)
        .task {
            await store.loadIfNeeded()
            // Prices arrive after the panel does, and an async result never
            // moves tvOS focus on its own. Only the fallback lead is taken
            // over — a viewer who already moved to Restore keeps it.
            guard focus == nil || focus == UnlockFocus.restore else { return }
            if let first = store.products.first {
                focus = .product(first.id)
            }
        }
    }

    @ViewBuilder
    private var productRows: some View {
        if store.products.isEmpty {
            if store.isLoadingProducts {
                HStack(spacing: 16) {
                    ProgressView().tint(ZenBuyTheme.green)
                    Text("Asking the App Store for prices…")
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                }
            } else {
                Text("The App Store didn't answer with prices. Restore below if you already bought ZenBuy, or try again in a moment.")
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            HStack(spacing: 24) {
                ForEach(store.products, id: \.id) { product in
                    // Stays enabled while a purchase is in flight: a disabled
                    // button is not focusable on tvOS, and `buy` guards itself.
                    Button {
                        buy(product)
                    } label: {
                        HStack(spacing: 16) {
                            if store.purchasingProductID == product.id {
                                ProgressView()
                            }
                            Text("\(Self.title(for: product)) · \(product.displayPrice)")
                        }
                    }
                    .buttonStyle(
                        TVActionButtonStyle(
                            kind: product.id == ZenBuyStore.lifetimeProductID ? .primary : .secondary
                        )
                    )
                    .focused($focus, equals: .product(product.id))
                }
            }
            .tvFocusRow()
        }
    }

    /// Complimentary `APPLE_ID_WHITELIST` access is an Apple ID fact, so only a
    /// sign-in can claim it.
    ///
    /// Drawn only when the distribution profile carries the Sign in with Apple
    /// capability, which the archive step checks and turns into `ZENBUY_SIWA`.
    /// Without the entitlement Apple refuses the request outright, and a button
    /// that cannot work is the dead end this whole panel exists to remove.
    @ViewBuilder
    private var signInRow: some View {
        #if ZENBUY_SIWA
        VStack(alignment: .leading, spacing: 12) {
            Text("Given complimentary access? Sign in with the Apple ID it was granted to.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                handleSignIn(result)
            }
            .signInWithAppleButtonStyle(.black)
            .frame(maxWidth: 620, minHeight: 80)
            .focused($focus, equals: .signIn)
        }
        .tvFocusRow()
        #endif
    }

    private var secondaryRow: some View {
        HStack(spacing: 24) {
            Button {
                restore()
            } label: {
                HStack(spacing: 16) {
                    if store.isRestoring || unlock.isWorking {
                        ProgressView()
                    }
                    Text("Restore purchase")
                }
            }
            .buttonStyle(.tvSecondary)
            .focused($focus, equals: .restore)

            Button("Try the report again") {
                onRetry()
            }
            .buttonStyle(.tvSecondary)
            .focused($focus, equals: .retry)
        }
        .tvFocusRow()
    }

    private static func title(for product: Product) -> String {
        product.id == ZenBuyStore.lifetimeProductID ? "Buy once" : "Monthly"
    }

    private func buy(_ product: Product) {
        guard !isWorking else { return }
        Task {
            guard await store.purchase(product) else { return }
            await redeem()
        }
    }

    private func restore() {
        guard !isWorking else { return }
        Task {
            guard await store.restore() else { return }
            await redeem()
        }
    }

    /// Owning the purchase is not the same as the Worker knowing about it: the
    /// allowance moves only once a session token is held.
    private func redeem() async {
        guard await unlock.redeemPurchase(store: store) else { return }
        onUnlocked()
    }

    #if ZENBUY_SIWA
    private func handleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case let .success(authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential
            else {
                unlock.errorMessage = "That sign-in didn't return an Apple ID. Try again."
                return
            }
            Task {
                await unlock.link(credential: credential, store: store)
                guard unlock.status == .unlocked else { return }
                onUnlocked()
            }

        case let .failure(error):
            // Cancelling is a normal choice, not an error worth reporting.
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            unlock.errorMessage = "Sign in with Apple didn't complete. Try again."
        }
    }
    #endif
}
