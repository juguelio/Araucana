import CoreLocation
import UIKit

@MainActor
final class DriverGPS: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var estado = "GPS fuera de servicio"
    @Published private(set) var ultimoEnvio: Date?
    private let manager = CLLocationManager()
    private var servicio: Servicio?
    var precisionReducida: Bool { activo && manager.accuracyAuthorization == .reducedAccuracy }
    var asignacion: String? {
        guard let servicio, let nave = servicio.nave else { return nil }
        return servicio.titulo + " · " + nave.etiqueta
    }
    private var manual = false
    private var client: APIClient?
    private var solicitado = false
    private var enviando = false
    private var activo = false
    private var intento = Date.distantPast
    var reevaluar: (() -> Void)?
    var asignacionCambiada: (() -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        manager.allowsBackgroundLocationUpdates = true
    }

    func aplicar(_ nuevo: Servicio?, manual: Bool, cliente: APIClient?, conflicto: Bool = false) {
        let cambio = nuevo?.clave != servicio?.clave
        if cambio { ultimoEnvio = nil; intento = .distantPast }
        servicio = nuevo
        self.manual = manual
        client = cliente
        guard nuevo?.nave != nil && cliente != nil else {
            if activo { manager.stopUpdatingLocation(); activo = false }
            estado = conflicto ? "GPS pausado · confirmar nave con Administración" : "GPS fuera de servicio"
            return
        }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            if !activo {
                guard UIApplication.shared.applicationState != .background else {
                    estado = "Abrí la app para activar el GPS"
                    return
                }
                manager.startUpdatingLocation()
                activo = true
                estado = "GPS activo · buscando señal"
            }
        case .notDetermined:
            estado = "GPS pendiente de permiso"
            if !solicitado && UIApplication.shared.applicationState == .active {
                solicitado = true
                manager.requestWhenInUseAuthorization()
            }
        default:
            if activo { manager.stopUpdatingLocation(); activo = false }
            estado = "GPS sin permiso · revisá Ajustes"
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.reevaluar?() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in await self.enviar(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            if self.activo { self.estado = "GPS sin señal" }
        }
    }

    private func enviar(_ location: CLLocation) async {
        // También se evalúa al recibir cada posición con el teléfono bloqueado.
        reevaluar?()
        guard let servicio, let nave = servicio.nave, let client, activo, !enviando,
              Date().timeIntervalSince(intento) >= 3,
              abs(location.timestamp.timeIntervalSinceNow) < 20,
              location.horizontalAccuracy >= 0,
              (manual ? servicio.permiteGPSManual(location.timestamp) : servicio.enHorario(location.timestamp)) else { return }
        let clave = servicio.clave
        enviando = true
        intento = Date()
        defer { enviando = false }
        var datos: [String: Any] = [
            "vehicleId": nave.id, "servicioId": servicio.id, "manual": manual,
            "latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "recordedAt": ISO8601DateFormatter().string(from: location.timestamp)
        ]
        if location.speed >= 0 { datos["speed"] = location.speed }
        if location.course >= 0 { datos["heading"] = location.course }
        do {
            try await client.ubicacion(datos)
            guard self.servicio?.clave == clave else { return }
            ultimoEnvio = Date()
            estado = "Compartiendo ubicación"
        } catch {
            guard self.servicio?.clave == clave else { return }
            estado = "GPS sin enviar · reintentando"
            if !(error is URLError) { asignacionCambiada?() }
        }
    }
}
