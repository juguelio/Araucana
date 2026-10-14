import Foundation
import Supabase

@MainActor
final class DriverSession: ObservableObject {
    @Published private(set) var user: APIUser?
    @Published private(set) var bootstrap: DriverBootstrap?
    @Published var apiBaseURL: String
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let supabase: SupabaseClient?

    var isAuthenticated: Bool {
        user != nil
    }

    init() {
        self.apiBaseURL = UserDefaults.standard.string(forKey: StorageKey.apiBaseURL) ?? "http://127.0.0.1:3000"
        if let urlString = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
           let url = URL(string: urlString), url.host != nil,
           let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String,
           !key.isEmpty, !key.contains("$(") {
            self.supabase = SupabaseClient(supabaseURL: url, supabaseKey: key)
        } else {
            self.supabase = nil
        }
    }

    func restore() async {
        guard user == nil, let supabase else {
            return
        }
        do {
            let session = try await supabase.auth.session
            await loadAuthenticatedData(token: session.accessToken)
        } catch {
            signOut()
        }
    }

    func signInWithGoogle() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            guard let supabase else {
                throw DriverAPIError.api("Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en el proyecto de Xcode.")
            }
            let session = try await supabase.auth.signInWithOAuth(
                provider: .google,
                redirectTo: URL(string: "araucana-chofer://login-callback")
            )
            let client = try makeClient(token: session.accessToken)
            let profile = try await client.me()
            guard profile.role == "DRIVER" else {
                throw DriverAPIError.api("Este usuario no tiene rol de chofer.")
            }
            user = profile
            UserDefaults.standard.set(apiBaseURL, forKey: StorageKey.apiBaseURL)
            await loadAuthenticatedData(token: session.accessToken)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        guard let supabase else { return }
        do {
            let session = try await supabase.auth.session
            await loadAuthenticatedData(token: session.accessToken)
        } catch {
            signOut()
        }
    }

    func signOut() {
        if let supabase {
            Task { try? await supabase.auth.signOut() }
        }
        user = nil
        bootstrap = nil
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
            if case DriverAPIError.unauthorized = error {
                signOut()
            }
        }
    }

    private func makeClient(token: String) throws -> APIClient {
        guard let url = URL(string: apiBaseURL), url.scheme != nil, url.host != nil else {
            throw DriverAPIError.api("La URL de la API no es valida.")
        }

        return APIClient(baseURL: url, token: token)
    }
}

private enum StorageKey {
    static let apiBaseURL = "araucana.api.baseURL"
}
