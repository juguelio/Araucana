import type { Locale } from "./config";

/**
 * Textos de la web pública. El español es la forma canónica: el tipo `Dictionary`
 * sale de acá, así que si a un idioma le falta una clave el build falla.
 */
const es = {
  meta: {
    title: "La Araucana | Agencia de viajes desde 2009",
    description: "Viajes, traslados y experiencias en la Patagonia Argentina."
  },
  nav: {
    home: "Inicio",
    transfers: "Traslados",
    services: "Servicios",
    destinations: "Destinos",
    groups: "Grupos y empresas",
    about: "Nosotros",
    contact: "Contacto",
    login: "Acceso",
    book: "Reservar",
    whatsapp: "Hablar por WhatsApp",
    menuOpen: "Abrir menú",
    menuClose: "Cerrar menú",
    menuLabel: "Navegación mobile"
  },
  hero: {
    titleA: "MUCHO MÁS QUE",
    titleB: "UN TRASLADO",
    leadA: "Vos disfrutá el viaje,",
    leadB: "nosotros nos ocupamos del camino.",
    detail: "Traslados ida y vuelta al Aeropuerto Chapelco. Conexiones con los principales centros de ski. Servicio público, privado y soluciones grupales.",
    cta: "Reservar mi traslado",
    badge: "Experiencia local",
    badgeYear: "desde 2009"
  },
  services: {
    eyebrow: "Elegí cómo viajar",
    titleA: "Tu viaje empieza",
    titleB: "acá.",
    intro: "Una forma simple, cuidada y cómoda de descubrir la Patagonia. Elegí el servicio que necesitás y nosotros nos ocupamos del resto.",
    book: "Reservar",
    ask: "Consultar",
    quote: "Cotizar servicio",
    items: [
      { title: "Traslados aeropuerto", text: "Chapelco ↔ San Martín de los Andes y otros destinos." },
      { title: "Traslados privados", text: "Puerta a puerta para viajar con comodidad y flexibilidad." },
      { title: "Excursiones y destinos", text: "Movilidad para conocer los paisajes más increíbles." },
      { title: "Grupos y empresas", text: "Soluciones para colegios, eventos, equipos y contingentes." }
    ]
  },
  featured: {
    eyebrow: "Servicio destacado",
    titleA: "Del aeropuerto",
    titleB: "a tu destino.",
    titleC: "Sin complicaciones.",
    text: "Llegás a Chapelco y nosotros nos ocupamos del resto. Traslados cómodos, seguros y coordinados para que empieces tu viaje desde el primer momento.",
    fromAirport: "Chapelco",
    fromAirportArrow: "San Martín",
    toAirportArrow: "San Martín",
    toAirport: "Chapelco",
    ctaFlight: "Reservar por vuelo",
    ctaTransfer: "Reservar traslado",
    formTitle: "Buscá tu traslado",
    formStatus: "Disponible",
    origin: "Origen",
    destination: "Destino",
    date: "Fecha",
    pickOrigin: "Elegí un origen",
    pickDestination: "Elegí un destino",
    submit: "Ver horarios"
  },
  destinations: {
    eyebrow: "Nuestros destinos",
    titleA: "Paisajes que",
    titleB: "quedan.",
    intro: "Conocemos cada curva, cada lago y cada camino. Consultá tu traslado al destino que quieras descubrir.",
    cta: "Consultar traslado",
    items: [
      { title: "San Martín de los Andes", detail: "Lagos, bosque y montaña" },
      { title: "Chapelco", detail: "Nieve y experiencias de altura" },
      { title: "Lago Hermoso", detail: "Un refugio en la cordillera" },
      { title: "Villa La Angostura", detail: "Ruta, lago y bosque" }
    ]
  },
  promise: {
    eyebrow: "Mucho más que un traslado",
    titleA: "Viajar bien también",
    titleB: "es parte del viaje.",
    lead: "En La Araucana entendemos que el viaje empieza mucho antes de llegar al destino.",
    text: "Por eso cuidamos cada detalle: coordinación, puntualidad, confort y atención. Queremos que subas y sientas:",
    quote: "“Estoy en buenas manos.”",
    trust: ["Puntualidad", "Coordinación", "Confort", "Atención personalizada"],
    alt: "Unidad de La Araucana preparada para viajar"
  },
  fleet: {
    eyebrow: "Flota",
    titleA: "Preparada para",
    titleB: "Patagonia.",
    lead: "Unidades impecables, seguras y listas para acompañarte en cada recorrido.",
    cta: "Consultar disponibilidad",
    alt: "Paisaje nevado de la cordillera patagónica",
    captionSmall: "La ruta también es parte del viaje",
    captionBigA: "Tu próxima aventura",
    captionBigB: "viaja cómoda."
  },
  map: {
    eyebrow: "Área de operación",
    titleA: "Patagonia para",
    titleB: "descubrir.",
    intro: "Explorá algunos de los lugares donde llegamos. Mové el mapa y encontrá tu próximo destino."
  },
  trust: {
    eyebrow: "Respaldo y experiencia",
    title: "Una atención cercana para viajar con tranquilidad.",
    text: "Empresa habilitada como Agencia de Turismo Estudiantil."
  },
  final: {
    eyebrow: "Patagonia te espera",
    titleA: "El viaje",
    titleB: "es",
    accent: "ahora.",
    cta: "Empezá a viajar"
  },
  contact: {
    eyebrow: "Contacto",
    titleA: "¿A dónde vas?",
    titleB: "Nosotros te llevamos.",
    lead: "Estamos para ayudarte a organizar tu próximo traslado.",
    addressA: "Mariano Moreno 829",
    addressB: "San Martín de los Andes",
    addressC: "Todos los días · 8:30 a 21:00 hs",
    cardTitle: "Hablemos",
    instagram: "Instagram",
    directions: "Cómo llegar"
  },
  routes: {
    title: "Rutas y horarios",
    subtitle: "Elegí tu próximo tramo.",
    allOrigins: "Todos los orígenes",
    allDestinations: "Todos los destinos",
    days: "Días con salidas",
    pickDeparture: "Elegí tu salida",
    check: "Consultar disponibilidad",
    empty: "No encontramos rutas con esos datos.",
    emptyHint: "Probá con otro origen, destino o fecha.",
    clear: "Limpiar búsqueda"
  },
  footer: {
    logoAlt: "La Araucana Viajes",
    kicker: "La forma más cómoda de empezar tu viaje por Patagonia.",
    address: "San Martín de los Andes, Neuquén, Patagonia Argentina",
    postal: "Mariano Moreno 829 — C.P. 8370",
    transfers: "Traslados",
    services: "Servicios",
    destinations: "Destinos",
    contact: "Contacto",
    support: "Soporte",
    terms: "Términos y condiciones",
    privacy: "Privacidad",
    login: "Acceso al sistema",
    legal: "Empresa habilitada como Agencia de Turismo Estudiantil · Leg. 14241 · Disp. 924/05"
  },
  weather: {
    conditions: {
      despejado: "Despejado",
      parcial: "Parcialmente nublado",
      nublado: "Nublado",
      lluvia: "Lluvia",
      nieve: "Nieve",
      tormenta: "Tormenta"
    }
  },
  lang: {
    label: "Idioma",
    switchTo: "Ver el sitio en"
  }
};

