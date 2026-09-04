import AuthenticationServices
import StoreKit
import SwiftUI

/// The globe screen: buy ZenBuy, restore it, and link it to an Apple ID so
/// zenbuy.info unlocks too.
///
/// It is deliberately one screen. Splitting the purchase from the linking is
/// what leaves people signed in on the website with nothing unlocked, so the
/// order is spelled out here and the link button stays visibly unavailable
/// until there is a purchase to link.
struct UnlockWebView: View {
    @Environment(\.dismiss) private var dismiss
    let store: ZenBuyStore
    let unlock: WebUnlockService

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    intro

                    if unlock.status == .unlocked {
                        unlockedCard
                    } else {
                        if !store.hasPurchase {
                            purchaseSection
                        }
                        linkSection
                    }

                    if let message = store.errorMessage ?? unlock.errorMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(ZenBuyTheme.bear)
                    }

                    restoreButton
                    finePrint
                }
                .padding(20)
            }
            .background(ZenBuyTheme.background)
            .navigationTitle("Unlock Web")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            await store.loadIfNeeded()
            await unlock.refresh()
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "globe")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(ZenBuyTheme.green)

            Text("One purchase, both places")
                .font(.title3.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)

            Text("Your ZenBuy purchase covers this app and the full research desk at zenbuy.info.")
                .font(.subheadline)
                .foregroundStyle(ZenBuyTheme.muted)

            VStack(alignment: .leading, spacing: 6) {
                benefit("25 reports a day, not the free three a week")
                benefit("No human check before every report")
                benefit("Unlocked on every device you sign in from")
            }
            .padding(.top, 2)
        }
    }

    private func benefit(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(ZenBuyTheme.greenPositive)
            Text(text)
                .font(.footnote)
                .foregroundStyle(ZenBuyTheme.ink)
        }
    }

    private var purchaseSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            stepLabel(1, "Buy ZenBuy")

            if store.isLoadingProducts && store.products.isEmpty {
                ProgressView().padding(.vertical, 8)
            } else if store.products.isEmpty {
                Text("Prices are unavailable right now. Pull down or reopen this screen to retry.")
                    .font(.footnote)
                    .foregroundStyle(ZenBuyTheme.muted)
            } else {
                ForEach(store.products, id: \.id) { product in
                    productRow(product)
                }
            }
        }
    }

    private func productRow(_ product: Product) -> some View {
        Button {
            Task { await store.purchase(product) }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(product.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ZenBuyTheme.ink)
                    Text(product.id == ZenBuyStore.lifetimeProductID
                         ? "Pay once. Yours for good."
                         : "Renews monthly. Cancel anytime in Settings.")
                        .font(.caption)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 8)

                if store.purchasingProductID == product.id {
                    ProgressView()
                } else {
                    Text(product.displayPrice)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(ZenBuyTheme.green)
                        .clipShape(Capsule())
                }
            }
            .padding(14)
            .background(ZenBuyTheme.card)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(ZenBuyTheme.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(store.purchasingProductID != nil)
    }

    private var linkSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepLabel(store.hasPurchase ? 1 : 2, "Link it to your Apple ID")

            Text("Sign in with Apple here, then sign in with the same Apple ID on zenbuy.info.")
                .font(.footnote)
                .foregroundStyle(ZenBuyTheme.muted)

            if unlock.isWorking {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = []
                } onCompletion: { result in
                    handleSignIn(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 46)
                .disabled(!store.hasPurchase)
                .opacity(store.hasPurchase ? 1 : 0.4)
            }

            if !store.hasPurchase {
                Text("Available once you own ZenBuy.")
                    .font(.caption)
                    .foregroundStyle(ZenBuyTheme.muted)
            }
        }
    }

    private var unlockedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(ZenBuyTheme.greenPositive)
                Text("Purchase linked")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ZenBuyTheme.ink)
            }

            Text("Open zenbuy.info in your browser, choose \"Unlock this site\" and sign in with the same Apple ID. The website unlocks straight away.")
                .font(.footnote)
                .foregroundStyle(ZenBuyTheme.muted)

            Button("Sign this device out") {
                unlock.clearSession()
            }
            .font(.footnote)
            .tint(ZenBuyTheme.sageDark)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZenBuyTheme.greenLight)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var restoreButton: some View {
        Button {
            Task { await store.restore() }
        } label: {
            if store.isRestoring {
                ProgressView()
            } else {
                Text("Restore purchases")
            }
        }
        .font(.footnote.weight(.semibold))
        .tint(ZenBuyTheme.sageDark)
        .disabled(store.isRestoring)
    }

    private var finePrint: some View {
        Text("Payment is charged to your Apple ID. The monthly plan renews until cancelled in Settings → your name → Subscriptions. Refunds and receipts are handled by Apple.")
            .font(.caption2)
            .foregroundStyle(ZenBuyTheme.muted)
    }

    private func stepLabel(_ number: Int, _ title: String) -> some View {
        HStack(spacing: 8) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(ZenBuyTheme.greenDark)
                .frame(width: 20, height: 20)
                .background(ZenBuyTheme.greenLight)
                .clipShape(Circle())
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)
        }
    }

    private func handleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case let .success(authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential
            else {
                unlock.errorMessage = "That sign-in didn't return an Apple ID. Try again."
                return
            }
            Task { await unlock.link(credential: credential, store: store) }

        case let .failure(error):
            // Cancelling is a normal choice, not an error worth reporting.
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            unlock.errorMessage = "Sign in with Apple didn't complete. Try again."
        }
    }
}
