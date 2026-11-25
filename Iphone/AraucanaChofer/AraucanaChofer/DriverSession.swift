import Foundation
import Security
import Network
import UIKit

@MainActor
final class DriverSession: ObservableObject {
    @Published private(set) var cache: DriverOffline?
    @Published private(set) var jornada: Jornada?
    @Published private(set) var conectado = false
    @Published private(set) var ahora = Date()
    @Published var apiBaseURL: String
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    let gps = DriverGPS()
    private var token: String?
    private let red = NWPathMonitor()
    private var disponible = true
    private var tarea: UUID?
    private var restaurado = false
    private var renovando = false
    var isAuthenticated: Bool { cache != nil }
    var pendientes: Int { cache?.pendientes.count ?? 0 }

    init() {
        #if DEBUG
        apiBaseURL = UserDefaults.standard.string(forKey: "araucana.api.baseURL") ?? "https://araucana.vercel.app"
        #else
        apiBaseURL = "https://araucana.vercel.app"
        #endif
        if let guardada = UserDefaults.standard.string(forKey: "araucana.api.baseURL"), guardada == apiBaseURL {
            token = TokenStore.read()
        }
        gps.reevaluar = { [weak self] in self?.actualizarGPS() }
        gps.asignacionCambiada = { [weak self] in Task { await self?.refresh() } }
        red.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                self.disponible = path.status == .satisfied
                if self.disponible { await self.refresh() } else { self.conectado = false }
            }
        }
        red.start(queue: DispatchQueue(label: "araucana.conexion"))
    }

    func restore() async {
        guard !restaurado else { return }
        restaurado = true
        guard let token else { return }
        renovando = true
        isLoading = true
        let base = apiBaseURL
        defer { renovando = false; isLoading = false }
        let id = UserDefaults.standard.string(forKey: "araucana.chofer.activo")
        if let id, let anterior = try? DriverOffline.leer(base: apiBaseURL, id: id) {
            guard anterior.expiresAt > Date() else {
                anterior.cerrar(base: apiBaseURL)
                cerrarSesion(expirada: true)
                return
            }
            cache = anterior
            jornada = anterior.jornada
            actualizarGPS()
        }
        do {
            let session = try await cliente(token).refreshSession()
            guard self.token == token, apiBaseURL == base else { return }
            try autenticar(session)
            renovando = false
            await refresh()
        } catch {
            guard self.token == token, apiBaseURL == base else { return }
            if case DriverAPIError.unauthorized = error {
                cerrarSesion(expirada: true)
            } else if cache == nil {
                errorMessage = "Para abrir la jornada por primera vez necesitás conexión."
            }
        }
    }

    func signIn() async {
        guard !isLoading, !renovando else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        let base = apiBaseURL
        do {
            let session = try await cliente(nil).login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            guard base == apiBaseURL else { return }
            try autenticar(session)
            password = ""
            await refresh()
        } catch { errorMessage = error.localizedDescription }
    }

    private func autenticar(_ sesion: AuthSessionEnvelope) throws {
        guard sesion.isActive != false, sesion.user.role == "DRIVER" else {
            cerrarSesion(expirada: true)
            throw DriverAPIError.api("Se necesita una cuenta de chofer habilitada.")
        }
        var local = try DriverOffline.leer(base: apiBaseURL, id: sesion.user.id)
            ?? DriverOffline(user: sesion.user, expiresAt: sesion.expiresAt)
        local.user = sesion.user
        local.expiresAt = sesion.expiresAt
        try local.guardar(base: apiBaseURL)
        try TokenStore.save(sesion.token)
        token = sesion.token
        UserDefaults.standard.set(apiBaseURL, forKey: "araucana.api.baseURL")
        UserDefaults.standard.set(sesion.user.id, forKey: "araucana.chofer.activo")
        cache = local
        jornada = local.jornada
    }

    func signOut() {
        if let token, let api = try? cliente(token) {
            Task { _ = try? await api.logout() }
        }
        cerrarSesion(expirada: false)
    }

    private func cerrarSesion(expirada: Bool) {
        cache?.cerrar(base: apiBaseURL)
        UserDefaults.standard.removeObject(forKey: "araucana.chofer.activo")
        tarea = nil
        TokenStore.remove()
        token = nil; cache = nil; jornada = nil; conectado = false; password = ""
        errorMessage = expirada ? "Tu sesión venció. Ingresá nuevamente." : nil
        actualizarGPS()
    }

    private func cliente(_ token: String?) throws -> APIClient {
        guard let url = URL(string: apiBaseURL), let host = url.host,
              url.scheme == "https" || (url.scheme == "http" && ["127.0.0.1","localhost"].contains(host)) else {
            throw DriverAPIError.api("Usá la dirección HTTPS de Araucana o localhost para el simulador.")
        }
        return APIClient(baseURL: url, token: token)
    }

    @discardableResult private func guardar(_ local: DriverOffline) -> Bool {
        do {
            try local.guardar(base: apiBaseURL)
            cache = local
            return true
        } catch {
            errorMessage = "No se pudo guardar en este teléfono. Revisá el espacio disponible y reintentá."
            return false
        }
    }

    func refresh() async {
        guard !renovando, tarea == nil, let token, cache != nil, disponible else { return }
        let corrida = UUID()
        tarea = corrida
        defer { if tarea == corrida { tarea = nil } }
        do {
            let api = try cliente(token)
            // Un único envío en orden por cuenta. Cada reintento usa el mismo id, incluso tras un cierre.
            var enviosPendientes = false
            for marca in cache?.pendientes ?? [] {
                guard tarea == corrida, self.token == token else { return }
                let resultado: MarcaRespuesta
                do { resultado = try await api.registrar(marca) }
                catch let error as DriverAPIError {
                    if case .unauthorized = error { throw error }
                    enviosPendientes = true
                    continue
                }
                guard tarea == corrida, self.token == token, var local = cache else { return }
                var confirmada = marca
                confirmada.comprobante = nil
                confirmada.estado = resultado.estado
                confirmada.motivo = resultado.motivo
                confirmada.driverId = local.user.id
                local.marcas.removeAll { $0.id == marca.id }
                local.marcas.append(confirmada)
                local.pendientes.removeAll { $0.id == marca.id }
                guard guardar(local) else { return }
            }
            async let agenda = api.jornada()
            async let listado = api.marcas()
            let (datos, registros) = try await (agenda, listado)
            guard tarea == corrida, self.token == token, var local = cache else { return }
            jornada = datos
            let descargadas = Set(datos.servicios.filter { $0.fecha == datos.fecha }.map(\.clave))
            local.hojas = local.hojas.union(descargadas).intersection(Set(datos.servicios.map(\.clave)))
            local.jornada = Jornada(fecha: datos.fecha, servicios: datos.servicios.map { local.hojas.contains($0.clave) ? $0 : $0.soloResumen() })
            let recibidas = Set(registros.marcas.map(\.id))
            let desde = JornadaFecha.calendar.date(byAdding: .day, value: -7, to: Date()) ?? Date()
            let revisionesRecientes = local.marcas.filter { $0.estado == "revision" && $0.at >= desde && !recibidas.contains($0.id) }
            local.marcas = registros.marcas + revisionesRecientes
            local.actualizado = Date()
            conectado = true
            errorMessage = enviosPendientes ? "Hay marcas que siguen pendientes de envío." : nil
            guard guardar(local) else { return }
            actualizarGPS()
            if !enviosPendientes && !local.pendientes.isEmpty { Task { await self.refresh() } }
        } catch {
            guard tarea == corrida, self.token == token else { return }
            conectado = false
            if case DriverAPIError.unauthorized = error { cerrarSesion(expirada: true) }
            else { errorMessage = "Sin actualizar. Se conserva la última hoja y las marcas pendientes." }
        }
    }

    func pulso() {
        ahora = Date()
        if let local = cache, local.expiresAt <= ahora { cerrarSesion(expirada: true); return }
        actualizarGPS()
    }

    func abrirHoja(_ servicio: Servicio) {
        guard var local = cache, !local.hojas.contains(servicio.clave), conectado,
              let actual = jornada?.servicios.first(where: { $0.clave == servicio.clave }) else { return }
        local.hojas.insert(servicio.clave)
        if let indice = local.jornada?.servicios.firstIndex(where: { $0.clave == servicio.clave }) {
            local.jornada?.servicios[indice] = actual
        }
        guardar(local)
    }

    func registrar(_ tipo: String, servicio: Servicio, fila: Fila? = nil, cantidad: Int? = nil) {
        guard var local = cache, servicio.fecha == JornadaFecha.dia(Date()),
              local.hojas.contains(servicio.clave), let comprobante = servicio.comprobante else { return }
        var marca = Marca(id: UUID().uuidString, servicioId: servicio.id, vehicleId: servicio.nave?.id,
                          tipo: tipo, filaId: fila?.id, cantidad: cantidad, at: Date())
        marca.fecha = servicio.fecha
        marca.comprobante = comprobante
        local.pendientes.append(marca)
        guard guardar(local) else { return }
        actualizarGPS()
        Task { await refresh() }
    }

    func marcas(servicio: Servicio, tipo: String, fila: Fila? = nil) -> [Marca] {
        guard let cache else { return [] }
        return (cache.marcas + cache.pendientes).filter {
            ($0.fecha ?? JornadaFecha.dia($0.at)) == servicio.fecha &&
                $0.servicioId == servicio.id && $0.tipo == tipo && $0.filaId == fila?.id
        }.sorted { $0.at < $1.at }
    }

    func marcaActual(_ servicio: Servicio, _ tipo: String, _ fila: Fila? = nil) -> Marca? {
        marcas(servicio: servicio, tipo: tipo, fila: fila).last { $0.corresponde(a: servicio) && $0.estado != "revision" }
    }

    func gpsManual(_ servicio: Servicio) {
        guard var local = cache, servicio.permiteGPSManual(Date()) else { return }
        local.manualGPS = local.manualGPS == servicio.clave ? nil : servicio.clave
        if guardar(local) { actualizarGPS() }
    }

    private func actualizarGPS() {
        guard let token, let local = cache, local.expiresAt > Date() else {
            gps.aplicar(nil, manual: false, cliente: nil)
            return
        }
        let instante = Date()
        let hoy = JornadaFecha.dia(instante)
        let propios = jornada?.servicios.filter { $0.fecha == hoy && $0.nave != nil } ?? []
        let activos = propios.filter { $0.enHorario(instante) }
        let manual = propios.first { $0.clave == local.manualGPS && $0.permiteGPSManual(instante) }
        let candidatos = activos + [manual].compactMap { $0 }
        let conflicto = Set(candidatos.compactMap { $0.nave?.id }).count > 1
        let elegido = conflicto ? nil : candidatos.first
        gps.aplicar(elegido, manual: elegido?.clave != nil && elegido?.clave == manual?.clave, cliente: try? cliente(token), conflicto: conflicto)
    }
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
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let result = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if result == errSecSuccess { return }
        guard result == errSecItemNotFound else {
            throw DriverAPIError.api("No se pudo actualizar el llavero de este dispositivo.")
        }
        query.merge(attrs) { _, nuevo in nuevo }
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
