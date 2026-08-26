import Foundation

enum InvestmentDirectiveId: String, Codable, CaseIterable, Sendable {
    case aggressive_growth
    case growth
    case growth_income
    case value_income
    case conservative
}

struct InvestmentDirectiveInfo: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let headline: String
    let bestIf: String
    let plainEnglish: String
    let horizon: String
    let risk: String
    let incomeFocus: String
    let exampleGoal: String
    let detailProfile: String?
}

struct ClientConfigResponse: Codable, Sendable {
    let turnstileSiteKey: String?
    let investmentDirectives: [InvestmentDirectiveInfo]?
    let defaultDirectiveId: String?
}

extension InvestmentDirectiveInfo {
    static let bundled: [InvestmentDirectiveInfo] = [
        InvestmentDirectiveInfo(
            id: "aggressive_growth",
            label: "Aggressive Growth",
            headline: "Big winners, long wait",
            bestIf: "15–20+ years out; OK with big drops",
            plainEnglish: "Fast-growers and moonshots. Volatile.",
            horizon: "15–20+ yrs",
            risk: "High",
            incomeFocus: "Low",
            exampleGoal: "$10k → $50k+ possible; −40% years happen",
            detailProfile: "Moonshots and fast-growers for 15–20+ years. High volatility — big drawdowns are normal. Income is usually reinvested."
        ),
        InvestmentDirectiveInfo(
            id: "growth",
            label: "Growth",
            headline: "Strong returns, less wild",
            bestIf: "10–15 years; quality growth names",
            plainEnglish: "Proven growers beating the market.",
            horizon: "10–15 yrs",
            risk: "Mod–high",
            incomeFocus: "Low",
            exampleGoal: "$10k → ~$25k–40k in 10–15 yrs",
            detailProfile: "Quality growers over 10–15 years. Moderate-high risk — market-beating focus, low dividend income."
        ),
        InvestmentDirectiveInfo(
            id: "growth_income",
            label: "Growth & Income",
            headline: "Grow plus payouts",
            bestIf: "7–12 years; want dividends too",
            plainEnglish: "Growing companies that also pay you.",
            horizon: "7–12 yrs",
            risk: "Moderate",
            incomeFocus: "Moderate",
            exampleGoal: "$10k → ~$18k–28k + yearly cash",
            detailProfile: "Growing businesses that also pay dividends or buy back shares over 7–12 years. Moderate risk."
        ),
        InvestmentDirectiveInfo(
            id: "value_income",
            label: "Value / Income",
            headline: "Fair price, steady income",
            bestIf: "5–10 years; dividends matter",
            plainEnglish: "Value names with cash flow and yield.",
            horizon: "5–10 yrs",
            risk: "Mod–low",
            incomeFocus: "High",
            exampleGoal: "$10k → ~$14k–20k + dividends",
            detailProfile: "Fair price, steady cash flow, and dividends over 5–10 years. Moderate-low risk."
        ),
        InvestmentDirectiveInfo(
            id: "conservative",
            label: "Conservative",
            headline: "Stability first",
            bestIf: "3–7 years; smaller drawdowns",
            plainEnglish: "Solid balance sheets, modest returns.",
            horizon: "3–7 yrs",
            risk: "Lower",
            incomeFocus: "Steady",
            exampleGoal: "$10k → ~$11.5k–14k, milder swings",
            detailProfile: "Stable balance sheets and modest returns over 3–7 years. Lower risk — sleep-well priority."
        ),
    ]
}
