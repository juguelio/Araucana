import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_HEADER, PATH_HEADER, isLocale, isPrivatePath } from "@/i18n/config";

/**
 * Inglés y portugués viven en `/en/...` y `/pt/...` pero se sirven con la misma
 * página: se saca el prefijo y se reescribe. El idioma viaja en un header interno
 * que leen el layout y los componentes de servidor. Español queda sin prefijo.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPrivatePath(pathname)) return NextResponse.next();

  const [first, ...rest] = pathname.split("/").filter(Boolean);
  const conPrefijo = isLocale(first);
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, conPrefijo ? first : DEFAULT_LOCALE);
  headers.set(PATH_HEADER, (conPrefijo ? (rest.length ? `/${rest.join("/")}` : "/") : pathname) + request.nextUrl.search);

  if (!conPrefijo) return NextResponse.next({ request: { headers } });

  const url = request.nextUrl.clone();
  url.pathname = rest.length ? `/${rest.join("/")}` : "/";
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:webp|png|jpg|jpeg|gif|svg|ico|mp4|webm|txt|xml|json|css|js|woff2?)$).*)"]
};
