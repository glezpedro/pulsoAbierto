import SwiftUI
import SwiftData

struct CoachView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSettings.self) private var settings
    @Query(filter: #Predicate<ChatMessageRecord> { $0.conversation == "main" }, sort: \ChatMessageRecord.date) private var messages: [ChatMessageRecord]
    @State private var input = ""
    @State private var streamingText = ""
    @State private var isStreaming = false
    @State private var error: String?
    @FocusState private var focused: Bool

    let suggestions = [
        "¿Cómo estoy hoy y qué entreno me recomiendas?",
        "Analiza mi última semana de sueño",
        "¿Por qué ha bajado mi VFC?",
        "Ajusta mi plan: hoy solo tengo 40 minutos",
        "¿Estoy progresando en press de banca?",
        "Dame un plan de alimentación para mi objetivo",
        "¿Cuánto debería dormir esta noche?",
        "Revisa mis medidas y dime cómo voy"
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !settings.hasAnthropicKey {
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Configura tu coach IA", systemImage: "key.fill").font(.headline)
                            Text("Pulso usa Claude con tu propia clave de API de Anthropic (pagas solo lo que uses, sin suscripción). Créala en console.anthropic.com y pégala en Ajustes › Coach IA.")
                                .font(.subheadline).foregroundStyle(Theme.secondaryText)
                            NavigationLink("Ir a Ajustes") { SettingsView() }
                        }
                    }
                    .padding()
                }
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if messages.isEmpty && !isStreaming {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Pregúntame lo que quieras sobre tus datos, entrenos, sueño o nutrición.")
                                        .font(.subheadline).foregroundStyle(Theme.secondaryText)
                                    ForEach(suggestions, id: \.self) { s in
                                        Button { send(s) } label: {
                                            Text(s).font(.subheadline).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                                                .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(!settings.hasAnthropicKey)
                                    }
                                }
                            }
                            ForEach(messages) { m in Bubble(role: m.role, text: m.text) }
                            if isStreaming { Bubble(role: "assistant", text: streamingText.isEmpty ? "…" : streamingText) }
                            if let error { Text(error).font(.caption).foregroundStyle(Theme.red) }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding()
                    }
                    .onChange(of: streamingText) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                    .onChange(of: messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                    .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Escribe al coach…", text: $input, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($focused)
                        .padding(10)
                        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                    Button { send(input) } label: {
                        Image(systemName: isStreaming ? "hourglass" : "arrow.up.circle.fill").font(.system(size: 32))
                    }
                    .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isStreaming || !settings.hasAnthropicKey)
                }
                .padding(.horizontal).padding(.vertical, 8)
                .background(Theme.bg)
            }
            .screenBackground()
            .navigationTitle("Coach")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(role: .destructive) { clear() } label: { Label("Nueva conversación", systemImage: "trash") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
    }

    func send(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !isStreaming else { return }
        input = ""
        error = nil
        focused = false
        model.context.insert(ChatMessageRecord(role: "user", text: t))
        try? model.context.save()
        isStreaming = true
        streamingText = ""
        // last 20 turns of history
        var history = messages.suffix(20).map { ClaudeService.Message(role: $0.role, content: $0.text) }
        if history.last?.content != t || history.last?.role != "user" { history.append(.init(role: "user", content: t)) }
        // the API requires alternating roles starting with user
        while history.first?.role == "assistant" { history.removeFirst() }
        let system = model.coach.chatSystemPrompt()
        Task {
            do {
                let full = try await ClaudeService.shared.stream(system: system, messages: history, maxTokens: 16000, effort: "medium") { delta in
                    streamingText += delta
                }
                model.context.insert(ChatMessageRecord(role: "assistant", text: full))
                try? model.context.save()
            } catch {
                self.error = error.localizedDescription
            }
            isStreaming = false
            streamingText = ""
        }
    }

    func clear() {
        for m in messages { model.context.delete(m) }
        try? model.context.save()
    }
}

struct Bubble: View {
    let role: String
    let text: String
    var body: some View {
        HStack {
            if role == "user" { Spacer(minLength: 40) }
            Text(LocalizedStringKey(text))
                .font(.subheadline)
                .textSelection(.enabled)
                .padding(12)
                .background(role == "user" ? Theme.accent.opacity(0.25) : Theme.card, in: RoundedRectangle(cornerRadius: 16))
            if role != "user" { Spacer(minLength: 20) }
        }
    }
}
