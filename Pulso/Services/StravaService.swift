import Foundation
import AuthenticationServices
import UIKit

/// Strava API v3 client. Uses the user's own Strava API application (Client ID + Secret created at
/// strava.com/settings/api with "Authorization Callback Domain" = localhost), so no server is needed.
@MainActor
final class StravaService: NSObject, ObservableObject {
    static let shared = StravaService()
    static let redirectURI = "pulso://localhost/strava"
    private let settings = AppSettings.shared
    private var authSession: ASWebAuthenticationSession?

    struct Activity: Decodable, Identifiable {
        let id: Int
        let name: String
        let sport_type: String?
        let type: String?
        let start_date: Date
        let elapsed_time: Int
        let moving_time: Int?
        let distance: Double?
        let average_heartrate: Double?
        let max_heartrate: Double?
        let kilojoules: Double?
        let total_elevation_gain: Double?
        let suffer_score: Double?
        let calories: Double?
        var sport: String { sport_type ?? type ?? "Workout" }
    }

    enum StravaError: LocalizedError {
        case notConfigured, notConnected, http(Int, String), auth(String)
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Configura el Client ID y el Client Secret de tu app de Strava."
            case .notConnected: return "Conecta tu cuenta de Strava primero."
            case .http(let c, let m): return "Strava respondió \(c): \(m)"
            case .auth(let m): return "Autorización de Strava fallida: \(m)"
            }
        }
    }

    var isConnected: Bool { Keychain.get(Keychain.Key.stravaRefresh) != nil }

    var clientSecret: String? {
        get { Keychain.get(Keychain.Key.stravaClientSecret) }
        set { Keychain.set(newValue, for: Keychain.Key.stravaClientSecret) }
    }

    // MARK: OAuth

    func connect() async throws {
        guard !settings.stravaClientId.isEmpty, let secret = clientSecret, !secret.isEmpty else { throw StravaError.notConfigured }
        var c = URLComponents(string: "https://www.strava.com/oauth/mobile/authorize")!
        c.queryItems = [
            .init(name: "client_id", value: settings.stravaClientId),
            .init(name: "redirect_uri", value: Self.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "approval_prompt", value: "auto"),
            .init(name: "scope", value: "read,activity:read_all,activity:write")
        ]
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: c.url!, callbackURLScheme: "pulso") { url, err in
                if let url { cont.resume(returning: url) } else { cont.resume(throwing: err ?? StravaError.auth("cancelado")) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            authSession = s
            s.start()
        }
        guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value else {
            throw StravaError.auth("sin código")
        }
        try await exchange(["code": code, "grant_type": "authorization_code"])
    }

    func disconnect() {
        Keychain.set(nil, for: Keychain.Key.stravaAccess)
        Keychain.set(nil, for: Keychain.Key.stravaRefresh)
        settings.stravaAthleteName = ""
        settings.stravaTokenExpiry = 0
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_at: Double
        let athlete: Athlete?
        struct Athlete: Decodable { let firstname: String?; let lastname: String? }
    }

    private func exchange(_ params: [String: String]) async throws {
        guard let secret = clientSecret else { throw StravaError.notConfigured }
        var req = URLRequest(url: URL(string: "https://www.strava.com/oauth/token")!)
        req.httpMethod = "POST"
        var body = params
        body["client_id"] = settings.stravaClientId
        body["client_secret"] = secret
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = body.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
            .joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw StravaError.http(code, String(data: data, encoding: .utf8) ?? "") }
        let t = try JSONDecoder().decode(TokenResponse.self, from: data)
        Keychain.set(t.access_token, for: Keychain.Key.stravaAccess)
        Keychain.set(t.refresh_token, for: Keychain.Key.stravaRefresh)
        settings.stravaTokenExpiry = t.expires_at
        if let a = t.athlete { settings.stravaAthleteName = [a.firstname, a.lastname].compactMap { $0 }.joined(separator: " ") }
    }

    private func validToken() async throws -> String {
        guard let refresh = Keychain.get(Keychain.Key.stravaRefresh) else { throw StravaError.notConnected }
        if Date().timeIntervalSince1970 > settings.stravaTokenExpiry - 300 {
            try await exchange(["refresh_token": refresh, "grant_type": "refresh_token"])
        }
        guard let t = Keychain.get(Keychain.Key.stravaAccess) else { throw StravaError.notConnected }
        return t
    }

    private func request(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil,
                         contentType: String? = nil) async throws -> Data {
        var c = URLComponents(string: "https://www.strava.com/api/v3" + path)!
        if !query.isEmpty { c.queryItems = query }
        var req = URLRequest(url: c.url!)
        req.httpMethod = method
        req.setValue("Bearer \(try await validToken())", forHTTPHeaderField: "Authorization")
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw StravaError.http(code, String(data: data, encoding: .utf8) ?? "") }
        return data
    }

    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    // MARK: API

    func activities(after: Date? = nil, perPage: Int = 60) async throws -> [Activity] {
        var q = [URLQueryItem(name: "per_page", value: "\(perPage)")]
        if let after { q.append(.init(name: "after", value: "\(Int(after.timeIntervalSince1970))")) }
        let data = try await request("/athlete/activities", query: q)
        return try decoder.decode([Activity].self, from: data)
    }

    /// Creates a manual activity (no GPS / HR stream).
    func createActivity(name: String, sportType: String, start: Date, elapsedSeconds: Int, description: String) async throws -> Int {
        let f = ISO8601DateFormatter()
        f.timeZone = .current
        f.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime, .withDashSeparatorInDate]
        let params = ["name": name, "sport_type": sportType, "start_date_local": f.string(from: start),
                      "elapsed_time": "\(elapsedSeconds)", "description": description]
        let body = params.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")" }.joined(separator: "&")
        let data = try await request("/activities", method: "POST", body: body.data(using: .utf8),
                                     contentType: "application/x-www-form-urlencoded")
        struct R: Decodable { let id: Int }
        return try JSONDecoder().decode(R.self, from: data).id
    }

    /// Uploads a TCX file (with the strap heart-rate curve). Returns the activity id when processed.
    func uploadTCX(_ tcx: String, name: String, description: String, externalId: String) async throws -> Int? {
        let boundary = "pulso-\(UUID().uuidString)"
        var body = Data()
        func field(_ n: String, _ v: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(n)\"\r\n\r\n\(v)\r\n".data(using: .utf8)!)
        }
        field("data_type", "tcx")
        field("name", name)
        field("description", description)
        field("external_id", externalId)
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(externalId).tcx\"\r\nContent-Type: application/xml\r\n\r\n".data(using: .utf8)!)
        body.append(tcx.data(using: .utf8)!)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        let data = try await request("/uploads", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
        struct U: Decodable { let id: Int; let activity_id: Int?; let error: String?; let status: String? }
        var u = try JSONDecoder().decode(U.self, from: data)
        for _ in 0..<8 where u.activity_id == nil && u.error == nil {
            try await Task.sleep(for: .seconds(2))
            u = try JSONDecoder().decode(U.self, from: try await request("/uploads/\(u.id)"))
        }
        if let e = u.error { throw StravaError.http(422, e) }
        return u.activity_id
    }

    nonisolated static func spanishSport(_ s: String) -> String {
        switch s {
        case "Run", "TrailRun", "VirtualRun": return "Carrera"
        case "Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide": return "Ciclismo"
        case "Swim": return "Natación"
        case "Walk": return "Caminata"
        case "Hike": return "Senderismo"
        case "WeightTraining": return "Fuerza"
        case "Workout", "Crossfit", "HighIntensityIntervalTraining": return "Entrenamiento"
        case "Yoga": return "Yoga"
        case "Rowing", "VirtualRow": return "Remo"
        case "Soccer": return "Fútbol"
        case "Padel", "Tennis": return "Raqueta"
        default: return s
        }
    }
}

extension StravaService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}
