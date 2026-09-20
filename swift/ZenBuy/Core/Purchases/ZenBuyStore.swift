import Foundation
import StoreKit
import os

/// StoreKit 2 for ZenBuy's paid App Store download and two optional IAPs.
///
/// Owning the paid app, or either IAP, unlocks the website as well, so what
/// the rest of the app needs from this type is small: what is on sale,
/// whether the person already owns something, and the signed transactions
/// that prove it. Those signed transactions are what `POST /api/unlock-web`
/// verifies — the app never asserts an entitlement on its own say-so.
@Observable
@MainActor
final class ZenBuyStore {
    static let lifetimeProductID = "info.zenbuy.app.lifetime"
    static let monthlyProductID = "info.zenbuy.app.pro.monthly"

    private static let log = Logger(subsystem: "info.zenbuy.app", category: "store")

    private(set) var products: [Product] = []
    private(set) var ownedProductIDs: Set<String> = []
    /// Paid App Store download (`AppTransaction`), independent of the two IAPs.
    /// False on TestFlight — a sandbox download is not a sale.
    private(set) var ownsAppDownload = false
    /// Sandbox / Xcode AppTransaction. Production App Store stays false.
    private(set) var isTestFlight = false
    /// Apple-signed AppTransaction JWS when `isTestFlight`; sent to the Worker.
    private(set) var testFlightTransactionJWS: String?
    private(set) var isLoadingProducts = false
    /// Product id currently being bought, so only that row shows a spinner.
    private(set) var purchasingProductID: String?
    private(set) var isRestoring = false
    var errorMessage: String?

    var hasPurchase: Bool {
        UnlockLinkPolicy.hasPurchase(
            ownedProductIDs: ownedProductIDs,
            ownsAppDownload: ownsAppDownload
        )
    }

    init() {
        // Renewals, refunds, Ask to Buy approvals and purchases made on
        // another device all arrive here rather than through `purchase`.
        Task { [weak self] in
            for await update in Transaction.updates {
                if case let .verified(transaction) = update {
                    await transaction.finish()
                }
                await self?.refreshEntitlements()
            }
        }
    }

    func loadIfNeeded() async {
        guard products.isEmpty, !isLoadingProducts else { return }
        await load()
    }

    func load() async {
        isLoadingProducts = true
        defer { isLoadingProducts = false }

        // Entitlements (including TestFlight) first — IAP prices must not
        // delay complimentary sandbox detection.
        await refreshEntitlements()

        do {
            let loaded = try await Product.products(
                for: [Self.monthlyProductID, Self.lifetimeProductID]
            )
            // Cheapest entry point first; lifetime reads as the upgrade.
            products = loaded.sorted { $0.price < $1.price }
        } catch {
            Self.log.error("product load failed: \(error.localizedDescription, privacy: .public)")
            errorMessage = "The App Store didn't answer. Check your connection and try again."
        }
    }

    func refreshEntitlements() async {
        var owned: Set<String> = []
        for await entitlement in Transaction.currentEntitlements {
            guard case let .verified(transaction) = entitlement else { continue }
            if transaction.revocationDate != nil { continue }
            if let expires = transaction.expirationDate, expires <= Date() { continue }
            owned.insert(transaction.productID)
        }
        ownedProductIDs = owned
        let app = await loadAppTransaction()
        isTestFlight =
            UnlockLinkPolicy.isTestFlightEnvironment(app.environment)
            || Self.sandboxReceiptPresent
        ownsAppDownload = app.jws != nil && !isTestFlight
        testFlightTransactionJWS = isTestFlight ? app.jws : nil
    }

    /// - Returns: `true` when the purchase completed and is now owned.
    func purchase(_ product: Product) async -> Bool {
        guard purchasingProductID == nil else { return false }
        purchasingProductID = product.id
        errorMessage = nil
        defer { purchasingProductID = nil }

        do {
            switch try await product.purchase() {
            case let .success(verification):
                guard case let .verified(transaction) = verification else {
                    errorMessage = "That purchase couldn't be verified with Apple. Nothing was charged twice — try again."
                    return false
                }
                await transaction.finish()
                await refreshEntitlements()
                return true

            case .pending:
                // Ask to Buy and similar: the transaction listener finishes it.
                errorMessage = "Waiting on approval. This unlocks by itself once the purchase is approved."
                return false

            case .userCancelled:
                return false

            @unknown default:
                return false
            }
        } catch {
            Self.log.error("purchase failed: \(error.localizedDescription, privacy: .public)")
            errorMessage = "The purchase didn't go through. Nothing was charged — try again."
            return false
        }
    }

    /// - Returns: `true` when something was restored.
    func restore() async -> Bool {
        guard !isRestoring else { return false }
        isRestoring = true
        errorMessage = nil
        defer { isRestoring = false }

        do {
            try await AppStore.sync()
        } catch {
            // A cancelled Apple ID prompt lands here and is not worth an alert.
            Self.log.notice("restore sync ended: \(error.localizedDescription, privacy: .public)")
        }

        await refreshEntitlements()
        // AppTransaction can lag one beat after `AppStore.sync()` on tvOS.
        if !hasPurchase {
            try? await Task.sleep(for: .milliseconds(250))
            await refreshEntitlements()
        }
        if !hasPurchase {
            errorMessage = UnlockLinkPolicy.restoreEmptyMessage(
                signInAvailable: UnlockLinkPolicy.signInAvailable
            )
        }
        return UnlockLinkPolicy.shouldRedeemAfterRestore(hasPurchase: hasPurchase)
    }

    /// Apple-signed transactions for everything currently owned, exactly as
    /// the Worker wants them — it re-verifies each signature itself.
    ///
    /// The paid App Store download is `AppTransaction`, not an IAP, so it
    /// never appears in `Transaction.currentEntitlements`. Both go in the
    /// same `transactions` array `POST /api/unlock-app` / `unlock-web` accept.
    func entitlementJWS() async -> [String] {
        var iap: [String] = []
        for await entitlement in Transaction.currentEntitlements {
            guard case let .verified(transaction) = entitlement else { continue }
            if transaction.revocationDate != nil { continue }
            iap.append(entitlement.jwsRepresentation)
        }
        return UnlockLinkPolicy.entitlementJWS(
            appTransaction: await loadAppTransaction().jws,
            iapTransactions: iap
        )
    }

    private struct LoadedAppTransaction {
        var jws: String?
        var environment: String?
    }

    /// `sandboxReceipt` is the pre-StoreKit-2 TestFlight signal.
    private static var sandboxReceiptPresent: Bool {
        Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    }

    /// StoreKit 2 signed proof of the app download, plus its Apple environment.
    private func loadAppTransaction() async -> LoadedAppTransaction {
        do {
            let result = try await AppTransaction.shared
            guard case let .verified(transaction) = result else {
                return LoadedAppTransaction()
            }
            return LoadedAppTransaction(
                jws: result.jwsRepresentation,
                environment: Self.environmentName(transaction.environment)
            )
        } catch {
            Self.log.notice("app transaction unavailable: \(error.localizedDescription, privacy: .public)")
            return LoadedAppTransaction()
        }
    }

    private static func environmentName(_ environment: AppStore.Environment) -> String {
        // Equality, not a switch: Xcode 26's AppStore.Environment is not an
        // exhaustive enum (archive failed: "switch must be exhaustive").
        if environment == .sandbox { return "Sandbox" }
        if environment == .xcode { return "Xcode" }
        if environment == .production { return "Production" }
        return String(describing: environment)
    }
}
