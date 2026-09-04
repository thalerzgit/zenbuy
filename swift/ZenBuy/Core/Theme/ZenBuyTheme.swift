import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum ZenBuyTheme {
    // Fidelity-inspired brokerage greens
    static let green = Color(red: 0.24, green: 0.53, blue: 0.18)
    static let greenDark = Color(red: 0.20, green: 0.43, blue: 0.15)
    static let greenLight = Color(red: 0.91, green: 0.96, blue: 0.90)
    static let greenPositive = Color(red: 0.0, green: 0.51, blue: 0.28)

    // Oracle foresight accent
    static let insightGold = Color(red: 0.79, green: 0.63, blue: 0.15)

    static let ink = Color(red: 0.10, green: 0.10, blue: 0.10)
    static let muted = Color(red: 0.36, green: 0.36, blue: 0.36)
    static let background = Color.white
    static let surface = Color(red: 0.96, green: 0.96, blue: 0.96)
    static let card = Color.white
    static let border = Color(red: 0.88, green: 0.88, blue: 0.88)
    static let bull = greenPositive
    static let bear = Color(red: 0.61, green: 0.13, blue: 0.15)

    // Legacy aliases used across features
    static let sage = green
    static let sageLight = greenLight
    static let sageDark = greenDark
}

#if canImport(UIKit)
extension ZenBuyTheme {
    /// UIKit mirrors of the brand palette for Core Graphics drawing (PDF export).
    /// Hex values track the `src/client/styles.css` tokens so shared exports
    /// look like the website print, not a generic black-and-white document.
    /// Computed (not stored) so the palette stays usable off the main actor.
    enum UIKitPalette {
        static var ink: UIColor { hex(0x1A_1A_1A) }
        static var muted: UIColor { hex(0x5C_5C_5C) }
        static var border: UIColor { hex(0xE0_E0_E0) }
        static var green: UIColor { hex(0x3D_86_2D) }
        static var greenDark: UIColor { hex(0x2F_6B_22) }
        static var greenLight: UIColor { hex(0xE8_F4_E5) }
        static var greenPositive: UIColor { hex(0x00_82_48) }
        static var badgeBuy: UIColor { hex(0xD8_F3_DC) }
        static var badgeSell: UIColor { hex(0xFD_E8_E8) }
        static var badgeHold: UIColor { hex(0xEE_F0_F2) }
        static var bear: UIColor { hex(0x9B_22_26) }
        static var neutral: UIColor { hex(0x6C_75_7D) }

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
