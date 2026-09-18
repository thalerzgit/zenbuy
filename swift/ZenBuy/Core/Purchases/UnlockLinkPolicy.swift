import Foundation

/// Pure rules for linking an Apple ID / App Store purchase on a native client.
///
/// StoreKit restore can only see IAP entitlements and the paid App Store
/// download (`AppTransaction`). Complimentary `APPLE_ID_WHITELIST` access is
/// an Apple ID fact and needs Sign in with Apple → `POST /api/unlock-web`.
/// Keeping the copy and the focus order here means the TV panel and the
/// tests describe the same two paths.
enum UnlockLinkPolicy {
    enum LeadControl: Equatable {
        case signIn
        case product(String)
        case restore
    }

    /// Dist tvOS compiles the Sign in with Apple control only when the profile
    /// carries the capability (`ZENBUY_SIWA`). iPhone always draws it.
    static var signInAvailable: Bool {
        #if ZENBUY_SIWA
        true
        #elseif os(iOS)
        true
        #else
        false
        #endif
    }

    /// IAP current entitlements or a verified paid-app `AppTransaction`.
    static func hasPurchase(ownedProductIDs: Set<String>, ownsAppDownload: Bool) -> Bool {
        !ownedProductIDs.isEmpty || ownsAppDownload
    }

    /// StoreKit 2 JWS in the order `POST /api/unlock-app` already accepts:
    /// paid-app download first, then each live Pro IAP.
    static func entitlementJWS(appTransaction: String?, iapTransactions: [String]) -> [String] {
        var tokens: [String] = []
        if let appTransaction, !appTransaction.isEmpty {
            tokens.append(appTransaction)
        }
        tokens.append(contentsOf: iapTransactions.filter { !$0.isEmpty })
        return tokens
    }

    /// Restore found something the Worker can redeem without a sign-in.
    static func shouldRedeemAfterRestore(hasPurchase: Bool) -> Bool {
        hasPurchase
    }

    /// Complimentary / already-linked-on-iPhone users go to Sign in with Apple.
    /// Paid buyers land on the cheapest product, else Restore.
    static func leadControl(signInAvailable: Bool, firstProductID: String?) -> LeadControl {
        if signInAvailable { return .signIn }
        if let firstProductID, !firstProductID.isEmpty { return .product(firstProductID) }
        return .restore
    }

    static func restoreEmptyMessage(signInAvailable: Bool) -> String {
        if signInAvailable {
            return """
            No App Store purchase on this Apple ID. Complimentary access, or already unlocked on iPhone / zenbuy.info? Choose Sign in with Apple. To buy here, use Monthly or Buy once — they charge the Apple ID signed into this Apple TV. Bought with a different Apple ID? Sign in to that one in Settings → Users & Accounts first.
            """
        }
        return """
        No App Store purchase on this Apple ID. Use Monthly or Buy once on this Apple TV, or sign in to the Apple ID that bought ZenBuy in Settings → Users & Accounts first.
        """
    }
}
