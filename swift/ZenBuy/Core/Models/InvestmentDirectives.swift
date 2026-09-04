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

/// Selectable profit window — an overlay on the investment goal.
/// Mirrors `ProfitHorizonOption` in `src/lib/profit-horizons.ts`.
struct ProfitHorizonOption: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let years: Int
    let label: String
}

struct ClientConfigResponse: Codable, Sendable {
    let turnstileSiteKey: String?
    let investmentDirectives: [InvestmentDirectiveInfo]?
    let defaultDirectiveId: String?
    let profitHorizonOptions: [ProfitHorizonOption]?
}

extension InvestmentDirectiveInfo {
    /// Mirrors `DEFAULT_DIRECTIVE_ID`; `/api/config` may override it.
    static let defaultDirectiveId = "growth"

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

    /// Matches `promptHorizonYears` on the web directives (API overlay).
    static func defaultProfitHorizonYears(for directiveId: String) -> Int {
        switch directiveId {
        case "aggressive_growth": return 18
        case "growth": return 12
        case "growth_income": return 10
        case "value_income": return 7
        case "conservative": return 5
        default: return 12
        }
    }
}

extension ProfitHorizonOption {
    /// Mirrors `PROFIT_HORIZON_OPTIONS`; the Worker also serves these on
    /// `/api/config` so the list can move without an app release.
    static let bundled: [ProfitHorizonOption] = [
        ProfitHorizonOption(id: "2", years: 2, label: "0–3 yrs"),
        ProfitHorizonOption(id: "3", years: 3, label: "3–5 yrs"),
        ProfitHorizonOption(id: "7", years: 7, label: "5–10 yrs"),
        ProfitHorizonOption(id: "12", years: 12, label: "10–15 yrs"),
        ProfitHorizonOption(id: "18", years: 18, label: "15–20+ yrs"),
    ]

    /// Some goal defaults (Growth & Income 10, Conservative 5) sit between
    /// pills, so highlight the nearest window rather than nothing.
    static func closest(to years: Int, in options: [ProfitHorizonOption]) -> ProfitHorizonOption? {
        options.min { abs($0.years - years) < abs($1.years - years) }
    }

    private static let storageKey = "zenbuy:profit-horizon:v1"

    /// Mirrors `loadStoredProfitHorizon`: a stored pick wins, else the goal default.
    static func loadStoredYears(for directiveId: String) -> Int {
        let stored = UserDefaults.standard.integer(forKey: storageKey)
        if (2...25).contains(stored) { return stored }
        return InvestmentDirectiveInfo.defaultProfitHorizonYears(for: directiveId)
    }

    static func saveStoredYears(_ years: Int) {
        UserDefaults.standard.set(years, forKey: storageKey)
    }
}
