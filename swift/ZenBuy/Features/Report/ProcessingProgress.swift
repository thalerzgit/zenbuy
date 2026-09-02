import Foundation

struct ProcessingQuote: Hashable, Sendable {
    let text: String
    let author: String
}

enum ProcessingPhase: String, Sendable {
    case preparing
    case fundamentals
    case analysis
    case drafting
    case finalizing
    case complete
    case simplifying

    var copy: String {
        switch self {
        case .preparing: return "Preparing your research request…"
        case .fundamentals: return "Pulling live fundamentals & peer data…"
        case .analysis: return "Running valuation and thesis analysis…"
        case .drafting: return "Drafting your research report…"
        case .finalizing: return "Polishing scorecard & summary…"
        case .complete: return "Report ready"
        case .simplifying: return "Rewriting in plain English…"
        }
    }
}

/// Web-parity timing / copy from `src/client/processing-progress.ts`.
enum ProcessingProgressLogic {
    static let quoteRotation: TimeInterval = 5
    static let tickInterval: TimeInterval = 0.4

    static func estimateProcessingMs(symbolCount: Int, mode: ReportMode) -> Int {
        if mode == .comparative { return 105_000 + symbolCount * 20_000 }
        if symbolCount == 1 { return 85_000 }
        return 75_000 + symbolCount * 40_000
    }

    static func formatEta(remainingMs: Int, percent: Double) -> String {
        if percent >= 100 { return "Complete" }
        if remainingMs <= 5_000 { return "Almost there…" }
        let sec = Int(ceil(Double(remainingMs) / 1000.0))
        if sec < 60 { return "About \(sec)s remaining" }
        let minutes = Int(ceil(Double(sec) / 60.0))
        return minutes == 1 ? "About 1 min remaining" : "About \(minutes) min remaining"
    }

    /// Ported from `PROCESSING_QUOTES` — includes David Morgenthaler.
    static let quotes: [ProcessingQuote] = [
        .init(text: "In the short run, the market is a voting machine but in the long run, it is a weighing machine.", author: "Benjamin Graham"),
        .init(text: "The intelligent investor is a realist who sells to optimists and buys from pessimists.", author: "Benjamin Graham"),
        .init(text: "The essence of investment management is the management of risks, not the management of returns.", author: "Benjamin Graham"),
        .init(text: "Price is what you pay. Value is what you get.", author: "Warren Buffett"),
        .init(text: "Risk comes from not knowing what you're doing.", author: "Warren Buffett"),
        .init(text: "It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.", author: "Warren Buffett"),
        .init(text: "Be fearful when others are greedy and greedy when others are fearful.", author: "Warren Buffett"),
        .init(text: "Our favorite holding period is forever.", author: "Warren Buffett"),
        .init(text: "The big money is not in the buying and selling, but in the waiting.", author: "Charlie Munger"),
        .init(text: "A great business at a fair price is superior to a fair business at a great price.", author: "Charlie Munger"),
        .init(text: "Invert, always invert: turn a situation or problem upside down. Look at it backward.", author: "Charlie Munger"),
        .init(text: "It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent.", author: "Charlie Munger"),
        .init(text: "Know what you own, and know why you own it.", author: "Peter Lynch"),
        .init(text: "Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.", author: "Peter Lynch"),
        .init(text: "The person that turns over the most rocks wins the game. And that's always been my philosophy.", author: "Peter Lynch"),
        .init(text: "In this business, if you're good, you're right six times out of ten. You're never going to be right nine times out of ten.", author: "Peter Lynch"),
        .init(text: "You can't predict. You can prepare.", author: "Howard Marks"),
        .init(text: "The most dangerous thing is to buy something at the peak of its popularity.", author: "Howard Marks"),
        .init(text: "When everyone believes something is riskless, the risk is at its greatest.", author: "Howard Marks"),
        .init(text: "Experience is what you got when you didn't get what you wanted.", author: "Howard Marks"),
        .init(text: "I would not want to be young without an education. I would not want to be old without money.", author: "David Morgenthaler"),
        .init(text: "Money doesn't matter much in life — unless you don't have it.", author: "David Morgenthaler"),
        .init(text: "Money can't buy happiness, but it can sure make you comfortable while looking for it.", author: "David Morgenthaler"),
        .init(text: "Risk is real. If you take enough of it, you are going to get burned.", author: "David Morgenthaler"),
        .init(text: "I am basically lazy and like to make money while I sleep. That's why I invest in stocks.", author: "David Morgenthaler"),
        .init(text: "They say you should buy stocks when there is blood in the street — but first check and be sure it's not YOUR blood!", author: "David Morgenthaler"),
        .init(text: "Not all my investments are winners. Lord knows, I've had my share of losers. That's why they put erasers on pencils.", author: "David Morgenthaler"),
        .init(text: "Focus on compounding your money using the “Rule of 72.” Multiply the years by the percentage appreciation per year. When the product is 72, you have doubled your money.", author: "David Morgenthaler"),
        .init(text: "Investing, like horse-racing, is about the horse, the rider, and the race. The horse is the technology; the rider is the CEO; the race is the market. Don't compete in the county fair — compete in the Kentucky Derby, where the payoff is enormous.", author: "David Morgenthaler"),
        .init(text: "I know how to make money, and I know how to have fun. Whenever I try to combine the two, I don't make money, and I don't have fun.", author: "David Morgenthaler"),
        .init(text: "The wise investor can afford to buy only when the company is going through a temporary difficulty.", author: "Philip Fisher"),
        .init(text: "I don't want a lot of good investments; I want a few outstanding ones.", author: "Philip Fisher"),
        .init(text: "If the job has been correctly done when a common stock is purchased, the time to sell it is almost never.", author: "Philip Fisher"),
        .init(text: "The greatest investment reward comes to those who find the occasional company that can grow in sales and profits far more rapidly than industry as a whole.", author: "Philip Fisher"),
        .init(text: "Bull markets are born on pessimism, grow on skepticism, mature on optimism and die on euphoria.", author: "John Templeton"),
        .init(text: "The time of maximum pessimism is the best time to buy, and the time of maximum optimism is the best time to sell.", author: "John Templeton"),
        .init(text: "The four most dangerous words in investing are: 'This time it's different.'", author: "John Templeton"),
        .init(text: "If you want to have a better performance than the crowd, you must do things differently from the crowd.", author: "John Templeton"),
    ]
}

