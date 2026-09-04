import Foundation
import StoreKit
import os

/// StoreKit 2 for ZenBuy's two in-app purchases.
///
/// Owning either one unlocks the website as well as the app, so what the rest
/// of the app needs from this type is small: what is on sale, whether the
/// person already owns something, and the signed transactions that prove it.
/// Those signed transactions are what `POST /api/unlock-web` verifies — the
/// app never asserts an entitlement on its own say-so.
@Observable
@MainActor
final class ZenBuyStore {
    static let lifetimeProductID = "info.zenbuy.app.lifetime"
    static let monthlyProductID = "info.zenbuy.app.pro.monthly"

    private static let log = Logger(subsystem: "info.zenbuy.app", category: "store")

    private(set) var products: [Product] = []
    private(set) var ownedProductIDs: Set<String> = []
    private(set) var isLoadingProducts = false
    /// Product id currently being bought, so only that row shows a spinner.
    private(set) var purchasingProductID: String?
    private(set) var isRestoring = false
    var errorMessage: String?

    var hasPurchase: Bool { !ownedProductIDs.isEmpty }

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

        await refreshEntitlements()
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
        if !hasPurchase {
            errorMessage = "No ZenBuy purchase found on this Apple ID. If you bought with a different one, sign in to that Apple ID in Settings first."
        }
        return hasPurchase
    }

    /// Apple-signed transactions for everything currently owned, exactly as
    /// the Worker wants them — it re-verifies each signature itself.
    func entitlementJWS() async -> [String] {
        var tokens: [String] = []
        for await entitlement in Transaction.currentEntitlements {
            guard case let .verified(transaction) = entitlement else { continue }
            if transaction.revocationDate != nil { continue }
            tokens.append(entitlement.jwsRepresentation)
        }
        return tokens
    }
}
