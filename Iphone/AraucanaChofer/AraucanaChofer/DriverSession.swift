import Foundation
import Security

@MainActor
final class DriverSession: ObservableObject {
    @Published private(set) var user: APIUser?
    @Published private(set) var bootstrap: DriverBootstrap?
    @Published var apiBaseURL: String
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var token: String?

    var isAuthenticated: Bool {
        user != nil
    }

    init() {
        self.apiBaseURL = UserDefaults.standard.string(forKey: StorageKey.apiBaseURL) ?? "https://araucana.com.ar"
        self.token = TokenStore.read()
    }

    func restore() async {
        guard user == nil, let token else { return }
        do {
            let client = try makeClient(token: token)
            let session = try await client.refreshSession()
            guard session.isActive != false, session.user.role == "DRIVER" else {
                throw DriverAPIError.api("La cuenta está pendiente de aprobación o no tiene rol de chofer.")
            }
            try TokenStore.save(session.token)
            self.token = session.token
            await loadAuthenticatedData(token: session.token)
        } catch {
            signOut()
        }
    }

    func signIn() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let client = try makeClient(token: nil)
            let session = try await client.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            guard session.isActive != false else {
                if let pendingClient = try? makeClient(token: session.token) { _ = try? await pendingClient.logout() }
                throw DriverAPIError.api("Tu cuenta está pendiente de aprobación.")
            }
            guard session.user.role == "DRIVER" else {
                if let wrongRoleClient = try? makeClient(token: session.token) { _ = try? await wrongRoleClient.logout() }
                throw DriverAPIError.api("Este usuario no tiene rol de chofer.")
            }
            try TokenStore.save(session.token)
            token = session.token
            password = ""
            user = session.user
            UserDefaults.standard.set(apiBaseURL, forKey: StorageKey.apiBaseURL)
            await loadAuthenticatedData(token: session.token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        guard let token else { return }
        do {
            let client = try makeClient(token: token)
            let session = try await client.refreshSession()
            guard session.isActive != false else {
                signOut()
                errorMessage = "La cuenta está inactiva. Contactá a un administrador."
                return
            }
            try TokenStore.save(session.token)
            self.token = session.token
            await loadAuthenticatedData(token: session.token)
        } catch {
            errorMessage = error.localizedDescription
            if case DriverAPIError.unauthorized = error { signOut() }
        }
    }

    func signOut() {
        if let token, let client = try? makeClient(token: token) {
            Task { _ = try? await client.logout() }
        }
        TokenStore.remove()
        token = nil
        user = nil
        bootstrap = nil
        password = ""
        errorMessage = nil
    }

    private func loadAuthenticatedData(token: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let client = try makeClient(token: token)
            async let userRequest = client.me()
            async let bootstrapRequest = client.driverBootstrap()
            let (loadedUser, loadedBootstrap) = try await (userRequest, bootstrapRequest)
            guard loadedUser.role == "DRIVER" else {
                throw DriverAPIError.api("Este usuario no tiene rol de chofer.")
            }
            user = loadedUser
            bootstrap = loadedBootstrap
        } catch {
            errorMessage = error.localizedDescription
            if case DriverAPIError.unauthorized = error { signOut() }
        }
    }

    private func makeClient(token: String?) throws -> APIClient {
        guard let url = URL(string: apiBaseURL), url.scheme != nil, url.host != nil else {
            throw DriverAPIError.api("La URL de la API no es válida.")
        }
        return APIClient(baseURL: url, token: token)
    }
}

private enum StorageKey {
    static let apiBaseURL = "araucana.api.baseURL"
}

private enum TokenStore {
    private static let service = "com.araucana.chofer.auth"
    private static let account = "jwt"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String) throws {
        remove()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(token.utf8)
        ]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            throw DriverAPIError.api("No se pudo guardar la sesión segura en este dispositivo.")
        }
    }

    static func remove() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}
