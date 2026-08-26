import SwiftUI

struct SearchView: View {
    @Environment(ZenBuyAPIClient.self) private var api
    @State private var viewModel: SearchViewModel?

    var body: some View {
        Group {
            if let viewModel {
                searchContent(viewModel)
            } else {
                ProgressView()
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = SearchViewModel(api: api)
            }
        }
    }

    @ViewBuilder
    private func searchContent(_ viewModel: SearchViewModel) -> some View {
        @Bindable var viewModel = viewModel

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ZenBuyBrandHeader(onDark: true)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 20)
                    .background(ZenBuyTheme.greenDark)

                VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ticker or company name")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(ZenBuyTheme.muted)

                    TextField("AAPL, Apple, Palo Alto…", text: $viewModel.query)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(14)
                        .background(ZenBuyTheme.surface)
                        .clipShape(Capsule())
                        .onChange(of: viewModel.query) { _, _ in
                            viewModel.onQueryChanged()
                        }

                    if viewModel.isSearching {
                        ProgressView()
                            .padding(.top, 4)
                    }

                    if !viewModel.suggestions.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(viewModel.suggestions) { result in
                                Button {
                                    viewModel.addPick(result)
                                } label: {
                                    HStack {
                                        Text(result.symbol)
                                            .font(.body.weight(.semibold))
                                            .foregroundStyle(ZenBuyTheme.ink)
                                        Text(result.name)
                                            .font(.subheadline)
                                            .foregroundStyle(ZenBuyTheme.muted)
                                            .lineLimit(1)
                                        Spacer()
                                    }
                                    .padding(.vertical, 12)
                                    .padding(.horizontal, 14)
                                }
                                if result.id != viewModel.suggestions.last?.id {
                                    Divider()
                                }
                            }
                        }
                        .background(ZenBuyTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(ZenBuyTheme.border, lineWidth: 1)
                        )
                    }
                }

                if !viewModel.picks.isEmpty {
                    FlowLayout(spacing: 8) {
                        ForEach(viewModel.picks) { pick in
                            HStack(spacing: 6) {
                                Text(pick.symbol)
                                    .font(.subheadline.weight(.semibold))
                                Button {
                                    viewModel.removePick(pick)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.caption)
                                        .foregroundStyle(ZenBuyTheme.muted)
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(ZenBuyTheme.sageLight)
                            .clipShape(Capsule())
                        }
                    }
                }

                InvestmentGoalPicker(
                    selectedId: $viewModel.selectedDirectiveId,
                    directives: viewModel.directives
                )

                Button("Generate report") {
                    viewModel.beginGenerate()
                }
                .buttonStyle(.borderedProminent)
                .tint(ZenBuyTheme.sage)
                .disabled(!viewModel.canGenerate)

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.bear)
                }

                Text("Select 1–4 tickers. Reports stream from the ZenBuy API.")
                    .font(.footnote)
                    .foregroundStyle(ZenBuyTheme.muted)
                }
                .padding(20)
            }
        }
        .background(ZenBuyTheme.background)
        .sheet(isPresented: $viewModel.showModeSheet) {
            ReportModeSheet(picks: viewModel.picks) { mode in
                viewModel.confirmMode(mode)
            }
        }
        .navigationDestination(isPresented: $viewModel.showReport) {
            ReportStreamView(
                symbols: viewModel.picks.map(\.symbol),
                mode: viewModel.selectedMode,
                directive: viewModel.selectedDirectiveId
            )
        }
    }
}

/// Simple horizontal wrapping layout for ticker chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var frames: [CGRect] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), frames)
    }
}

#Preview {
    NavigationStack {
        SearchView()
            .environment(ZenBuyAPIClient())
    }
}
