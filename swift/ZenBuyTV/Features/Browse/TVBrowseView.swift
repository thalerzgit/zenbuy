import SwiftUI

struct TVBrowseView: View {
    private enum BrowseFocus: Hashable {
        case intent(SearchInputMode)
        case goal(String)
        case window(String)
        case discover
        case result(String)
        case suggestion(String)
        case pick(String)
        case generate
    }

    @Bindable var viewModel: SearchViewModel
    @FocusState private var tickerFieldFocused: Bool
    @FocusState private var focus: BrowseFocus?
    /// Why a suggestion click did not add a ticker. The only refusal is a full
    /// selection, which is otherwise a silent no-op.
    @State private var selectionNotice: String?

    private let goalColumns = [
        GridItem(.flexible(), spacing: TVTheme.columnGap),
        GridItem(.flexible(), spacing: TVTheme.columnGap),
        GridItem(.flexible(), spacing: TVTheme.columnGap)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: TVTheme.stackSpacing) {
                    if viewModel.wizardStep != .unlocked {
                        wizardChrome
                    } else {
                        summaryBar
                    }

                    switch viewModel.wizardStep {
                    case .pathIntent:
                        pathIntent
                    case .investmentGoal:
                        goalPicker
                    case .profitWindow:
                        windowPicker
                    case .unlocked:
                        unlockedPath
                    }

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(TVTheme.captionFont)
                            .foregroundStyle(ZenBuyTheme.bear)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, TVTheme.pagePadding)
                .padding(.vertical, 28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(ZenBuyTheme.background.ignoresSafeArea())
        .onAppear {
            viewModel.onUnlockedPathAppeared()
        }
        .onChange(of: viewModel.wizardStep) { _, step in
            // Selecting a card advances the wizard, which tears the focused
            // card out of the hierarchy. Nothing else on a wizard step is
            // focusable, so focus has to be handed to the next step's lead
            // card by hand or the remote goes dead. Unlocking claims the
            // discover CTA for the same reason — otherwise focus falls to
            // "Change setup" in the summary bar.
            guard viewModel.path.isEmpty else { return }
            // Unlocked in "enter" mode brings its own focusables (ticker field,
            // summary bar); only the find screen owns the discover CTA.
            guard step != .unlocked || viewModel.inputMode == .find else { return }
            focus = wizardLeadFocus
        }
        .onChange(of: discoverSymbols) { _, symbols in
            guard findScreenIsVisible, let first = symbols.first else { return }
            focus = .result(first)
        }
    }

    private var discoverSymbols: [String] {
        viewModel.discoverResults.map(\.symbol)
    }

    /// Lead control of the current step — the focus target after an
    /// auto-advance, and the `.defaultFocus` for a step's first appearance.
    private var wizardLeadFocus: BrowseFocus {
        switch viewModel.wizardStep {
        case .pathIntent:
            return .intent(.find)
        case .investmentGoal:
            return .goal(viewModel.directives.first?.id ?? "")
        case .profitWindow:
            return .window(viewModel.profitHorizonOptions.first?.id ?? "")
        case .unlocked:
            return .discover
        }
    }

    /// Every wizard step is a single choice, so the click that records the
    /// choice is also the click that moves on — there is no Continue button, and
    /// no Back button either. "Change setup" on the unlocked screen reopens the
    /// wizard from the top when a choice needs redoing.
    private func advance(_ choose: () -> Void) {
        choose()
        viewModel.continueWizard()
    }

    /// Only the unlocked Find screen owns `focus`. A discover call can also
    /// finish after the wizard is reopened or a report is pushed, and aiming
    /// `@FocusState` at a view that is not on screen would drop focus instead
    /// of moving it.
    private var findScreenIsVisible: Bool {
        viewModel.path.isEmpty
            && viewModel.wizardStep == .unlocked
            && viewModel.inputMode == .find
    }

    private var wizardChrome: some View {
        Text(viewModel.wizardStep.progressLabel ?? "Get set")
            .font(TVTheme.eyebrowFont)
            .foregroundStyle(ZenBuyTheme.muted)
    }

