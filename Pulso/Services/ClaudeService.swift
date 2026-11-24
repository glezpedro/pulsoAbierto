import Foundation

/// Anthropic Messages API client (raw HTTPS — there is no official Swift SDK) using the user's own
/// API key stored in the Keychain.
///
/// - Endpoint: POST https://api.anthropic.com/v1/messages, `anthropic-version: 2026-10-21`
/// - Streaming via Server-Sent Events (`content_block_delta` / `text_delta`)
/// - Server-side refusal fallback enabled (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)
///   for Opus/Sonnet; Haiku has no server-side fallback.
final class ClaudeService {
    static let shared = ClaudeService()

    struct Message: Codable {
        let role: String
        let content: String
    }

    enum ClaudeError: LocalizedError {
        case noKey, http(Int, String), refusal, truncated
        var errorDescription: String? {
            switch self {
            case .noKey: return "Añade tu clave de API de Anthropic en Ajustes › Coach IA."
            case .http(let c, let m): return "Error de la API (\(c)): \(m)"
            case .refusal: return "El modelo ha declinado responder a esta petición."
            case .truncated: return "La respuesta se cortó por longitud."
            }
        }
    }

    private let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!

    private func makeRequest(model: String, system: String, messages: [Message], maxTokens: Int, stream: Bool,
                             effort: String, outputSchema: [String: Any]? = nil) throws -> URLRequest {
        guard let key = AppSettings.shared.anthropicKey, !key.isEmpty else { throw ClaudeError.noKey }
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.timeoutInterval = 600
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2026-10-21", forHTTPHeaderField: "anthropic-version")
        let supportsFallback = !model.contains("haiku")
        if supportsFallback { req.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta") }

        var outputConfig: [String: Any] = ["effort": effort]
        if let schema = outputSchema { outputConfig["format"] = ["type": "json_schema", "schema": schema] }
        var body: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "system": [["type": "text", "text": system, "cache_control": ["type": "ephemeral"]]],
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "output_config": outputConfig
        ]
        if stream { body["stream"] = true }
        if supportsFallback { body["fallbacks"] = "default" }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return req
    }

    /// Streams the assistant's text. `onText` receives incremental deltas on the main actor.
    func stream(system: String, messages: [Message], maxTokens: Int = 16000, effort: String = "medium",
                onText: @escaping @MainActor (String) -> Void) async throws -> String {
        let model = AppSettings.shared.claudeModel.rawValue
        let req = try makeRequest(model: model, system: system, messages: messages, maxTokens: maxTokens, stream: true, effort: effort)
        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code != 200 {
            var errText = ""
            for try await line in bytes.lines { errText += line }
            throw ClaudeError.http(code, Self.errorMessage(errText))
        }
        var full = ""
        var stopReason: String?
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard let d = json.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let type = obj["type"] as? String else { continue }
            switch type {
            case "content_block_delta":
                if let delta = obj["delta"] as? [String: Any], delta["type"] as? String == "text_delta",
                   let t = delta["text"] as? String {
                    full += t
                    await onText(t)
                }
            case "message_delta":
                if let delta = obj["delta"] as? [String: Any], let sr = delta["stop_reason"] as? String { stopReason = sr }
            case "error":
                let msg = (obj["error"] as? [String: Any])?["message"] as? String ?? "error"
                throw ClaudeError.http(500, msg)
            default:
                break // message_start, content_block_start/stop (thinking / fallback blocks ignored), ping, message_stop
            }
        }
        if stopReason == "refusal" && full.isEmpty { throw ClaudeError.refusal }
        return full
    }

    /// Non-interactive completion (still streamed under the hood to avoid HTTP timeouts).
    func complete(system: String, prompt: String, maxTokens: Int = 8000, effort: String = "medium") async throws -> String {
        try await stream(system: system, messages: [Message(role: "user", content: prompt)], maxTokens: maxTokens,
                         effort: effort, onText: { _ in })
    }

    /// Structured JSON output constrained by a JSON schema (`output_config.format`).
    func json(system: String, prompt: String, schema: [String: Any], maxTokens: Int = 32000, effort: String = "medium") async throws -> Data {
        let model = AppSettings.shared.claudeModel.rawValue
        var req = try makeRequest(model: model, system: system, messages: [Message(role: "user", content: prompt)],
                                  maxTokens: maxTokens, stream: true, effort: effort, outputSchema: schema)
        req.timeoutInterval = 900
        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code != 200 {
            var errText = ""
            for try await line in bytes.lines { errText += line }
            throw ClaudeError.http(code, Self.errorMessage(errText))
        }
        var text = ""
        var stop: String?
        for try await line in bytes.lines {
            guard line.hasPrefix("data:"), let d = line.dropFirst(5).trimmingCharacters(in: .whitespaces).data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
            if obj["type"] as? String == "content_block_delta", let delta = obj["delta"] as? [String: Any],
               delta["type"] as? String == "text_delta", let t = delta["text"] as? String { text += t }
            if obj["type"] as? String == "message_delta", let delta = obj["delta"] as? [String: Any] { stop = delta["stop_reason"] as? String ?? stop }
        }
        if stop == "refusal" { throw ClaudeError.refusal }
        if stop == "max_tokens" { throw ClaudeError.truncated }
        return Data(text.utf8)
    }

    static func errorMessage(_ raw: String) -> String {
        if let d = raw.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let e = o["error"] as? [String: Any], let m = e["message"] as? String { return m }
        return String(raw.prefix(300))
    }
}