@Observable
@MainActor
final class ProcessingProgress {
    var isVisible = false
    var phase: ProcessingPhase = .preparing
    var percent: Double = 0
    var eta = "Estimating time…"
    var quote: ProcessingQuote?

    private var startedAt = Date()
    private var estimateMs = 90_000
    private var floor: Double = 0
    private var quotes: [ProcessingQuote] = []
    private var quoteIndex = 0
    private var tickTask: Task<Void, Never>?
    private var quoteTask: Task<Void, Never>?
    private var hideTask: Task<Void, Never>?

    func start(symbolCount: Int, mode: ReportMode, phase: ProcessingPhase = .preparing) {
        stopTimers()
        startedAt = Date()
        estimateMs = ProcessingProgressLogic.estimateProcessingMs(
            symbolCount: max(1, symbolCount),
            mode: mode
        )
        percent = 2
        floor = 2
        quotes = ProcessingProgressLogic.quotes.shuffled()
        quoteIndex = 0
        self.phase = phase
        quote = quotes.first
        isVisible = true
        render()
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                self?.tick()
            }
        }
        quoteTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                self?.rotateQuote()
            }
        }
    }

    func onMeta() {
        floor = max(floor, 18)
        phase = .fundamentals
    }

    func onSticky() {
        floor = max(floor, 48)
        phase = .analysis
    }

    func onBody() {
        floor = max(floor, 72)
        phase = .drafting
    }

    func onDone() {
        floor = 100
        percent = 100
        phase = .complete
        render()
        hideTask?.cancel()
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            self?.hide()
        }
    }

    func fail() {
        hide()
    }

    func hide() {
        stopTimers()
        isVisible = false
    }

    private func tick() {
        let elapsedMs = Date().timeIntervalSince(startedAt) * 1000
        let timed = min(92, (elapsedMs / Double(estimateMs)) * 92)
        percent = max(percent, floor, timed)
        render()
    }

    private func rotateQuote() {
        guard !quotes.isEmpty else { return }
        quoteIndex += 1
        quote = quotes[quoteIndex % quotes.count]
    }

    private func render() {
        let remaining = max(0, Double(estimateMs) - Date().timeIntervalSince(startedAt) * 1000)
            * (1 - percent / 100)
        eta = ProcessingProgressLogic.formatEta(remainingMs: Int(remaining), percent: percent)
    }

    private func stopTimers() {
        tickTask?.cancel()
        quoteTask?.cancel()
        hideTask?.cancel()
        tickTask = nil
        quoteTask = nil
        hideTask = nil
    }
}