    private var summaryBar: some View {
        HStack(spacing: 28) {
            Text(viewModel.wizardSummary)
                .font(TVTheme.cardTitleFont)
                .foregroundStyle(ZenBuyTheme.greenDark)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 16)
            Button("Change setup") {
                viewModel.reopenWizard()
            }
            .buttonStyle(.tvSecondary)
        }
        .padding(TVTheme.cardPadding)
        .background(ZenBuyTheme.greenLight)
        .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous)
                .strokeBorder(ZenBuyTheme.green.opacity(0.4), lineWidth: 2)
        )
        .tvFocusRow()
    }

    private var pathIntent: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What do you want to do?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            HStack(alignment: .top, spacing: TVTheme.columnGap) {
                intentCard(
                    mode: .find,
                    title: "Find stocks",
                    subtitle: "We’ll suggest names that match your style and time window."
                )
                intentCard(
                    mode: .enter,
                    title: "Analyze tickers you know",
                    subtitle: "Search by symbol or company name, then generate a report."
                )
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, wizardLeadFocus)
    }

    private func intentCard(mode: SearchInputMode, title: String, subtitle: String) -> some View {
        let selected = viewModel.pathIntentChosen && viewModel.inputMode == mode
        return Button {
            advance { viewModel.choosePathIntent(mode) }
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(TVTheme.cardTitleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.tvCard(selected: selected, minHeight: TVTheme.intentCardMinHeight))
        .focused($focus, equals: .intent(mode))
    }

    private var goalPicker: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What’s your investment goal?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            LazyVGrid(columns: goalColumns, alignment: .leading, spacing: TVTheme.columnGap) {
                ForEach(viewModel.directives) { directive in
                    let selected = viewModel.selectedDirectiveId == directive.id
                    VStack(alignment: .leading, spacing: 12) {
                        Button {
                            advance { viewModel.selectDirective(directive.id) }
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(directive.label)
                                    .font(TVTheme.cardTitleFont)
                                    .foregroundStyle(ZenBuyTheme.ink)
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.8)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(directive.headline)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.greenDark)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(directive.plainEnglish)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .lineLimit(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .buttonStyle(.tvCard(selected: selected, minHeight: TVTheme.goalCardMinHeight))
                        .focused($focus, equals: .goal(directive.id))

                        Button("About this goal") {
                            viewModel.showDirectiveDetail(directive.id)
                        }
                        .buttonStyle(.tvChip)
                    }
                }
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, wizardLeadFocus)
    }

    private var windowPicker: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("What’s your profit window?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            HStack(spacing: TVTheme.columnGap) {
                ForEach(viewModel.profitHorizonOptions) { option in
                    let selected = ProfitHorizonOption.closest(
                        to: viewModel.profitHorizonYears,
                        in: viewModel.profitHorizonOptions
                    )?.id == option.id
                    Button {
                        advance { viewModel.setProfitHorizonYears(option.years) }
                    } label: {
                        Text(option.label)
                            .font(TVTheme.cardTitleFont)
                            .foregroundStyle(ZenBuyTheme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .buttonStyle(.tvCard(selected: selected, minHeight: TVTheme.windowCardMinHeight))
                    .focused($focus, equals: .window(option.id))
                }
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, wizardLeadFocus)
    }

    /// Selection leads the screen. A search for "IBM" returns more rows than a
    /// 1080p page can hold, so chips and Generate placed under that list are
    /// off screen at the one moment they matter — the click that adds a ticker.
    @ViewBuilder
    private var unlockedPath: some View {
        if !viewModel.picks.isEmpty {
            selectionScope
        }

        if viewModel.inputMode == .enter {
            enterTickers
        } else {
            findTickers
        }
    }

    @ViewBuilder
    private var selectionScope: some View {
        picksRow

        if viewModel.canGenerate {
            Button("Generate report") {
                tickerFieldFocused = false
                viewModel.beginGenerate()
            }
            .buttonStyle(.tvPrimary)
            .focused($focus, equals: .generate)
            .tvFocusRow()
        }
    }

    private var enterTickers: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Ticker or company name")
                .font(TVTheme.cardTitleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            TextField("AAPL, Apple, Palo Alto…", text: $viewModel.query)
                .font(TVTheme.bodyFont)
                .focused($tickerFieldFocused)
                .frame(maxWidth: TVTheme.fieldMaxWidth)
                .padding(6)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(
                            tickerFieldFocused ? ZenBuyTheme.green : Color.clear,
                            lineWidth: 6
                        )
                )
                .animation(TVTheme.focusAnimation, value: tickerFieldFocused)
                .onChange(of: viewModel.query) { _, _ in
                    selectionNotice = nil
                    viewModel.onQueryChanged()
                }
                .onSubmit {
                    tickerFieldFocused = false
                }

            Text("Select 1–\(SearchViewModel.maxPicks) tickers. Reports stream from zenbuy.info.")
                .font(TVTheme.captionFont)
                .foregroundStyle(ZenBuyTheme.muted)

            if viewModel.isSearching {
                ProgressView()
                    .tint(ZenBuyTheme.green)
            }

            if !viewModel.suggestions.isEmpty {
                VStack(spacing: 16) {
                    ForEach(viewModel.suggestions) { result in
                        let selected = viewModel.picks.contains(result)
                        Button {
                            toggleSuggestion(result)
                        } label: {
                            HStack(spacing: 20) {
                                Text(result.symbol)
                                    .font(TVTheme.cardTitleFont)
                                    .foregroundStyle(ZenBuyTheme.ink)
                                Text(result.name)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                if selected {
                                    Text("Selected")
                                        .font(TVTheme.captionFont.weight(.semibold))
                                        .foregroundStyle(ZenBuyTheme.greenDark)
                                }
                            }
                        }
                        .buttonStyle(.tvCard(selected: selected))
                        .focused($focus, equals: .suggestion(result.symbol))
                    }
                }
                .frame(maxWidth: TVTheme.readingMaxWidth, alignment: .leading)
            }
        }
        .tvFocusRow()
    }

    /// A suggestion row is a toggle, like a discover row. Adding empties the
    /// query and the list, so the click that lands a ticker also has to say
    /// where focus goes — Generate, the step it just unlocked.
    ///
    /// A full selection is the one click that cannot add anything. It used to
    /// return in silence from `addPick`, which is how four picks carried over
    /// from a Find run read as a broken remote. Focus moves to the chips so the
    /// scroll view carries the reason and the remedy into view together.
    private func toggleSuggestion(_ result: SymbolResult) {
        if viewModel.picks.contains(result) {
            viewModel.removePick(result)
            parkFocusAfterRemoval()
            return
        }
        guard !viewModel.selectionIsFull else {
            selectionNotice =
                "\(result.symbol) needs a free slot — remove one of these \(SearchViewModel.maxPicks) first."
            if let first = viewModel.picks.first {
                focus = .pick(first.symbol)
            }
            return
        }
        selectionNotice = nil
        viewModel.addPick(result)
        tickerFieldFocused = false
        focus = .generate
    }

    /// Removing the last chip takes Generate off screen with it.
    private func parkFocusAfterRemoval() {
        selectionNotice = nil
        guard viewModel.picks.isEmpty else {
            focus = .generate
            return
        }
        if viewModel.inputMode == .find {
            focus = .discover
        } else if let first = viewModel.suggestions.first {
            focus = .suggestion(first.symbol)
        }
    }

    private var findTickers: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("We’ll suggest up to 4 names that match your goal.")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)

            // Stays enabled while the call is in flight: a disabled button is
            // not focusable, which left "Change setup" as the only control on
            // the screen for the whole discover round trip.
            Button {
                guard !viewModel.isDiscovering else { return }
                viewModel.runDiscover()
            } label: {
                HStack(spacing: 16) {
                    if viewModel.isDiscovering {
                        ProgressView()
                    }
                    Text(viewModel.isDiscovering ? "Finding matches…" : "Find stocks for my goal")
                }
            }
            .buttonStyle(.tvPrimary)
            .focused($focus, equals: .discover)

            if !viewModel.discoverResults.isEmpty {
                Text("Click a name to add or remove it, then generate.")
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)

                VStack(spacing: 16) {
                    ForEach(viewModel.discoverResults) { pick in
                        let selected = viewModel.picks.contains { $0.symbol == pick.symbol }
                        Button {
                            viewModel.toggleDiscoverPick(pick)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 20) {
                                    Text(pick.symbol)
                                        .font(TVTheme.cardTitleFont)
                                        .foregroundStyle(ZenBuyTheme.ink)
                                    Text(pick.name)
                                        .font(TVTheme.captionFont)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                    Text("\(pick.fitScore)% fit")
                                        .font(TVTheme.captionFont.weight(.semibold))
                                        .foregroundStyle(ZenBuyTheme.greenDark)
                                }
                                Text(pick.reason)
                                    .font(TVTheme.captionFont)
                                    .foregroundStyle(ZenBuyTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .buttonStyle(.tvCard(selected: selected))
                        .focused($focus, equals: .result(pick.symbol))
                    }
                }
                .frame(maxWidth: TVTheme.readingMaxWidth, alignment: .leading)
            }
        }
        .tvFocusRow()
        .defaultFocus($focus, .discover)
    }

    private var picksRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                "Selected \(viewModel.picks.count) of \(SearchViewModel.maxPicks) · click a symbol to remove it"
            )
            .font(TVTheme.eyebrowFont)
            .foregroundStyle(ZenBuyTheme.muted)

            if let selectionNotice {
                Text(selectionNotice)
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.bear)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 20) {
                ForEach(viewModel.picks) { pick in
                    Button {
                        viewModel.removePick(pick)
                        parkFocusAfterRemoval()
                    } label: {
                        HStack(spacing: 12) {
                            Text(pick.symbol)
                            Image(systemName: "xmark")
                                .font(.system(size: 22, weight: .bold))
                        }
                    }
                    .buttonStyle(.tvChip)
                    .focused($focus, equals: .pick(pick.symbol))
                    .accessibilityLabel("Remove \(pick.symbol)")
                }
            }
        }
        .tvFocusRow()
    }
}
