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

/// Where the TV Email PDF panel parks the remote. Pure so `ZenBuyTests` can
/// lock the picker-loop fix without a TV test target. iOS does not present
/// this panel (it uses the share sheet).
enum TVEmailPanelPolicy {
    enum Landing: Equatable {
        case field
        case send
    }

    /// Opening Email PDF: Send if a draft or remembered address is already
    /// there, otherwise the field so the viewer can type.
    static func landingAfterOpen(draft: String, stored: String) -> Landing {
        let seed = ReportEmailAddress.normalize(draft)
        let fallback = ReportEmailAddress.normalize(stored)
        return (seed.isEmpty ? fallback : seed).isEmpty ? .field : .send
    }

    /// Keyboard / system sheet dismissed: Send when the field has text so
    /// focus does not bounce back onto Email PDF and re-present the sheet.
    static func landingAfterFieldEnded(draft: String) -> Landing {
        ReportEmailAddress.normalize(draft).isEmpty ? .field : .send
    }

    /// `becomeFirstResponder` only when SwiftUI focus is on the field and we
    /// are not parking on Send. Re-entering first responder is what re-showed
    /// Previously-Used Emails after an address was chosen.
    static func shouldBecomeFirstResponder(fieldFocused: Bool, suppressResponder: Bool) -> Bool {
        fieldFocused && !suppressResponder
    }
}
