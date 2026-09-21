import Foundation

/// Shared folding / validation for `POST /api/report/email`.
///
/// Same rules as Worker `normalizeEmail` / `isNormalEmail`: NFKC, strip
/// zero-width / NBSP, map leftover fullwidth `@` / ideographic dots, then
/// require `local@domain.tld` with no spaces. Lives in Core so ZenBuyTests
/// can lock `gary.morgenthaler@iCloud.com` without a TV test target or UI.
enum ReportEmailAddress {
    static let invalidFormatMessage = "Enter a full email address, like you@example.com."
    static let emptyFieldMessage =
        "The email field was empty when Send ran — click the field, finish the address, press Menu to close the keyboard, then Send PDF."

    /// Same folding as Worker `normalizeEmail`.
    static func normalize(_ value: String) -> String {
        let nfkc = value.precomposedStringWithCompatibilityMapping
        var scalars = String.UnicodeScalarView()
        scalars.reserveCapacity(nfkc.unicodeScalars.count)
        for scalar in nfkc.unicodeScalars {
            switch scalar.value {
            case 0xFF20:
                scalars.append(Unicode.Scalar(UInt32(0x40))!)
            case 0x3002, 0xFF0E, 0xFF61:
                scalars.append(Unicode.Scalar(UInt32(0x2E))!)
            case 0x00A0, 0x202F, 0x2007, 0x00AD:
                scalars.append(Unicode.Scalar(UInt32(0x20))!)
            case 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF:
                continue
            default:
                scalars.append(scalar)
            }
        }
        return String(String.UnicodeScalarView(scalars))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Worker `isNormalEmail`: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` after normalize.
    static func looksLikeAddress(_ value: String) -> Bool {
        let email = normalize(value)
        guard !email.isEmpty, email.count <= 254 else { return false }
        guard let at = email.firstIndex(of: "@"), at != email.startIndex else { return false }
        let local = email[..<at]
        let domain = email[email.index(after: at)...]
        guard !domain.isEmpty, !domain.contains("@") else { return false }
        guard !local.contains(where: \.isWhitespace),
              !domain.contains(where: \.isWhitespace)
        else { return false }
        guard let dot = domain.firstIndex(of: ".") else { return false }
        return dot != domain.startIndex && domain.index(after: dot) != domain.endIndex
    }

    /// Keys the Worker `parseReportEmailRequest` reads — `reportId` and `email`.
    static func requestBody(reportId: String, email: String) throws -> Data {
        try JSONEncoder().encode(["reportId": reportId, "email": email])
    }
}
