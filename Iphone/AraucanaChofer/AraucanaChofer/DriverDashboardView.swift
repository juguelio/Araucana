import SwiftUI

struct DriverDashboardView: View {
    @EnvironmentObject private var session: DriverSession
    @State private var diaElegido: String?
    @State private var confirmarSalida = false

    private var dias: [String] { JornadaFecha.semana(session.ahora) }
    private var dia: String { diaElegido.flatMap { dias.contains($0) ? $0 : nil } ?? dias[0] }
    private var servicios: [Servicio] { session.jornada?.servicios ?? [] }
    private var delDia: [Servicio] { servicios.filter { $0.fecha == dia } }
    private var principal: Servicio? {
        let candidatos = delDia.filter { session.marcaActual($0, "fin") == nil }
        if dia != dias[0] { return candidatos.first }
        return candidatos.first { session.marcaActual($0, "inicio") != nil }
            ?? candidatos.first { $0.enHorario(session.ahora) }
            ?? candidatos.first { ($0.salida ?? .distantFuture) >= session.ahora }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Día", selection: Binding(get: { dia }, set: { diaElegido = $0 })) {
                        ForEach(dias, id: \.self) { fecha in Text(JornadaFecha.etiqueta(fecha, hoy: dias[0])).tag(fecha) }
                    }
                }

                if session.jornada == nil || (session.cache?.actualizado == nil) {
                    Section { Text("La jornada todavía no está descargada. Conectate para obtener tus asignaciones.") }
                } else if let jornada = session.jornada, !JornadaFecha.cubre(dia, desde: jornada.fecha) {
                    Section { Text("Este día todavía no está descargado. Conectate para actualizar la jornada.") }
                } else if delDia.isEmpty {
                    Section {
                        Text(dia == dias[0] ? "Hoy no tenés servicios asignados" : "Sin servicios asignados para este día")
                        if let proxima = servicios.first(where: { $0.fecha > dia && dias.contains($0.fecha) }) {
                            Button("Ver próxima salida · " + JornadaFecha.etiqueta(proxima.fecha, hoy: dias[0])) { diaElegido = proxima.fecha }
                        }
                    }
                } else {
                    if let servicio = principal {
                        let iniciada = session.marcaActual(servicio, "inicio") != nil
                        let titulo = iniciada ? "Servicio iniciado" : (servicio.enHorario(session.ahora) ? "En horario de servicio" : "Próxima salida")
                        Section(titulo) {
                            ResumenServicio(servicio: servicio)
                            NavigationLink("Ver hoja de ruta", value: servicio.clave)
                                .fontWeight(.semibold)
                        }
                    }
                    let otras = delDia.filter { $0.clave != principal?.clave }
                    if !otras.isEmpty {
                        Section("Salidas del día") {
                            ForEach(otras, id: \.clave) { servicio in
                                NavigationLink(value: servicio.clave) { ResumenServicio(servicio: servicio) }
                            }
                        }
                    }
                }
                Section("Estado de la jornada") {
                    EstadoGPS(gps: session.gps)
                    if let ultima = session.cache?.actualizado {
                        LabeledContent("Última actualización", value: ultima.formatted(date: .abbreviated, time: .shortened))
                    }
                    if !session.conectado { Text("Sin conexión con Administración").foregroundStyle(.secondary) }
                    if session.pendientes > 0 { Text("Marcas pendientes de envío · \(session.pendientes)") }
                    if let revision = session.cache?.marcas.filter({ $0.estado == "revision" }), !revision.isEmpty {
                        Text("Marcas en revisión por Administración · \(revision.count)").foregroundStyle(.orange)
                    }
                    if let error = session.errorMessage { Text(error).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Mi jornada")
            .navigationDestination(for: String.self) { clave in HojaServicio(clave: clave) }
            .refreshable { await session.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let email = session.cache?.user.email { Text(email) }
                        Button("Cerrar sesión", role: .destructive) { confirmarSalida = true }
                    } label: { Label("Cuenta", systemImage: "person.crop.circle") }
                }
            }
            .confirmationDialog("¿Cerrar sesión?", isPresented: $confirmarSalida, titleVisibility: .visible) {
                Button("Cerrar sesión", role: .destructive) { session.signOut() }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text(session.pendientes == 0 ? "Se eliminarán las hojas descargadas de este teléfono." :
                        "Hay \(session.pendientes) marcas pendientes. Se enviarán cuando vuelvas a ingresar con esta cuenta.")
            }
        }
    }
}