export type Dictionary = typeof es;

const en: Dictionary = {
  meta: {
    title: "La Araucana | Travel agency since 2009",
    description: "Trips, transfers and experiences in Argentine Patagonia."
  },
  nav: {
    home: "Home",
    transfers: "Transfers",
    services: "Services",
    destinations: "Destinations",
    groups: "Groups & companies",
    about: "About us",
    contact: "Contact",
    login: "Sign in",
    book: "Book",
    whatsapp: "Chat on WhatsApp",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    menuLabel: "Mobile navigation"
  },
  hero: {
    titleA: "MUCH MORE THAN",
    titleB: "A TRANSFER",
    leadA: "You enjoy the trip,",
    leadB: "we take care of the road.",
    detail: "Round-trip transfers to Chapelco Airport. Connections to the main ski resorts. Public, private and group services.",
    cta: "Book my transfer",
    badge: "Local experience",
    badgeYear: "since 2009"
  },
  services: {
    eyebrow: "Choose how to travel",
    titleA: "Your trip starts",
    titleB: "here.",
    intro: "A simple, careful and comfortable way to discover Patagonia. Pick the service you need and we handle the rest.",
    book: "Book",
    ask: "Ask",
    quote: "Request a quote",
    items: [
      { title: "Airport transfers", text: "Chapelco ↔ San Martín de los Andes and other destinations." },
      { title: "Private transfers", text: "Door to door, with comfort and flexibility." },
      { title: "Tours and destinations", text: "Transport to see the most incredible landscapes." },
      { title: "Groups & companies", text: "Solutions for schools, events, teams and large groups." }
    ]
  },
  featured: {
    eyebrow: "Featured service",
    titleA: "From the airport",
    titleB: "to your destination.",
    titleC: "Without the hassle.",
    text: "You land in Chapelco and we handle the rest. Comfortable, safe and coordinated transfers so your trip starts right away.",
    fromAirport: "Chapelco",
    fromAirportArrow: "San Martín",
    toAirportArrow: "San Martín",
    toAirport: "Chapelco",
    ctaFlight: "Book by flight",
    ctaTransfer: "Book a transfer",
    formTitle: "Find your transfer",
    formStatus: "Available",
    origin: "From",
    destination: "To",
    date: "Date",
    pickOrigin: "Choose a pickup point",
    pickDestination: "Choose a destination",
    submit: "See schedules"
  },
  destinations: {
    eyebrow: "Our destinations",
    titleA: "Landscapes that",
    titleB: "stay with you.",
    intro: "We know every curve, every lake and every road. Ask about the transfer to the destination you want to discover.",
    cta: "Ask about transfer",
    items: [
      { title: "San Martín de los Andes", detail: "Lakes, forest and mountains" },
      { title: "Chapelco", detail: "Snow and high-altitude experiences" },
      { title: "Lago Hermoso", detail: "A refuge in the mountains" },
      { title: "Villa La Angostura", detail: "Road, lake and forest" }
    ]
  },
  promise: {
    eyebrow: "Much more than a transfer",
    titleA: "Travelling well is also",
    titleB: "part of the trip.",
    lead: "At La Araucana we know the trip starts long before you reach your destination.",
    text: "That is why we take care of every detail: coordination, punctuality, comfort and service. We want you to get in and feel:",
    quote: "“I'm in good hands.”",
    trust: ["Punctuality", "Coordination", "Comfort", "Personal service"],
    alt: "La Araucana vehicle ready for the trip"
  },
  fleet: {
    eyebrow: "Fleet",
    titleA: "Ready for",
    titleB: "Patagonia.",
    lead: "Spotless, safe vehicles ready to join you on every route.",
    cta: "Check availability",
    alt: "Snowy landscape of the Patagonian Andes",
    captionSmall: "The road is part of the trip too",
    captionBigA: "Your next adventure",
    captionBigB: "travels in comfort."
  },
  map: {
    eyebrow: "Operating area",
    titleA: "Patagonia to",
    titleB: "discover.",
    intro: "Explore some of the places we reach. Move the map and find your next destination."
  },
  trust: {
    eyebrow: "Backing and experience",
    title: "Close, careful service so you can travel with peace of mind.",
    text: "Licensed as a Student Travel Agency."
  },
  final: {
    eyebrow: "Patagonia is waiting",
    titleA: "The trip",
    titleB: "is",
    accent: "now.",
    cta: "Start travelling"
  },
  contact: {
    eyebrow: "Contact",
    titleA: "Where are you going?",
    titleB: "We'll take you there.",
    lead: "We're here to help you plan your next transfer.",
    addressA: "Mariano Moreno 829",
    addressB: "San Martín de los Andes",
    addressC: "Every day · 8:30 am to 9:00 pm",
    cardTitle: "Let's talk",
    instagram: "Instagram",
    directions: "Get directions"
  },
  routes: {
    title: "Routes and schedules",
    subtitle: "Choose your next leg.",
    allOrigins: "All departure points",
    allDestinations: "All destinations",
    days: "Days with departures",
    pickDeparture: "Choose your departure",
    check: "Check availability",
    empty: "No routes found with those details.",
    emptyHint: "Try another origin, destination or date.",
    clear: "Clear search"
  },
  footer: {
    logoAlt: "La Araucana Viajes",
    kicker: "The easiest way to start your trip through Patagonia.",
    address: "San Martín de los Andes, Neuquén, Argentine Patagonia",
    postal: "Mariano Moreno 829 — ZIP 8370",
    transfers: "Transfers",
    services: "Services",
    destinations: "Destinations",
    contact: "Contact",
    support: "Support",
    terms: "Terms and conditions",
    privacy: "Privacy",
    login: "Staff access",
    legal: "Licensed as a Student Travel Agency · Leg. 14241 · Disp. 924/05"
  },
  weather: {
    conditions: {
      despejado: "Clear",
      parcial: "Partly cloudy",
      nublado: "Cloudy",
      lluvia: "Rain",
      nieve: "Snow",
      tormenta: "Storm"
    }
  },
  lang: {
    label: "Language",
    switchTo: "View the site in"
  }
};

