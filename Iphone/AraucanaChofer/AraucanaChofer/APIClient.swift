import Foundation

struct APIClient {
    var baseURL: URL
    var token: String?

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) {
                return date
            }
            if let date = try? Date.ISO8601FormatStyle().parse(value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Fecha ISO invalida: \(value)"
            )
        }
        return decoder
    }()

    func login(email: String, password: String) async throws -> AuthSessionEnvelope {
        try await post("/api/v1/auth/login", body: ["email": email, "password": password])
    }

    func refreshSession() async throws -> AuthSessionEnvelope {
        try await post("/api/v1/auth/refresh", authenticated: true)
    }

    func logout() async throws -> LogoutEnvelope {
        try await post("/api/v1/auth/logout", authenticated: true)
    }

    func jornada() async throws -> Jornada {
        try await get("/api/v1/driver/jornada")
    }

    func marcas() async throws -> MarcasEnvelope {
        try await get("/api/v1/driver/marcas")
    }

    func registrar(_ marca: Marca) async throws -> MarcaRespuesta {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
        }
        return try await postJSON("/api/v1/driver/marcas", data: encoder.encode(marca))
    }

    func ubicacion(_ body: [String: Any]) async throws {
        let _: UbicacionRespuesta = try await postJSON("/api/v1/driver/location", data: JSONSerialization.data(withJSONObject: body))
    }

    private func postJSON<T: Decodable>(_ path: String, data: Data) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        try authorize(&request)
        return try await send(request)
    }

    private func get<T: Decodable>(_ path: String, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated {
            try authorize(&request)
        }
        return try await send(request)
    }

    private func post<T: Decodable>(_ path: String, body: [String: String]? = nil, authenticated: Bool = false) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if authenticated {
            try authorize(&request)
        }
        return try await send(request)
    }

    private func authorize(_ request: inout URLRequest) throws {
        guard let token, !token.isEmpty else {
            throw DriverAPIError.unauthorized
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private static let transport: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        return URLSession(configuration: config)
    }()

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await Self.transport.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw DriverAPIError.invalidResponse
        }

        if (200..<300).contains(http.statusCode) {
            return try decoder.decode(T.self, from: data)
        }

        if http.statusCode == 401 || (http.statusCode == 403 && request.httpMethod == "GET") {
            throw DriverAPIError.unauthorized
        }

        if let apiError = try? decoder.decode(APIErrorEnvelope.self, from: data) {
            throw DriverAPIError.api(apiError.error.message)
        }

        throw DriverAPIError.httpStatus(http.statusCode)
    }
}

enum DriverAPIError: LocalizedError {
    case api(String)
    case httpStatus(Int)
    case invalidResponse
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .api(let message):
            return message
        case .httpStatus(let status):
            return "La API respondio con estado \(status)."
        case .invalidResponse:
            return "La respuesta de la API no es valida."
        case .unauthorized:
            return "Necesitas iniciar sesion nuevamente."
        }
    }
}