private struct ResumenServicio: View {
    let servicio: Servicio
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(servicio.salida.map(JornadaFecha.hora(_:)) ?? "Horario por confirmar").font(.title2.weight(.semibold))
            Text(servicio.titulo).font(.headline)
            Label(servicio.nave?.etiqueta ?? "Nave pendiente de asignación", systemImage: "bus")
            if !servicio.origen.isEmpty { Text("Salida desde " + servicio.origen) }
            if let primera = servicio.primeraParada { Text("Primera parada · " + primera).foregroundStyle(.secondary) }
        }.padding(.vertical, 3)
    }
}

private struct EstadoGPS: View {
    @ObservedObject var gps: DriverGPS
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(gps.estado, systemImage: "location")
            if gps.precisionReducida {
                Text("Precisión reducida. Podés activar Ubicación precisa en Ajustes.").font(.caption)
            }
            if let asignacion = gps.asignacion { Text(asignacion).font(.caption) }
            if let ultima = gps.ultimoEnvio { Text("Último envío · " + JornadaFecha.hora(ultima)).font(.caption) }
        }
    }
}

private struct HojaServicio: View {
    @EnvironmentObject private var session: DriverSession
    let clave: String

    var body: some View {
        List {
            if let servicio = session.jornada?.servicios.first(where: { $0.clave == clave }) {
                Section(servicio.tipo) { ResumenServicio(servicio: servicio) }
                if session.cache?.hojas.contains(clave) == true {
                    contenido(servicio)
                } else {
                    Text("Esta hoja todavía no está descargada. Abrila con conexión para guardarla.")
                }
            } else { Text("Esta salida ya no figura entre tus asignaciones.") }
        }
        .navigationTitle("Hoja de ruta").navigationBarTitleDisplayMode(.inline)
        .onAppear { guardarHoja() }
        .onChange(of: session.conectado) { guardarHoja() }
        .refreshable { await session.refresh(); guardarHoja() }
    }

    private func guardarHoja() {
        if let servicio = session.jornada?.servicios.first(where: { $0.clave == clave }) { session.abrirHoja(servicio) }
    }

    @ViewBuilder private func contenido(_ servicio: Servicio) -> some View {
        let hoy = servicio.fecha == JornadaFecha.dia(session.ahora)
        if !servicio.indicaciones.isEmpty {
            Section("Indicaciones") {
                ForEach(Array(servicio.indicaciones.enumerated()), id: \.offset) { Text($0.element) }
            }
        }
        if !servicio.paradas.isEmpty {
            Section("Paradas") {
                ForEach(Array(servicio.paradas.enumerated()), id: \.offset) { p in Text("\(p.offset + 1). \(p.element)") }
            }
        }
        if hoy {
            Section("Registro de la salida") {
                ForEach(["inicio","fin"], id: \.self) { tipo in
                    if let marca = session.marcaActual(servicio, tipo) {
                        LabeledContent(tipo == "inicio" ? "Inicio informado" : "Fin informado",
                                       value: JornadaFecha.hora(marca.at) + (marca.estado == nil ? " · pendiente" : ""))
                    } else {
                        Button(tipo == "inicio" ? "Marcar inicio" : "Marcar fin") { session.registrar(tipo, servicio: servicio) }
                    }
                }
            }
            Section("Ubicación") {
                EstadoGPS(gps: session.gps)
                if servicio.permiteGPSManual(session.ahora) {
                    Button(session.cache?.manualGPS == clave ? "Detener GPS" : "Activar GPS de este servicio") {
                        session.gpsManual(servicio)
                    }
                }
            }
        }
        if !servicio.filas.isEmpty {
            Section(servicio.compartida ? "Planilla compartida · pasajeros" : "Pasajeros") {
                ForEach(servicio.filas) { fila in
                    FilaEmbarque(servicio: servicio, fila: fila, editable: hoy && servicio.nave != nil)
                }
            }
        }
        if !session.conectado || session.pendientes > 0 {
            Section {
                Text(session.conectado ? "Marcas pendientes · \(session.pendientes)" : "Hoja descargada · sin conexión")
                if let actualizada = session.cache?.actualizado {
                    Text("Última actualización · " + actualizada.formatted(date: .abbreviated, time: .shortened)).font(.caption)
                }
            }
        }
    }
}

