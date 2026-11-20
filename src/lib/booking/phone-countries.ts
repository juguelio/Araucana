/**
 * Códigos de país para el teléfono, con su bandera. Compartido por todos los formularios que cargan
 * reservas (checkout común, aeropuerto, Chapelco, ida y vuelta y «Nueva reserva» del admin) para que
 * se elija el país y no haga falta saber el código.
 *
 * Están todos los países (20-nov: un celular +44 no se podía cargar). El `<select>` usa el código
 * como valor, así que hay **una opción por código**: los que comparten código (+1, +7, +44, …) van
 * juntos en una sola opción con el país principal (y el resto en el nombre cuando ayuda).
 * Los nombres salen de `Intl.DisplayNames`, como en nacionalidad, salvo los que se escriben a mano.
 */
export type PhoneCountry = { value: string; label: string; flag: string; name: string };

/** Primeros en la lista: los que más llegan. El resto va en orden alfabético. */
const FIRST = ["AR", "CL", "BR", "UY", "PY", "BO", "PE", "US", "ES"];

/** Nombres a mano para códigos compartidos por varios países. */
const NAMES: Record<string, string> = {
  US: "EE.UU./Canadá",
  RU: "Rusia/Kazajistán",
  GB: "Reino Unido",
  NO: "Noruega",
  AU: "Australia",
  FI: "Finlandia",
  IT: "Italia/Vaticano",
  MA: "Marruecos",
  RE: "Reunión/Mayotte",
  GP: "Guadalupe/San Martín/San Bartolomé",
  CW: "Curazao/Caribe Neerlandés",
  NZ: "Nueva Zelanda/Islas Pitcairn"
};

