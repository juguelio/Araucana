import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: DriverSession

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Ingresá con el email y la contraseña de tu cuenta de chofer habilitada por Araucana.")
                        .font(.body)
                } header: {
                    Text("Acceso seguro")
                }

                Section("Cuenta") {
                    TextField("Email", text: $session.email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Contraseña", text: $session.password)
                        .textContentType(.password)
                }

                #if DEBUG
                Section {
                    TextField("URL de API", text: $session.apiBaseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .disabled(session.isLoading)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Para simulador local usa http://127.0.0.1:3000. En producción debe ser HTTPS.")
                }

                #endif

                if let errorMessage = session.errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await session.signIn() }
                    } label: {
                        if session.isLoading {
                            ProgressView()
                        } else {
                            Text("Ingresar")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(session.isLoading || session.email.isEmpty || session.password.isEmpty)
                }
            }
            .navigationTitle("Araucana Chofer")
        }
    }
}

#Preview {
    LoginView().environmentObject(DriverSession())
}
