import Foundation

enum ZenBuyEnvironment {
    /// Resolved from `ZENBUY_API_BASE_URL` in xcconfig → Info.plist, defaulting to production.
    static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "ZENBUY_API_BASE_URL") as? String,
           let url = URL(string: raw), !raw.isEmpty {
            return url
        }
        return URL(string: "https://zenbuy.info")!
    }

    static var isProduction: Bool {
        apiBaseURL.host()?.contains("zenbuy.info") == true
    }
}
