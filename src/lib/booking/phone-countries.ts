/**
 * Códigos de país para el teléfono, con su bandera. Compartido por los checkouts
 * (aeropuerto y común) para que el pasajero elija el país y no tenga que saber el código.
 */
export type PhoneCountry = { value: string; label: string; flag: string; name: string };

export const phoneCountries: PhoneCountry[] = [
  { value: "+54", label: "Argentina +54", flag: "🇦🇷", name: "Argentina" },
  { value: "+56", label: "Chile +56", flag: "🇨🇱", name: "Chile" },
  { value: "+55", label: "Brasil +55", flag: "🇧🇷", name: "Brasil" },
  { value: "+598", label: "Uruguay +598", flag: "🇺🇾", name: "Uruguay" },
  { value: "+595", label: "Paraguay +595", flag: "🇵🇾", name: "Paraguay" },
  { value: "+591", label: "Bolivia +591", flag: "🇧🇴", name: "Bolivia" },
  { value: "+51", label: "Perú +51", flag: "🇵🇪", name: "Perú" },
  { value: "+1", label: "EE.UU./Canadá +1", flag: "🇺🇸", name: "EE.UU./Canadá" },
  { value: "+34", label: "España +34", flag: "🇪🇸", name: "España" }
];

/** Etiqueta que se ve en el `<option>`: bandera + país + código. */
export function phoneCountryLabel(c: PhoneCountry) {
  return `${c.flag} ${c.name} ${c.value}`;
}