private struct FilaEmbarque: View {
    @EnvironmentObject private var session: DriverSession
    let servicio: Servicio
    let fila: Fila
    let editable: Bool
    @State private var cantidad = 0
    @State private var editando = false

    var body: some View {
        let registros = session.marcas(servicio: servicio, tipo: "embarque", fila: fila)
        let marca = session.marcaActual(servicio, "embarque", fila)
        VStack(alignment: .leading, spacing: 6) {
            Text(fila.nombre).font(.headline)
            Text("\(fila.cantidad) persona\(fila.cantidad == 1 ? "" : "s")")
            if !fila.detalle.isEmpty { Text(fila.detalle) }
            if let telefono = fila.telefono, let url = URL(string: "tel:" + telefono.filter { $0.isNumber || $0 == "+" }) {
                Link(telefono, destination: url)
            }
            if let n = marca?.cantidad {
                Text((n == 0 ? "Ausente" : "Subieron \(n) de \(fila.cantidad)") + (marca?.estado == nil ? " · pendiente de envío" : ""))
            } else { Text(fila.registroAnterior ?? "Sin informar").foregroundStyle(.secondary) }
            if servicio.compartida {
                let otras = Dictionary(grouping: registros.filter { !$0.corresponde(a: servicio) && $0.estado != "revision" }, by: \.vehicleId)
                if !otras.isEmpty {
                    let total = otras.values.compactMap { $0.last?.cantidad }.reduce(0, +)
                    Text("Otras naves · \(total) informados").font(.caption)
                    if total + (marca?.cantidad ?? 0) > fila.cantidad {
                        Text("El total informado supera la reserva. Revisar con Administración.").foregroundStyle(.orange)
                    }
                }
            }
            if let r = registros.last(where: { $0.estado == "revision" }) {
                Text(r.motivo ?? "Diferencia en revisión por Administración").foregroundStyle(.orange)
            }
            if editable {
                HStack {
                    Button("Subieron todos") { session.registrar("embarque", servicio: servicio, fila: fila, cantidad: fila.cantidad) }
                    Spacer()
                    Menu("Opciones") {
                        Button("Indicar cantidad") { cantidad = marca?.cantidad ?? fila.cantidad; editando = true }
                        Button("Ausente") { session.registrar("embarque", servicio: servicio, fila: fila, cantidad: 0) }
                    }
                }.buttonStyle(.borderless)
            }
        }.padding(.vertical, 3)
        .sheet(isPresented: $editando) {
            NavigationStack {
                Form {
                    Text(fila.nombre)
                    Stepper("Subieron \(cantidad) de \(fila.cantidad)", value: $cantidad, in: 0...fila.cantidad)
                    Button("Guardar cantidad") {
                        session.registrar("embarque", servicio: servicio, fila: fila, cantidad: cantidad)
                        editando = false
                    }
                }.navigationTitle("Embarque").navigationBarTitleDisplayMode(.inline)
            }.presentationDetents([.medium])
        }
    }
}
