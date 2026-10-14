import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: DriverSession

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Iniciá sesión con la cuenta Google que tenga acceso de chofer habilitado por Araucana.")
                        .font(.body)
                } header: {
                    Text("Acceso seguro")
                }

                Section {
                    TextField("URL de API", text: $session.apiBaseURL)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Para simulador local usa http://127.0.0.1:3000. En producción debe ser HTTPS.")
                }

                if let errorMessage = session.errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await session.signInWithGoogle() }
                    } label: {
                        if session.isLoading {
                            ProgressView()
                        } else {
                            Label("Continuar con Google", systemImage: "person.crop.circle")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(session.isLoading)
                }
            }
            .navigationTitle("Araucana Chofer")
        }
    }
}

#Preview {
    LoginView().environmentObject(DriverSession())
}
