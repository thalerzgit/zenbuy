#if ZENBUY_SIWA
import AuthenticationServices
#endif
import StoreKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The way past the report allowance, drawn where the refusal appears.
///
/// Two link paths, both on this Apple TV's Apple ID:
///
/// 1. **Sign in with Apple** — complimentary `APPLE_ID_WHITELIST` access, or
///    the same Apple ID already linked on iPhone / zenbuy.info. Restore cannot
///    see that grant; it is not a StoreKit entitlement.
/// 2. **Buy / Restore** — Monthly and Buy once charge the Apple ID signed into
///    this Apple TV. Restore syncs StoreKit and redeems IAP entitlements and
///    the paid App Store download (`AppTransaction`) via `POST /api/unlock-app`.
///
/// Sign in with Apple is compiled in only when the Dist profile carries the
/// capability (`ZENBUY_SIWA`). The control is a TV-styled button, not Apple's
/// `SignInWithAppleButton`, so it stays visible and focusable on the Siri Remote.
struct TVUnlockView: View {
    private enum UnlockFocus: Hashable {
        case signIn
        case product(String)
        case restore
        case retry
    }

    let store: ZenBuyStore
    let unlock: WebUnlockService
    /// Re-run the refused report. Called only after a session token is held.
    let onUnlocked: () -> Void
    let onRetry: () -> Void

    @FocusState private var focus: UnlockFocus?
    #if ZENBUY_SIWA
    @State private var appleSignIn = AppleIDSignInSession()
    @State private var isSigningIn = false
    #endif

    private var isWorking: Bool {
        unlock.isWorking || store.isRestoring || store.purchasingProductID != nil || isLinkingAppleID
    }

    /// Sign-in in flight — Restore should not steal that spinner.
    private var isLinkingAppleID: Bool {
        #if ZENBUY_SIWA
        isSigningIn
        #else
        false
        #endif
    }

    private var leadFocus: UnlockFocus {
        switch UnlockLinkPolicy.leadControl(
            signInAvailable: UnlockLinkPolicy.signInAvailable,
            firstProductID: store.products.first?.id
        ) {
        case .signIn: return .signIn
        case let .product(id): return .product(id)
        case .restore: return .restore
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Unlock unlimited research")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            Text("Link this Apple TV to the same Apple ID you use on iPhone and zenbuy.info. Complimentary access signs in. A Monthly or Buy once purchase charges the Apple ID signed into this Apple TV.")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            signInRow
            productRows
            secondaryRow

            if let message = store.errorMessage ?? unlock.errorMessage {
                Text(message)
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.bear)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("Payment is charged to the Apple ID signed into this Apple TV. The monthly plan renews until cancelled in Settings → Users & Accounts → Subscriptions.")
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
            // Prices arrive after the panel does. Do not steal focus from Sign
            // in with Apple — that is the complimentary / already-linked path.
            guard focus == nil || focus == UnlockFocus.restore || focus == UnlockFocus.retry
            else { return }
            if case let .product(id) = leadFocus {
                focus = .product(id)
            }
        }
    }

    /// Complimentary / already-linked path. Drawn only when the Dist profile
    /// carries Sign in with Apple, which the archive step turns into `ZENBUY_SIWA`.
    @ViewBuilder
    private var signInRow: some View {
        #if ZENBUY_SIWA
        VStack(alignment: .leading, spacing: 12) {
            Text("Already unlocked on iPhone or zenbuy.info?")
                .font(TVTheme.sectionTitleFont)
                .foregroundStyle(ZenBuyTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text("Sign in with the Apple ID that already has complimentary access or a linked purchase. Restore cannot see that — it only finds App Store purchases on this Apple ID.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                startSignIn()
            } label: {
                HStack(spacing: 16) {
                    if isSigningIn {
                        ProgressView()
                    }
                    Text("Sign in with Apple")
                }
            }
            .buttonStyle(.tvPrimary)
            .focused($focus, equals: .signIn)
        }
        .tvFocusRow()
        #endif
    }

    @ViewBuilder
    private var productRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(UnlockLinkPolicy.signInAvailable ? "Or buy on this Apple TV" : "Buy on this Apple TV")
                .font(TVTheme.sectionTitleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            Text("Monthly and Buy once charge the Apple ID signed into this Apple TV — 25 reports a day instead of the free three a week.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            if store.products.isEmpty {
                if store.isLoadingProducts {
                    HStack(spacing: 16) {
                        ProgressView().tint(ZenBuyTheme.green)
                        Text("Asking the App Store for prices…")
                            .font(TVTheme.captionFont)
                            .foregroundStyle(ZenBuyTheme.muted)
                    }
                } else {
                    Text("The App Store didn't answer with prices. Restore below if you already bought ZenBuy on this Apple ID, or try again in a moment.")
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
            }
        }
        .tvFocusRow()
    }

    private var secondaryRow: some View {
        HStack(spacing: 24) {
            Button {
                restore()
            } label: {
                HStack(spacing: 16) {
                    if store.isRestoring || (unlock.isWorking && store.purchasingProductID == nil && !isLinkingAppleID) {
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
    private func startSignIn() {
        guard !isWorking, !isSigningIn else { return }
        isSigningIn = true
        Task {
            defer { isSigningIn = false }
            do {
                let credential = try await appleSignIn.perform()
                await unlock.link(credential: credential, store: store)
                guard unlock.status == .unlocked else { return }
                onUnlocked()
            } catch {
                if (error as? ASAuthorizationError)?.code == .canceled { return }
                unlock.errorMessage = "Sign in with Apple didn't complete. Try again."
            }
        }
    }
    #endif
}

#if ZENBUY_SIWA
/// tvOS-safe Sign in with Apple. Apple's `SignInWithAppleButton` can fail to
/// draw or take focus on the 10-foot UI; this session is a normal TV button
/// plus `ASAuthorizationController`.
@MainActor
final class AppleIDSignInSession: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
    private var controller: ASAuthorizationController?

    func perform() async throws -> ASAuthorizationAppleIDCredential {
        if continuation != nil {
            throw ASAuthorizationError(.unknown)
        }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        self.controller = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            continuation?.resume(throwing: ASAuthorizationError(.unknown))
            continuation = nil
            return
        }
        continuation?.resume(returning: credential)
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        self.controller = nil
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if canImport(UIKit)
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        #else
        ASPresentationAnchor()
        #endif
    }
}
#endif