/** País (ISO 3166-1) y código telefónico. Uno por código: el país que lo representa. */
const DIAL_CODES: Array<[string, string]> = [
  ["AR", "54"], ["CL", "56"], ["BR", "55"], ["UY", "598"], ["PY", "595"], ["BO", "591"], ["PE", "51"],
  ["US", "1"], ["ES", "34"],
  ["AD", "376"], ["AE", "971"], ["AF", "93"], ["AL", "355"], ["AM", "374"], ["AO", "244"], ["AT", "43"],
  ["AU", "61"], ["AW", "297"], ["AZ", "994"], ["BA", "387"], ["BD", "880"], ["BE", "32"], ["BF", "226"],
  ["BG", "359"], ["BH", "973"], ["BI", "257"], ["BJ", "229"], ["BN", "673"], ["BT", "975"], ["BW", "267"],
  ["BY", "375"], ["BZ", "501"], ["CD", "243"], ["CF", "236"], ["CG", "242"], ["CH", "41"], ["CI", "225"],
  ["CK", "682"], ["CM", "237"], ["CN", "86"], ["CO", "57"], ["CR", "506"], ["CU", "53"], ["CV", "238"],
  ["CW", "599"], ["CY", "357"], ["CZ", "420"], ["DE", "49"], ["DJ", "253"], ["DK", "45"], ["DZ", "213"],
  ["EC", "593"], ["EE", "372"], ["EG", "20"], ["ER", "291"], ["ET", "251"], ["FI", "358"], ["FJ", "679"],
  ["FK", "500"], ["FM", "691"], ["FO", "298"], ["FR", "33"], ["GA", "241"], ["GB", "44"], ["GE", "995"],
  ["GF", "594"], ["GH", "233"], ["GI", "350"], ["GL", "299"], ["GM", "220"], ["GN", "224"], ["GP", "590"],
  ["GQ", "240"], ["GR", "30"], ["GT", "502"], ["GW", "245"], ["GY", "592"], ["HK", "852"], ["HN", "504"],
  ["HR", "385"], ["HT", "509"], ["HU", "36"], ["ID", "62"], ["IE", "353"], ["IL", "972"], ["IN", "91"],
  ["IO", "246"], ["IQ", "964"], ["IR", "98"], ["IS", "354"], ["IT", "39"], ["JO", "962"], ["JP", "81"],
  ["KE", "254"], ["KG", "996"], ["KH", "855"], ["KI", "686"], ["KM", "269"], ["KP", "850"], ["KR", "82"],
  ["KW", "965"], ["LA", "856"], ["LB", "961"], ["LI", "423"], ["LK", "94"], ["LR", "231"], ["LS", "266"],
  ["LT", "370"], ["LU", "352"], ["LV", "371"], ["LY", "218"], ["MA", "212"], ["MC", "377"], ["MD", "373"],
  ["ME", "382"], ["MG", "261"], ["MH", "692"], ["MK", "389"], ["ML", "223"], ["MM", "95"], ["MN", "976"],
  ["MO", "853"], ["MQ", "596"], ["MR", "222"], ["MT", "356"], ["MU", "230"], ["MV", "960"], ["MW", "265"],
  ["MX", "52"], ["MY", "60"], ["MZ", "258"], ["NA", "264"], ["NC", "687"], ["NE", "227"], ["NF", "672"],
  ["NG", "234"], ["NI", "505"], ["NL", "31"], ["NO", "47"], ["NP", "977"], ["NR", "674"], ["NU", "683"],
  ["NZ", "64"], ["OM", "968"], ["PA", "507"], ["PF", "689"], ["PG", "675"], ["PH", "63"], ["PK", "92"],
  ["PL", "48"], ["PM", "508"], ["PS", "970"], ["PT", "351"], ["PW", "680"], ["QA", "974"], ["RE", "262"],
  ["RO", "40"], ["RS", "381"], ["RU", "7"], ["RW", "250"], ["SA", "966"], ["SB", "677"], ["SC", "248"],
  ["SD", "249"], ["SE", "46"], ["SG", "65"], ["SH", "290"], ["SI", "386"], ["SK", "421"], ["SL", "232"],
  ["SM", "378"], ["SN", "221"], ["SO", "252"], ["SR", "597"], ["SS", "211"], ["ST", "239"], ["SV", "503"],
  ["SY", "963"], ["SZ", "268"], ["TD", "235"], ["TG", "228"], ["TH", "66"], ["TJ", "992"], ["TK", "690"],
  ["TL", "670"], ["TM", "993"], ["TN", "216"], ["TO", "676"], ["TR", "90"], ["TV", "688"], ["TW", "886"],
  ["TZ", "255"], ["UA", "380"], ["UG", "256"], ["UZ", "998"], ["VE", "58"], ["VN", "84"], ["VU", "678"],
  ["WF", "681"], ["WS", "685"], ["YE", "967"], ["ZA", "27"], ["ZM", "260"], ["ZW", "263"]
];

/** Bandera a partir del código ISO (letras «regional indicator»). */
function flagOf(iso: string) {
  return String.fromCodePoint(...[...iso].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
}

function buildPhoneCountries(): PhoneCountry[] {
  const regionNames = new Intl.DisplayNames(["es-AR"], { type: "region" });
  const countries = DIAL_CODES.map(([iso, dial]) => {
    const name = NAMES[iso] ?? regionNames.of(iso) ?? iso;
    const value = `+${dial}`;
    return { iso, value, label: `${name} ${value}`, flag: flagOf(iso), name };
  });
  const rank = (iso: string) => (FIRST.includes(iso) ? FIRST.indexOf(iso) : FIRST.length);
  return countries
    .sort((a, b) => rank(a.iso) - rank(b.iso) || a.name.localeCompare(b.name, "es-AR"))
    .map(({ value, label, flag, name }) => ({ value, label, flag, name }));
}

export const phoneCountries: PhoneCountry[] = buildPhoneCountries();

/** Etiqueta que se ve en el `<option>`: bandera + país + código. */
export function phoneCountryLabel(c: PhoneCountry) {
  return `${c.flag} ${c.name} ${c.value}`;
}
