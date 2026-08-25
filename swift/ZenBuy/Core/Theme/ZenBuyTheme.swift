import SwiftUI

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