const pt: Dictionary = {
  meta: {
    title: "La Araucana | Agência de viagens desde 2009",
    description: "Viagens, transfers e experiências na Patagônia argentina."
  },
  nav: {
    home: "Início",
    transfers: "Transfers",
    services: "Serviços",
    destinations: "Destinos",
    groups: "Grupos e empresas",
    about: "Sobre nós",
    contact: "Contato",
    login: "Entrar",
    book: "Reservar",
    whatsapp: "Falar no WhatsApp",
    menuOpen: "Abrir menu",
    menuClose: "Fechar menu",
    menuLabel: "Navegação mobile"
  },
  hero: {
    titleA: "MUITO MAIS QUE",
    titleB: "UM TRANSFER",
    leadA: "Você aproveita a viagem,",
    leadB: "nós cuidamos do caminho.",
    detail: "Transfers de ida e volta ao Aeroporto Chapelco. Conexões com os principais centros de esqui. Serviço público, privado e soluções para grupos.",
    cta: "Reservar meu transfer",
    badge: "Experiência local",
    badgeYear: "desde 2009"
  },
  services: {
    eyebrow: "Escolha como viajar",
    titleA: "Sua viagem começa",
    titleB: "aqui.",
    intro: "Um jeito simples, cuidadoso e confortável de descobrir a Patagônia. Escolha o serviço que precisa e nós cuidamos do resto.",
    book: "Reservar",
    ask: "Consultar",
    quote: "Pedir orçamento",
    items: [
      { title: "Transfers de aeroporto", text: "Chapelco ↔ San Martín de los Andes e outros destinos." },
      { title: "Transfers privados", text: "De porta a porta, com conforto e flexibilidade." },
      { title: "Passeios e destinos", text: "Transporte para conhecer as paisagens mais incríveis." },
      { title: "Grupos e empresas", text: "Soluções para escolas, eventos, equipes e grupos grandes." }
    ]
  },
  featured: {
    eyebrow: "Serviço em destaque",
    titleA: "Do aeroporto",
    titleB: "ao seu destino.",
    titleC: "Sem complicações.",
    text: "Você chega em Chapelco e nós cuidamos do resto. Transfers confortáveis, seguros e coordenados para começar a viagem desde o primeiro momento.",
    fromAirport: "Chapelco",
    fromAirportArrow: "San Martín",
    toAirportArrow: "San Martín",
    toAirport: "Chapelco",
    ctaFlight: "Reservar por voo",
    ctaTransfer: "Reservar transfer",
    formTitle: "Encontre seu transfer",
    formStatus: "Disponível",
    origin: "Origem",
    destination: "Destino",
    date: "Data",
    pickOrigin: "Escolha uma origem",
    pickDestination: "Escolha um destino",
    submit: "Ver horários"
  },
  destinations: {
    eyebrow: "Nossos destinos",
    titleA: "Paisagens que",
    titleB: "ficam.",
    intro: "Conhecemos cada curva, cada lago e cada caminho. Consulte o transfer para o destino que quer descobrir.",
    cta: "Consultar transfer",
    items: [
      { title: "San Martín de los Andes", detail: "Lagos, floresta e montanha" },
      { title: "Chapelco", detail: "Neve e experiências de altitude" },
      { title: "Lago Hermoso", detail: "Um refúgio na cordilheira" },
      { title: "Villa La Angostura", detail: "Estrada, lago e floresta" }
    ]
  },
  promise: {
    eyebrow: "Muito mais que um transfer",
    titleA: "Viajar bem também",
    titleB: "faz parte da viagem.",
    lead: "Na La Araucana entendemos que a viagem começa muito antes de chegar ao destino.",
    text: "Por isso cuidamos de cada detalhe: coordenação, pontualidade, conforto e atendimento. Queremos que você entre e sinta:",
    quote: "“Estou em boas mãos.”",
    trust: ["Pontualidade", "Coordenação", "Conforto", "Atendimento personalizado"],
    alt: "Veículo da La Araucana pronto para viajar"
  },
  fleet: {
    eyebrow: "Frota",
    titleA: "Preparada para",
    titleB: "a Patagônia.",
    lead: "Veículos impecáveis, seguros e prontos para acompanhar você em cada trajeto.",
    cta: "Consultar disponibilidade",
    alt: "Paisagem nevada da cordilheira patagônica",
    captionSmall: "A estrada também faz parte da viagem",
    captionBigA: "Sua próxima aventura",
    captionBigB: "viaja confortável."
  },
  map: {
    eyebrow: "Área de operação",
    titleA: "Patagônia para",
    titleB: "descobrir.",
    intro: "Explore alguns dos lugares onde chegamos. Mova o mapa e encontre seu próximo destino."
  },
  trust: {
    eyebrow: "Confiança e experiência",
    title: "Um atendimento próximo para viajar com tranquilidade.",
    text: "Empresa habilitada como Agência de Turismo Estudantil."
  },
  final: {
    eyebrow: "A Patagônia espera por você",
    titleA: "A viagem",
    titleB: "é",
    accent: "agora.",
    cta: "Comece a viajar"
  },
  contact: {
    eyebrow: "Contato",
    titleA: "Para onde você vai?",
    titleB: "Nós levamos você.",
    lead: "Estamos aqui para ajudar a organizar seu próximo transfer.",
    addressA: "Mariano Moreno 829",
    addressB: "San Martín de los Andes",
    addressC: "Todos os dias · 8h30 às 21h",
    cardTitle: "Vamos conversar",
    instagram: "Instagram",
    directions: "Como chegar"
  },
  routes: {
    title: "Rotas e horários",
    subtitle: "Escolha seu próximo trecho.",
    allOrigins: "Todas as origens",
    allDestinations: "Todos os destinos",
    days: "Dias com saídas",
    pickDeparture: "Escolha sua saída",
    check: "Consultar disponibilidade",
    empty: "Não encontramos rotas com esses dados.",
    emptyHint: "Tente outra origem, destino ou data.",
    clear: "Limpar busca"
  },
  footer: {
    logoAlt: "La Araucana Viajes",
    kicker: "O jeito mais confortável de começar sua viagem pela Patagônia.",
    address: "San Martín de los Andes, Neuquén, Patagônia argentina",
    postal: "Mariano Moreno 829 — CEP 8370",
    transfers: "Transfers",
    services: "Serviços",
    destinations: "Destinos",
    contact: "Contato",
    support: "Suporte",
    terms: "Termos e condições",
    privacy: "Privacidade",
    login: "Acesso ao sistema",
    legal: "Empresa habilitada como Agência de Turismo Estudantil · Leg. 14241 · Disp. 924/05"
  },
  weather: {
    conditions: {
      despejado: "Céu limpo",
      parcial: "Parcialmente nublado",
      nublado: "Nublado",
      lluvia: "Chuva",
      nieve: "Neve",
      tormenta: "Tempestade"
    }
  },
  lang: {
    label: "Idioma",
    switchTo: "Ver o site em"
  }
};

const DICTIONARIES: Record<Locale, Dictionary> = { es, en, pt };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES.es;
}

export { es as spanishDictionary };
