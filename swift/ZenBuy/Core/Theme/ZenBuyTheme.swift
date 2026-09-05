import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum ZenBuyTheme {
    // Keep hex values lockstep with `src/client/styles.css` `:root` tokens.
    static let green = Color(hex: 0x247A36)
    static let greenDark = Color(hex: 0x1A5C28)
    static let greenLight = Color(hex: 0xE4F3E8)
    static let greenPositive = Color(hex: 0x0A7F44)

    static let insightGold = Color(hex: 0xD4B43A)
    static let insightGoldBright = Color(hex: 0xE6C85C)

    static let forest = Color(hex: 0x03140B)
    static let forestMid = Color(hex: 0x082016)
    static let forestHi = Color(hex: 0x061910)
    static let forestLo = Color(hex: 0x020C08)

    static let ink = Color(hex: 0x16181A)
    static let muted = Color(hex: 0x5A6168)
    static let background = Color(hex: 0xF3F5F3)
    static let surface = Color(hex: 0xEEF1EF)
    static let card = Color.white
    static let border = Color(hex: 0xD5DBD6)
    static let bull = greenPositive
    static let bear = Color(hex: 0xA61B22)
    static let badgeBuy = Color(hex: 0xE3F6E8)
    static let badgeSell = Color(hex: 0xFDE4E4)
    static let badgeHold = Color(hex: 0xECEFF2)
    static let neutral = Color(hex: 0x5F6B73)

    static var forestHeader: LinearGradient {
        LinearGradient(
            colors: [forestHi, forest, forestLo],
            startPoint: UnitPoint(x: 0.12, y: 0),
            endPoint: UnitPoint(x: 0.88, y: 1)
        )
    }

    // Legacy aliases used across features
    static let sage = green
    static let sageLight = greenLight
    static let sageDark = greenDark
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

#if canImport(UIKit)
extension ZenBuyTheme {
    /// UIKit mirrors of the brand palette for Core Graphics drawing (PDF export).
    /// Hex values track the `src/client/styles.css` tokens so shared exports
    /// look like the website print, not a generic black-and-white document.
    /// Computed (not stored) so the palette stays usable off the main actor.
    enum UIKitPalette {
        static var ink: UIColor { hex(0x16_18_1A) }
        static var muted: UIColor { hex(0x5A_61_68) }
        static var border: UIColor { hex(0xD5_DB_D6) }
        static var green: UIColor { hex(0x24_7A_36) }
        static var greenDark: UIColor { hex(0x1A_5C_28) }
        static var greenLight: UIColor { hex(0xE4_F3_E8) }
        static var greenPositive: UIColor { hex(0x0A_7F_44) }
        static var badgeBuy: UIColor { hex(0xE3_F6_E8) }
        static var badgeSell: UIColor { hex(0xFD_E4_E4) }
        static var badgeHold: UIColor { hex(0xEC_EF_F2) }
        static var bear: UIColor { hex(0xA6_1B_22) }
        static var neutral: UIColor { hex(0x5F_6B_73) }

        private static func hex(_ value: UInt32) -> UIColor {
            UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        }
    }
}
#endif
