import AuthenticationServices
import Foundation
import os

/// Links an App Store purchase to an Apple ID so zenbuy.info recognizes it.
///
/// This is step one of the two-step unlock: the app sends Apple's identity
/// token together with its signed transactions to `POST /api/unlock-web`, and
/// the Worker records an entitlement against that Apple subject. Signing in on
/// the website with the same Apple ID then finds it.
///
/// The session token the Worker returns is kept in the Keychain and sent as a
/// bearer token, so the app's own requests get the unlocked daily allowance
/// too rather than sharing the free per-IP limit.
@Observable
@MainActor
final class WebUnlockService {
    enum Status: Equatable {
        case unknown
        case locked
        case unlocked
    }

    private static let log = Logger(subsystem: "info.zenbuy.app", category: "unlock")
    private static let keychainAccount = "web-unlock-session"

    private(set) var status: Status = .unknown
    private(set) var isWorking = false
    var errorMessage: String?

    private(set) var sessionToken: String? {
        didSet { status = sessionToken == nil ? .locked : .unlocked }
    }

    init() {
        sessionToken = Keychain.read(Self.keychainAccount)
        status = sessionToken == nil ? .locked : .unknown
    }

    /// Confirm with the Worker that the stored token still unlocks anything.
    func refresh() async {
        guard let token = sessionToken else {
            status = .locked
            return
        }

        var request = URLRequest(url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/me"))
        request.setValue("ios", forHTTPHeaderField: "X-ZenBuy-Client")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let me = try JSONDecoder().decode(MeResponse.self, from: data)
            if me.unlocked {
                status = .unlocked
            } else {
                // The entitlement lapsed or the session expired server-side.
                clearSession()
            }
        } catch {
            // Offline is not the same as locked; leave the last known state.
            Self.log.notice("unlock refresh failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Called with the credential from `SignInWithAppleButton`.
    func link(credential: ASAuthorizationAppleIDCredential, store: ZenBuyStore) async {
        guard let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            errorMessage = "Apple didn't return a sign-in token. Try again."
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        let transactions = await store.entitlementJWS()
        guard !transactions.isEmpty else {
            errorMessage = "No active ZenBuy purchase on this device yet. Buy or restore first, then link."
            return
        }

        var request = URLRequest(
            url: ZenBuyEnvironment.apiBaseURL.appending(path: "api/unlock-web")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("ios", forHTTPHeaderField: "X-ZenBuy-Client")
        request.httpBody = try? JSONEncoder().encode(
            UnlockRequest(identityToken: identityToken, transactions: transactions)
        )

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                errorMessage = Self.message(forStatus: status)
                return
            }

            let unlock = try JSONDecoder().decode(UnlockResponse.self, from: data)
            Keychain.write(unlock.token, account: Self.keychainAccount)
            sessionToken = unlock.token
        } catch {
            Self.log.error("unlock failed: \(error.localizedDescription, privacy: .public)")
            errorMessage = "Couldn't reach ZenBuy to link your purchase. Check your connection and try again."
        }
    }

    /// Sign this device out. The App Store purchase is untouched.
    func clearSession() {
        Keychain.delete(Self.keychainAccount)
        sessionToken = nil
    }

    private static func message(forStatus status: Int) -> String {
        switch status {
        case 401:
            return "Apple couldn't verify that sign-in. Try again."
        case 402:
            return "We couldn't find an active ZenBuy purchase on this Apple ID. Try Restore purchases first."
        default:
            return "Linking failed (HTTP \(status)). Try again in a moment."
        }
    }

    private struct UnlockRequest: Encodable {
        let identityToken: String
        let transactions: [String]
    }

    private struct UnlockResponse: Decodable {
        let token: String
    }

    private struct MeResponse: Decodable {
        let signedIn: Bool
        let unlocked: Bool
    }
}

/// Minimal Keychain access for the one bearer token this app holds.
private enum Keychain {
    private static let service = "info.zenbuy.app.unlock"

    private static func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func read(_ account: String) -> String? {
        var request = query(account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String, account: String) {
        delete(account)
        var request = query(account)
        request[kSecValueData as String] = Data(value.utf8)
        // The token is only needed while someone is using the app.
        request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(request as CFDictionary, nil)
    }

    static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
